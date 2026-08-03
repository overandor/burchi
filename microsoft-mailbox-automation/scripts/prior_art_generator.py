#!/usr/bin/env python3
"""
Prior Art Research Generator

Identifies the most needed category of LLM research by searching:
  1. GitHub — existing systems, repos, implementations
  2. arXiv — published papers
  3. Hugging Face — deployed models, spaces, demos

Then drafts what DOESN'T exist yet — novel system proposals backed
by real prior art, with defensible novelty claims.

This is NOT creative writing. This is research synthesis.

Usage:
  python3 prior_art_generator.py [--topic "LLM inference scaling"] [--output ./research]
  python3 prior_art_generator.py --auto  # auto-discover hottest underexplored topic
"""

import requests
import json
import time
import re
import os
import argparse
import random
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

# ─── CONFIG ───────────────────────────────────────────────────────────────────

LLM_URL = "https://gguf-serverless-poc.vercel.app/v1/chat/completions"
LLM_MODEL = "/models/model.gguf"
REQUEST_TIMEOUT = 120
COLD_START_WAIT = 15
MAX_TOKENS_PER_REQUEST = 512

# ─── SEARCH BACKENDS ──────────────────────────────────────────────────────────

class GitHubSearch:
    """Search GitHub repositories for prior art."""
    BASE = "https://api.github.com/search/repositories"

    def search(self, query, per_page=10):
        params = {"q": query, "sort": "stars", "order": "desc", "per_page": per_page}
        r = requests.get(self.BASE, params=params, timeout=15,
                         headers={"Accept": "application/vnd.github.v3+json"})
        if not r.ok:
            return []
        data = r.json()
        results = []
        for item in data.get("items", []):
            results.append({
                "source": "github",
                "name": item["full_name"],
                "url": item["html_url"],
                "stars": item["stargazers_count"],
                "description": item.get("description", ""),
                "language": item.get("language", ""),
                "topics": item.get("topics", []),
                "updated": item.get("updated_at", ""),
                "license": item.get("license", {}).get("name", "") if item.get("license") else "",
            })
        return results

    def search_code(self, query, per_page=5):
        """Search code for implementation patterns."""
        params = {"q": query, "per_page": per_page}
        r = requests.get("https://api.github.com/search/code", params=params, timeout=15,
                         headers={"Accept": "application/vnd.github.v3+json"})
        if not r.ok:
            return []
        data = r.json()
        return [{"source": "github_code", "repo": item["repository"]["full_name"],
                 "path": item["path"], "url": item["html_url"]}
                for item in data.get("items", [])]


class ArxivSearch:
    """Search arXiv for published papers."""
    BASE = "http://export.arxiv.org/api/query"

    def search(self, query, max_results=10):
        params = {"search_query": f"all:{query}", "max_results": max_results,
                  "sortBy": "relevance", "sortOrder": "descending"}
        r = requests.get(self.BASE, params=params, timeout=15)
        if not r.ok:
            return []
        text = r.text
        entries = []
        # Parse Atom feed
        entry_blocks = re.findall(r'<entry>(.*?)</entry>', text, re.DOTALL)
        for block in entry_blocks:
            title = re.search(r'<title>(.*?)</title>', block, re.DOTALL)
            summary = re.search(r'<summary>(.*?)</summary>', block, re.DOTALL)
            link = re.search(r'<id>(.*?)</id>', block, re.DOTALL)
            published = re.search(r'<published>(.*?)</published>', block, re.DOTALL)
            authors = re.findall(r'<name>(.*?)</name>', block, re.DOTALL)
            entries.append({
                "source": "arxiv",
                "title": title.group(1).strip().replace("\n", " ") if title else "",
                "summary": summary.group(1).strip()[:500] if summary else "",
                "url": link.group(1).strip() if link else "",
                "published": published.group(1).strip() if published else "",
                "authors": authors[:5],
            })
        return entries


