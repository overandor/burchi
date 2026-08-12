"""Disassembly: conversations -> structured business processes.

This module reads conversations from the unified ChatSync DB and extracts
candidate business processes — recurring workflows, pain points, manual
tasks, and product ideas that appear across chats. Extraction is heuristic
and LLM-optional: when an OpenAI-compatible endpoint is configured
(``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` or a local LLM), it uses the LLM
to structure the processes; otherwise it falls back to a deterministic
keyword + clustering extractor.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import aiosqlite

# Signal phrases that indicate a business process / pain point / product idea.
_SIGNAL_PATTERNS = [
    r"\bI (?:have to|need to|wish I could|should)\b",
    r"\b(?:manually|repetitive|tedious|time[- ]consuming|bottleneck|pain point)\b",
    r"\b(?:automate|automation|workflow|pipeline|streamline)\b",
    r"\b(?:product idea|business idea|SaaS|startup|monetiz)\b",
    r"\b(?:every time I|I keep (?:having to|doing)|why (?:is|can't|don't))\b",
    r"\b(?:there should be|someone should build|I would pay for)\b",
    r"\b(?:revenue|pricing|subscription|charge|invoice|billing)\b",
    r"\b(?:API|endpoint|integration|webhook|CLI|SDK)\b",
    r"\b(?:category|new (?:market|category)|no (?:one|tool|product) (?:does|exists))\b",
]
_SIGNAL_RE = re.compile("|".join(_SIGNAL_PATTERNS), re.IGNORECASE)

# Stopwords for keyword extraction.
_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "can", "to", "of", "in", "on",
    "at", "by", "for", "with", "about", "as", "into", "like", "through", "after",
    "over", "between", "out", "against", "during", "without", "before", "under",
    "around", "among", "this", "that", "these", "those", "i", "you", "he", "she",
    "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his",
    "its", "our", "their", "what", "which", "who", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "if", "then", "there", "here", "from", "up", "down", "also", "get", "got",
    "make", "made", "use", "used", "using", "want", "need", "go", "going",
    "one", "two", "new", "now", "way", "thing", "things", "stuff", "lot",
    # Path/component noise from local file paths in chat logs.
    "alep", "users", "home", "library", "cascade", "projects", "desktop",
    "downloads", "documents", "tmp", "var", "etc", "opt", "usr", "bin",
    "src", "dist", "node_modules", "package", "config", "json", "yaml",
    "md", "txt", "py", "js", "ts", "tsx", "jsx", "sh", "html", "css",
    "antigravity-ide", "antigravity", "gemini", "windsurf", "devin", "claude",
    "codex", "acodex", "chatsync", "scratch", "brain", "conversations",
    "extensions", "cached", "metadata", "payload", "step", "steps",
}


@dataclass
class BusinessProcess:
    id: str
    conversation_id: str
    conversation_title: str
    source: str
    name: str  # short label
    description: str  # 1-3 sentence description of the process/pain point
    category: str  # e.g. "developer tooling", "data pipeline", "content automation"
    signal_phrases: list[str]  # the matched signal snippets
    keywords: list[str]  # extracted topical keywords
    evidence_excerpt: str  # the surrounding text that triggered extraction
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def fingerprint(self) -> str:
        """Stable hash for deduplication across conversations."""
        h = hashlib.sha256()
        h.update(self.name.lower().encode())
        for kw in sorted(self.keywords):
            h.update(kw.lower().encode())
        return h.hexdigest()[:16]


def _extract_keywords(text: str, max_keywords: int = 8) -> list[str]:
    """Extract topical keywords from text via simple frequency analysis."""
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower())
    freq: dict[str, int] = {}
    for tok in tokens:
        if tok in _STOPWORDS or len(tok) < 3:
            continue
        freq[tok] = freq.get(tok, 0) + 1
    ranked = sorted(freq.items(), key=lambda x: (-x[1], x[0]))
    return [w for w, _ in ranked[:max_keywords]]


def _classify_category(text: str, keywords: list[str]) -> str:
    """Heuristically classify the process into a market category."""
    t = text.lower()
    kw = set(keywords)
    if kw & {"api", "endpoint", "webhook", "sdk", "cli", "integration"}:
        return "developer infrastructure"
    if kw & {"deploy", "ci", "cd", "build", "pipeline", "docker", "kubernetes"}:
        return "devops / deployment"
    if kw & {"data", "etl", "pipeline", "ingest", "transform", "warehouse"}:
        return "data pipeline"
    if kw & {"content", "blog", "seo", "social", "post", "video", "image"}:
        return "content automation"
    if kw & {"payment", "stripe", "billing", "invoice", "subscription", "revenue"}:
        return "monetization / billing"
    if kw & {"patent", "prior art", "ip", "invention", "novelty"}:
        return "intellectual property"
    if kw & {"agent", "llm", "ai", "model", "prompt", "rag", "embedding"}:
        return "AI / agent infrastructure"
    if kw & {"security", "audit", "compliance", "vulnerability", "secret"}:
        return "security / compliance"
    if kw & {"chat", "conversation", "sync", "export", "context"}:
        return "conversation / context infrastructure"
    if "market" in t or "category" in t or "no one" in t or "new software" in t:
        return "new market category"
    return "workflow automation"


def _summarize_process(signal_text: str, keywords: list[str]) -> tuple[str, str]:
    """Produce a (name, description) pair from a signal snippet."""
    # Take the first sentence-ish chunk as the name basis.
    first_sentence = re.split(r"[.!?]\s", signal_text)[0].strip()
    name = first_sentence[:80]
    if not name:
        name = " / ".join(keywords[:3]).title()
    # Description: the signal text trimmed.
    description = signal_text.strip()[:300]
    return name, description


async def _llm_extract(text: str, endpoint: str, api_key: str, model: str) -> Optional[dict]:
    """Optionally use an LLM to structure a business process from a snippet."""
    if not api_key or not endpoint:
        return None
    prompt = (
        "You are a business-process extraction engine. From the following chat excerpt, "
        "extract a single candidate business process, pain point, or product idea. "
        "Return JSON with keys: name (short label), description (1-3 sentences), "
        "category (market category string), keywords (list of 3-8 topical keywords).\n\n"
        f"Excerpt:\n{text[:2000]}\n\nJSON:"
    )
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2}
    try:
        import aiohttp
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as sess:
            async with sess.post(f"{endpoint.rstrip('/')}/chat/completions", json=payload, headers=headers) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                content = data["choices"][0]["message"]["content"]
                start, end = content.find("{"), content.rfind("}") + 1
                if start == -1 or end == 0:
                    return None
                return json.loads(content[start:end])
    except Exception:
        return None


async def disassemble_conversations(
    db_path: str,
    since_ts: float = 0.0,
    limit: int = 0,
    use_llm: bool = True,
) -> list[BusinessProcess]:
    """Read conversations from the ChatSync DB and extract business processes.

    Args:
        db_path: Path to the chatsync SQLite DB.
        since_ts: Only consider conversations updated after this timestamp.
        limit: Max conversations to scan (0 = all).
        use_llm: If True and an LLM endpoint is configured, use it for structuring.
    """
    endpoint = os.environ.get("OPENAI_BASE_URL", os.environ.get("LLM_ENDPOINT", "https://api.openai.com/v1"))
    api_key = os.environ.get("OPENAI_API_KEY", os.environ.get("LLM_API_KEY", ""))
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    processes: list[BusinessProcess] = []
    seen_fingerprints: set[str] = set()

    async with aiosqlite.connect(db_path) as db:
        query = "SELECT id, source, title, updated_at FROM conversations"
        params: list = []
        if since_ts:
            query += " WHERE updated_at > ?"
            params.append(since_ts)
        query += " ORDER BY updated_at DESC"
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        cursor = await db.execute(query, params)
        conv_rows = await cursor.fetchall()

        for conv_id, source, title, updated_at in conv_rows:
            mcursor = await db.execute(
                "SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp",
                (conv_id,),
            )
            msg_rows = await mcursor.fetchall()
            full_text = "\n".join(f"[{role}] {content}" for role, content, _ in msg_rows if content)

            # Find all signal matches in the conversation.
            for match in _SIGNAL_RE.finditer(full_text):
                start = max(0, match.start() - 200)
                end = min(len(full_text), match.end() + 400)
                snippet = full_text[start:end].strip()
                if len(snippet) < 20:
                    continue

                keywords = _extract_keywords(snippet)
                structured = None
                if use_llm:
                    structured = await _llm_extract(snippet, endpoint, api_key, model)

                if structured and isinstance(structured, dict):
                    name = str(structured.get("name", ""))[:120]
                    description = str(structured.get("description", ""))[:400]
                    category = str(structured.get("category", ""))[:80]
                    kw = structured.get("keywords", keywords)
                    if not isinstance(kw, list):
                        kw = keywords
                    keywords = [str(k) for k in kw][:10]
                else:
                    name, description = _summarize_process(snippet, keywords)
                    category = _classify_category(snippet, keywords)

                if not name:
                    continue

                bp = BusinessProcess(
                    id=hashlib.sha256(f"{conv_id}:{match.start()}:{name}".encode()).hexdigest()[:16],
                    conversation_id=conv_id,
                    conversation_title=title,
                    source=source,
                    name=name,
                    description=description,
                    category=category,
                    signal_phrases=[match.group(0)],
                    keywords=keywords,
                    evidence_excerpt=snippet[:600],
                )
                if bp.fingerprint in seen_fingerprints:
                    continue
                seen_fingerprints.add(bp.fingerprint)
                processes.append(bp)

    return processes


def cluster_processes(processes: list[BusinessProcess]) -> dict[str, list[BusinessProcess]]:
    """Group processes by category for downstream analysis."""
    clusters: dict[str, list[BusinessProcess]] = {}
    for bp in processes:
        clusters.setdefault(bp.category, []).append(bp)
    return clusters