class HuggingFaceSearch:
    """Search Hugging Face for models, spaces, and datasets."""
    def search_models(self, query, limit=10):
        r = requests.get(f"https://huggingface.co/api/models",
                         params={"search": query, "limit": limit}, timeout=15)
        if not r.ok:
            return []
        data = r.json()
        return [{
            "source": "hf_model",
            "name": m["id"],
            "url": f"https://huggingface.co/{m['id']}",
            "downloads": m.get("downloads", 0),
            "likes": m.get("likes", 0),
            "tags": m.get("tags", [])[:5],
        } for m in data]

    def search_spaces(self, query, limit=5):
        r = requests.get(f"https://huggingface.co/api/spaces",
                         params={"search": query, "limit": limit}, timeout=15)
        if not r.ok:
            return []
        data = r.json()
        return [{
            "source": "hf_space",
            "name": s["id"],
            "url": f"https://huggingface.co/spaces/{s['id']}",
            "tags": s.get("tags", [])[:5],
        } for s in data]


# ─── LLM INFERENCE ────────────────────────────────────────────────────────────

def llm_chat(messages, max_tokens=512, temp=0.7):
    """Send a chat completion request with retry on cold start."""
    for attempt in range(3):
        try:
            r = requests.post(LLM_URL, json={
                "model": LLM_MODEL, "messages": messages,
                "max_tokens": max_tokens, "temperature": temp, "stream": False,
            }, timeout=REQUEST_TIMEOUT)
            if r.status_code == 503:
                print(f"  ❄ cold start, waiting...", flush=True)
                time.sleep(COLD_START_WAIT)
                continue
            r.raise_for_status()
            d = r.json()
            return d["choices"][0]["message"]["content"], d["usage"]["completion_tokens"]
        except Exception as e:
            print(f"  ⚠ {e}", flush=True)
            time.sleep(10)
    return "", 0


def llm_generate_long(system_prompt, user_prompt, target_tokens=2000):
    """Generate long-form text via sequential requests with context pruning."""
    context = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    full_text = ""
    total_tokens = 0
    rotation = 0

    while total_tokens < target_tokens and rotation < 30:
        msgs = list(context)
        if rotation > 0:
            msgs.append({"role": "user", "content": "Continue. Do not repeat. Write the next section."})

        content, tokens = llm_chat(msgs, max_tokens=MAX_TOKENS_PER_REQUEST, temp=0.7)
        if not content.strip():
            break

        full_text += content
        total_tokens += tokens
        rotation += 1
        context.append({"role": "assistant", "content": content})

        # Prune context to prevent KV cache bloat
        if len(context) > 6:
            context = context[:2] + context[-4:]

        print(f"    [{rotation}] {total_tokens}/{target_tokens} tok", flush=True)

        if tokens < MAX_TOKENS_PER_REQUEST * 0.3:
            break  # natural stop

    return full_text, total_tokens


# ─── RESEARCH CATEGORIES ──────────────────────────────────────────────────────

# Hot LLM research areas — ranked by "what's most needed but doesn't fully exist yet"
RESEARCH_CATEGORIES = [
    {
        "name": "Serverless LLM Inference Rotation",
        "description": "Multi-node rotation of serverless inference endpoints to bypass per-container timeout limits",
        "gap": "No existing system chains serverless inference nodes for continuous generation beyond platform timeout limits",
        "search_terms": ["llm inference serverless", "llama.cpp serverless", "inference rotation scaling", "serverless model serving"],
    },
    {
        "name": "KV Cache Externalization for Serverless LLMs",
        "description": "Extracting and persisting KV cache across serverless invocations to avoid recomputation",
        "gap": "KV cache is ephemeral in serverless — no system persists it externally for reuse across cold starts",
        "search_terms": ["kv cache persistence", "llm cache external", "kv cache serverless", "transformer cache reuse"],
    },
    {
        "name": "Fractal Token Compression via Self-Editing",
        "description": "LLM that compresses its own output mid-generation to preserve context window for novel content",
        "gap": "No system has the model edit/compress its own prior output during generation to free context",
        "search_terms": ["llm context compression", "token reduction inference", "self-editing generation", "context window optimization"],
    },
    {
        "name": "P2P GGUF Distribution with Chunk-Level Provenance",
        "description": "BitTorrent-style distribution of GGUF model files with cryptographic chunk provenance",
        "gap": "Existing model distribution is centralized (HF Hub) — no P2P system with chunk-level integrity verification",
        "search_terms": ["gguf p2p distribution", "model file sharing", "torrent model distribution", "decentralized llm"],
    },
    {
        "name": "Competitive Inference Racing for Quality Selection",
        "description": "Multiple models race on the same prompt; preference signals select the best output without human review",
        "gap": "Arena-style human preference exists, but no autonomous racing system selects outputs without human voting",
        "search_terms": ["llm arena competitive", "model racing inference", "preference learning llm", "constitutional ai selection"],
    },
    {
        "name": "Email-to-Execution Pipeline with LLM-Generated DAGs",
        "description": "Parse email content into executable DAGs (directed acyclic graphs) that run ETL operations autonomously",
        "gap": "Email parsing exists, but no system generates executable workflow DAGs from unstructured email content",
        "search_terms": ["email etl pipeline", "llm workflow generation", "dag generation from text", "automated email processing"],
    },
    {
        "name": "MCP (Model Context Protocol) for Cross-Model Tool Routing",
        "description": "Standardized protocol for routing tool calls across heterogeneous LLM endpoints",
        "gap": "MCP exists as a spec, but no production system routes tool calls across multiple model backends dynamically",
        "search_terms": ["model context protocol", "mcp llm tools", "cross-model routing", "llm tool orchestration"],
    },
    {
        "name": "WebRTC-Based Peer-to-Peer LLM Inference",
        "description": "Browser-to-browser LLM inference using WebRTC for direct peer chunk transfer",
        "gap": "WebRTC exists for media, but no system uses it for LLM model weight or inference distribution",
        "search_terms": ["webrtc inference", "browser llm", "peer-to-peer model", "webgpu inference"],
    },
]


# ─── PRIOR ART RESEARCHER ─────────────────────────────────────────────────────

class PriorArtResearcher:
    """Searches GitHub, arXiv, and Hugging Face for prior art on a topic."""

    def __init__(self):
        self.github = GitHubSearch()
        self.arxiv = ArxivSearch()
        self.hf = HuggingFaceSearch()

    def research(self, category):
        """Search all sources for prior art on a research category."""
        print(f"\n{'─'*60}", flush=True)
        print(f"  RESEARCHING: {category['name']}", flush=True)
        print(f"  Gap: {category['gap']}", flush=True)
        print(f"{'─'*60}", flush=True)

        all_results = []
        for term in category["search_terms"]:
            print(f"\n  Searching: \"{term}\"", flush=True)

            # GitHub
            print(f"    GitHub...", flush=True)
            gh = self.github.search(term, per_page=5)
            all_results.extend(gh)
            for r in gh[:3]:
                print(f"      ★{r['stars']:>5} {r['name']} — {(r['description'] or '')[:60]}", flush=True)

            # arXiv
            print(f"    arXiv...", flush=True)
            ax = self.arxiv.search(term, max_results=5)
            all_results.extend(ax)
            for r in ax[:2]:
                print(f"      📄 {r['title'][:80]}", flush=True)

            # HuggingFace
            print(f"    HuggingFace...", flush=True)
            hf_models = self.hf.search_models(term, limit=3)
            all_results.extend(hf_models)
            for r in hf_models[:2]:
                print(f"      🤗 {r['name']} ({r['downloads']} downloads)", flush=True)

            time.sleep(1)  # rate limit courtesy

        return all_results

    def auto_discover(self):
        """Search all categories and rank by 'most needed but least explored'."""
        print(f"\n{'='*60}", flush=True)
        print(f"  AUTO-DISCOVERING HOTTEST UNDEREXPLORED TOPIC", flush=True)
        print(f"  Searching {len(RESEARCH_CATEGORIES)} research categories...", flush=True)
        print(f"{'='*60}", flush=True)

        scored = []
        for cat in RESEARCH_CATEGORIES:
            results = self.research(cat)
            github_count = len([r for r in results if r["source"] == "github"])
            arxiv_count = len([r for r in results if r["source"] == "arxiv"])
            hf_count = len([r for r in results if r["source"] in ("hf_model", "hf_space")])
            total = len(results)

            # Score: lower existing work = higher novelty potential
            # But need SOME existing work to build on
            if total == 0:
                novelty_score = 0  # too novel — nothing to build on
            else:
                novelty_score = max(0, 100 - total * 3)  # fewer results = more novel

            scored.append({
                "category": cat,
                "results": results,
                "github_count": github_count,
                "arxiv_count": arxiv_count,
                "hf_count": hf_count,
                "total": total,
                "novelty_score": novelty_score,
            })

            print(f"\n  📊 {cat['name']}: {total} results "
                  f"(GH:{github_count} arXiv:{arxiv_count} HF:{hf_count}) "
                  f"— Novelty: {novelty_score}/100", flush=True)

        # Sort by novelty score (highest = most needed, least explored)
        scored.sort(key=lambda x: x["novelty_score"], reverse=True)

        print(f"\n{'='*60}", flush=True)
        print(f"  RANKING (most needed → least needed):", flush=True)
        for i, s in enumerate(scored):
            marker = " ◀ SELECTED" if i == 0 else ""
            print(f"  {i+1}. {s['category']['name']} "
                  f"— {s['total']} prior art, novelty={s['novelty_score']}{marker}", flush=True)
        print(f"{'='*60}", flush=True)

        return scored[0]


# ─── RESEARCH DRAFT GENERATOR ─────────────────────────────────────────────────

class ResearchDraftGenerator:
    """Generates a research draft claiming novelty backed by prior art."""

    def __init__(self, output_dir="./research"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate_draft(self, category, prior_art):
        """Generate a full research draft with defensible novelty claims."""
        print(f"\n{'='*60}", flush=True)
        print(f"  GENERATING RESEARCH DRAFT", flush=True)
        print(f"  Topic: {category['name']}", flush=True)
        print(f"  Prior art: {len(prior_art)} sources", flush=True)
        print(f"{'='*60}", flush=True)

        # Format prior art for the LLM context
        prior_art_text = self._format_prior_art(prior_art)

        # ─── SECTION 1: ABSTRACT & PROBLEM STATEMENT ───────────
        print(f"\n  📝 Section 1: Abstract & Problem Statement", flush=True)
        s1_system = (
            "You are a senior ML systems researcher writing a technical paper. "
            "You write precise, academic prose with citations. "
            "You identify gaps in existing systems and propose novel solutions backed by prior art. "
            "Do not write fiction. Write research."
        )
        s1_prompt = (
            f"Write the Abstract and Problem Statement for a research paper on: {category['name']}.\n\n"
            f"Description: {category['description']}\n"
            f"Identified gap: {category['gap']}\n\n"
            f"Prior art (existing systems this builds on):\n{prior_art_text[:3000]}\n\n"
            f"Write a rigorous abstract (200 words) and problem statement (500 words) "
            f"that positions this work against the prior art. Cite specific systems by name. "
            f"Clearly state what does NOT exist yet and why it matters."
        )
        s1_text, s1_tokens = llm_generate_long(s1_system, s1_prompt, target_tokens=1500)

        # ─── SECTION 2: RELATED WORK ────────────────────────────
        print(f"\n  📝 Section 2: Related Work (Prior Art Analysis)", flush=True)
        s2_system = s1_system
        s2_prompt = (
            f"Write the Related Work section for a paper on {category['name']}.\n\n"
            f"Analyze these existing systems and papers:\n{prior_art_text[:4000]}\n\n"
            f"For each category of prior art:\n"
            f"1. Summarize what exists\n"
            f"2. Identify limitations\n"
            f"3. State what gap remains\n\n"
            f"Be specific — cite repo names, paper titles, and model names. "
            f"This is a literature review, not a summary."
        )
        s2_text, s2_tokens = llm_generate_long(s2_system, s2_prompt, target_tokens=2000)

        # ─── SECTION 3: PROPOSED SYSTEM ─────────────────────────
        print(f"\n  📝 Section 3: Proposed System Architecture", flush=True)
        s3_system = s1_system
        s3_prompt = (
            f"Write the Proposed System section for a paper on {category['name']}.\n\n"
            f"Gap being addressed: {category['gap']}\n\n"
            f"Design a novel system that fills this gap. Include:\n"
            f"1. System architecture (components, data flow)\n"
            f"2. Novel contributions (what doesn't exist in prior art)\n"
            f"3. Technical approach (algorithms, protocols, data structures)\n"
            f"4. Why this is defensibly novel (cite what exists vs what's new)\n\n"
            f"Prior art for context:\n{prior_art_text[:2000]}\n\n"
            f"Write technical specifications, not vague descriptions."
        )
        s3_text, s3_tokens = llm_generate_long(s3_system, s3_prompt, target_tokens=2000)

        # Save partial draft after section 3
        self._save_partial(category, prior_art, s1_text, s2_text, s3_text, "", "")

        # ─── SECTION 4: NOVELTY DEFENSE ─────────────────────────
        print(f"\n  📝 Section 4: Novelty Defense (Claim Analysis)", flush=True)
        s4_system = s1_system
        s4_prompt = (
            f"Write the Novelty Analysis section for a paper on {category['name']}.\n\n"
            f"Defend the novelty claims against this prior art:\n{prior_art_text[:3000]}\n\n"
            f"For each novel claim:\n"
            f"1. State the claim\n"
            f"2. List the closest existing system\n"
            f"3. Explain the specific difference\n"
            f"4. Rate novelty strength (incremental/moderate/fundamental)\n\n"
            f"Be honest — if something is incremental, say so. "
            f"Only claim fundamental novelty where the prior art genuinely lacks it."
        )
        s4_text, s4_tokens = llm_generate_long(s4_system, s4_prompt, target_tokens=1500)

        # Save partial after section 4
        self._save_partial(category, prior_art, s1_text, s2_text, s3_text, s4_text, "")

        # ─── SECTION 5: IMPLEMENTATION ROADMAP ──────────────────
        print(f"\n  📝 Section 5: Implementation Roadmap", flush=True)
        s5_system = s1_system
        s5_prompt = (
            f"Write the Implementation Roadmap for the proposed system: {category['name']}.\n\n"
            f"Gap: {category['gap']}\n\n"
            f"Include:\n"
            f"1. MVP scope (what to build first)\n"
            f"2. Dependencies (existing tools, libraries, models to use)\n"
            f"3. Evaluation metrics (how to measure success)\n"
            f"4. Risk assessment (what could fail)\n"
            f"5. Timeline (phased approach)\n\n"
            f"Reference specific tools from prior art where applicable:\n{prior_art_text[:1500]}"
        )
        s5_text, s5_tokens = llm_generate_long(s5_system, s5_prompt, target_tokens=1500)

        # ─── ASSEMBLE ───────────────────────────────────────────
        total_tokens = s1_tokens + s2_tokens + s3_tokens + s4_tokens + s5_tokens
        timestamp = datetime.now().isoformat()

        draft = f"""# {category['name']}
## A Novel System Proposal Backed by Prior Art Analysis

*Generated: {timestamp}*
*Prior art sources: {len(prior_art)} (GitHub, arXiv, Hugging Face)*
*Total tokens generated: {total_tokens}*

---

## Prior Art Sources

{self._format_prior_art_table(prior_art)}

---

## Section 1: Abstract & Problem Statement

{s1_text}

---

## Section 2: Related Work

{s2_text}

---

## Section 3: Proposed System Architecture

{s3_text}

---

## Section 4: Novelty Defense

{s4_text}

---

## Section 5: Implementation Roadmap

{s5_text}

---

## Appendix: Raw Prior Art Data

{json.dumps(prior_art, indent=2)[:5000]}
"""

        # Save
        filename = f"{category['name'].lower().replace(' ', '_').replace('/', '_')}.md"
        filepath = self.output_dir / filename
        filepath.write_text(draft)

        print(f"\n{'='*60}", flush=True)
        print(f"  DRAFT COMPLETE", flush=True)
        print(f"  Sections: 5", flush=True)
        print(f"  Total tokens: {total_tokens}", flush=True)
        print(f"  Prior art cited: {len(prior_art)}", flush=True)
        print(f"  Saved to: {filepath}", flush=True)
        print(f"{'='*60}", flush=True)

        return filepath, total_tokens

    def _save_partial(self, category, prior_art, s1, s2, s3, s4, s5):
        """Save partial draft incrementally."""
        filename = f"{category['name'].lower().replace(' ', '_').replace('/', '_')}.md"
        filepath = self.output_dir / filename
        sections = []
        if s1: sections.append(f"## Section 1: Abstract & Problem Statement\n\n{s1}")
        if s2: sections.append(f"## Section 2: Related Work\n\n{s2}")
        if s3: sections.append(f"## Section 3: Proposed System Architecture\n\n{s3}")
        if s4: sections.append(f"## Section 4: Novelty Defense\n\n{s4}")
        if s5: sections.append(f"## Section 5: Implementation Roadmap\n\n{s5}")

        content = f"# {category['name']}\n## Novel System Proposal (PARTIAL)\n\n---\n\n" + "\n\n---\n\n".join(sections)
        filepath.write_text(content)

    def _format_prior_art(self, results):
        """Format prior art results as text for LLM context."""
        lines = []
        for r in results:
            if r["source"] == "github":
                lines.append(f"- [GitHub] {r['name']} (★{r['stars']}) — {r['description'][:100] if r['description'] else 'no description'} | {r['url']}")
            elif r["source"] == "arxiv":
                lines.append(f"- [arXiv] \"{r['title']}\" by {', '.join(r['authors'][:2])} — {r['summary'][:100]} | {r['url']}")
            elif r["source"] == "hf_model":
                lines.append(f"- [HF Model] {r['name']} ({r['downloads']} downloads) — tags: {', '.join(r['tags'][:3])} | {r['url']}")
            elif r["source"] == "hf_space":
                lines.append(f"- [HF Space] {r['name']} — {r['url']}")
        return "\n".join(lines[:30])  # cap at 30 sources

    def _format_prior_art_table(self, results):
        """Format prior art as a markdown table."""
        lines = ["| Source | Name | Details | URL |", "|--------|------|---------|-----|"]
        for r in results[:20]:
            if r["source"] == "github":
                lines.append(f"| GitHub | {r['name']} | ★{r['stars']} — {r['description'][:50] if r['description'] else ''} | {r['url']} |")
            elif r["source"] == "arxiv":
                lines.append(f"| arXiv | {r['title'][:40]} | {r['published'][:10]} | {r['url']} |")
            elif r["source"] == "hf_model":
                lines.append(f"| HF | {r['name']} | {r['downloads']} downloads | {r['url']} |")
        return "\n".join(lines)


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Prior Art Research Generator")
    parser.add_argument("--topic", type=str, default=None,
                        help="Specific research topic (default: auto-discover)")
    parser.add_argument("--auto", action="store_true",
                        help="Auto-discover the most needed underexplored topic")
    parser.add_argument("--output", type=str, default="./research",
                        help="Output directory")
    parser.add_argument("--list", action="store_true",
                        help="List all research categories and exit")
    args = parser.parse_args()

    if args.list:
        print("\nResearch Categories:")
        for i, cat in enumerate(RESEARCH_CATEGORIES, 1):
            print(f"\n  {i}. {cat['name']}")
            print(f"     {cat['description']}")
            print(f"     Gap: {cat['gap']}")
        return

    researcher = PriorArtResearcher()
    generator = ResearchDraftGenerator(output_dir=args.output)

    if args.topic:
        # Find matching category or create one
        category = None
        for cat in RESEARCH_CATEGORIES:
            if args.topic.lower() in cat["name"].lower():
                category = cat
                break
        if not category:
            category = {
                "name": args.topic,
                "description": args.topic,
                "gap": f"No comprehensive system exists for {args.topic}",
                "search_terms": [args.topic.lower()],
            }
        prior_art = researcher.research(category)
    else:
        # Auto-discover
        best = researcher.auto_discover()
        category = best["category"]
        prior_art = best["results"]

    # Generate the research draft
    filepath, tokens = generator.generate_draft(category, prior_art)

    print(f"\n✅ Research draft saved to: {filepath}", flush=True)
    print(f"   Open it to review the novel system proposal.", flush=True)


if __name__ == "__main__":
    main()
