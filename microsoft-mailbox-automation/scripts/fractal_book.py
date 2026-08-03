#!/usr/bin/env python3
"""
Fractal Book Generator — 6 Tomes, Endless Generation

Architecture:
  Tome (6 total)
    └── Chapter (each chapter = book-length, fractal)
          └── Section (generated via rotation)
                └── Chunk (1024 tokens per request)

Speed decay: generation slows over time to preserve novelty.
  - First chapter: fast (18 tok/s, raw creative flow)
  - Later chapters: slower (down to 2 tok/s), more deliberate
  - This mimics how a real author slows down as the story deepens

Crawler: runs between chapters, compresses previous content:
  - Removes redundancy
  - Paraphrases verbose passages
  - Compresses to ~30% of original token count
  - Frees up context window for new generation

LGBTQ+ themed — love stories, chosen family, identity journeys.

Usage:
  python3 fractal_book.py [--tomes 6] [--chapters-per-tome 20] [--output ./book]
"""

import requests
import json
import time
import os
import re
import argparse
import random
from datetime import datetime
from pathlib import Path

# ─── CONFIG ───────────────────────────────────────────────────────────────────

ENDPOINTS = [
    {"url": "https://gguf-serverless-poc.vercel.app/v1", "model": "/models/model.gguf"},
    # Add more nodes for parallelism:
    # {"url": "https://gguf-node-2.vercel.app/v1", "model": "/models/model.gguf"},
]

MAX_TOKENS_PER_REQUEST = 512  # smaller chunks = faster response within timeout
REQUEST_TIMEOUT = 120  # seconds — Vercel container may need to reload model
COLD_START_WAIT = 20  # seconds to wait on 503

# Speed decay — slows generation to preserve novelty
INITIAL_SPEED_FACTOR = 1.0   # full speed at start
MIN_SPEED_FACTOR = 0.15      # slow down to 15% by the end
SPEED_DECAY_PER_CHAPTER = 0.92  # multiply by this each chapter

# Crawler — compresses content to save tokens
CRAWLER_COMPRESSION_TARGET = 0.35  # compress to 35% of original
CRAWLER_ENABLED = True

# Fractal — each chapter is book-length
TOKENS_PER_SECTION = 8000       # each section within a chapter
SECTIONS_PER_CHAPTER = 5        # sections per chapter (fractal: chapter = book)
CHAPTERS_PER_TOME = 20          # chapters per tome

# ─── TOMES ────────────────────────────────────────────────────────────────────

TOMES = [
    {
        "title": "Tome I: The Awakening",
        "theme": "A young man discovers his identity in a vibrant coastal city. First love, chosen family, and the courage to be seen. Queer awakening story with joy and heartbreak.",
        "characters": ["Milo (protagonist, 24, artist)", "Jules (love interest, 26, musician)", "Sasha (best friend, 25, drag performer)", "Elena (mentor, 40, gallery owner)"],
        "setting": "A seaside art district with queer bars, galleries, and found-family dinners",
    },
    {
        "title": "Tome II: The Currents",
        "theme": "Relationships deepen and fracture. Polyamory, long-distance love, and the tension between freedom and commitment. The chosen family faces its first real test.",
        "characters": ["Milo and Jules (now 3 years in)", "Kai (new love, 23, surfer)", "Sasha (navigating sobriety)", "Diego (Jules's ex, returns)"],
        "setting": "The same city, now through the lens of familiarity — the bars feel smaller, the ocean feels deeper",
    },
    {
        "title": "Tome III: The Depths",
        "theme": "Loss, grief, and rebirth. A pandemic, a death, a breakup. How queer community holds each other through the worst. Dark but ultimately hopeful.",
        "characters": ["Milo (grieving)", "Elena (illness)", "Sasha (relapse and recovery)", "New: Tomás (hospice nurse, 30)"],
        "setting": "Empty streets, hospital rooms, memorial gatherings, the ocean at dawn",
    },
    {
        "title": "Tome IV: The Return",
        "theme": "Healing and second chances. Milo returns to the city after years away. Rebuilding, forgiveness, and the discovery that home is people, not places.",
        "characters": ["Milo (returning, 32)", "Jules (reunion)", "Sasha (sober, running a community center)", "New: Aria (16, queer youth Milo mentors)"],
        "setting": "The city, changed and unchanged. Gentrified queerness, new bars, old ghosts",
    },
    {
        "title": "Tome V: The Legacy",
        "theme": "Milo builds something lasting — a queer art space, a community, a family. Intergenerational queer stories. What we leave behind.",
        "characters": ["Milo (35, building)", "Aria (now 19, finding her path)", "Sasha (elder statesman of the scene)", "New: Cole (Milo's adopted son, 8)"],
        "setting": "A queer community center, an art collective, a home that's always open",
    },
    {
        "title": "Tome VI: The Eternal",
        "theme": "Time becomes fluid. The book loops back on itself. Characters from all tomes appear at different ages. The story never ends — it just changes form. Queer eternity.",
        "characters": ["All characters, across time", "The city itself as character", "The ocean as witness"],
        "setting": "Everywhere and every-when. The coastal city across decades. Dream-logic spaces.",
    },
]

# ─── INFERENCE ────────────────────────────────────────────────────────────────

class InferenceNode:
    def __init__(self, url, model):
        self.url = url
        self.model = model
        self.healthy = True
        self.request_count = 0
        self.last_used = 0

    def chat(self, messages, max_tokens=1024, temperature=0.7):
        """Send a chat completion request. Retries on 503."""
        endpoint = self.url.rstrip("/") + "/chat/completions"

        for attempt in range(3):
            try:
                r = requests.post(endpoint, json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                }, timeout=REQUEST_TIMEOUT)

                if r.status_code == 503:
                    print(f"  [cold start] waiting {COLD_START_WAIT}s...")
                    time.sleep(COLD_START_WAIT)
                    continue

                r.raise_for_status()
                data = r.json()
                self.healthy = True
                self.request_count += 1
                self.last_used = time.time()

                content = data["choices"][0]["message"]["content"]
                tokens = data.get("usage", {}).get("completion_tokens", len(content) // 4)
                finish = data["choices"][0].get("finish_reason", "stop")
                return content, tokens, finish

            except Exception as e:
                print(f"  [error] {e}")
                self.healthy = False
                if attempt < 2:
                    time.sleep(COLD_START_WAIT)
                else:
                    raise

        return "", 0, "error"

    def health(self):
        try:
            url = self.url.replace("/v1", "/health").rstrip("/")
            r = requests.get(url, timeout=10)
            self.healthy = r.ok
            return r.ok
        except:
            self.healthy = False
            return False


# ─── CRAWLER (compression/paraphrasing) ───────────────────────────────────────

class Crawler:
    """Runs between chapters to compress and refine content.
    Reduces token count by ~65% while preserving narrative essence."""

    def __init__(self, node):
        self.node = node

    def compress(self, content, target_ratio=0.35):
        """Compress content to target_ratio of its original length."""
        if not content.strip():
            return content

        original_tokens = len(content) // 4
        target_tokens = int(original_tokens * target_ratio)

        if target_tokens < 100:
            return content  # too short to compress

        # Split into chunks of ~2000 tokens for compression
        chunks = self._split_content(content, max_chars=8000)
        compressed = []

        for chunk in chunks:
            messages = [
                {"role": "system", "content": "You are an editor. Compress the following text to 35% of its length. Remove redundancy, paraphrase verbosely, keep all plot points, character moments, and emotional beats. Preserve the prose style. Output only the compressed text."},
                {"role": "user", "content": f"Compress this passage:\n\n{chunk}"},
            ]

            try:
                result, tokens, _ = self.node.chat(messages, max_tokens=512, temperature=0.3)
                compressed.append(result)
                print(f"  [crawler] compressed {len(chunk)//4}→{tokens} tokens ({tokens/(len(chunk)//4)*100:.0f}%)")
            except:
                # If compression fails, keep original
                compressed.append(chunk)

        return "\n\n".join(compressed)

    def _split_content(self, content, max_chars=8000):
        """Split content at paragraph boundaries."""
        paragraphs = content.split("\n\n")
        chunks = []
        current = ""

        for p in paragraphs:
            if len(current) + len(p) > max_chars and current:
                chunks.append(current)
                current = p
            else:
                current = current + "\n\n" + p if current else p

        if current:
            chunks.append(current)

        return chunks


# ─── FRACTAL BOOK GENERATOR ───────────────────────────────────────────────────

class FractalBookGenerator:
    def __init__(self, nodes, output_dir="./book"):
        self.nodes = nodes
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.crawler = Crawler(nodes[0])
        self.speed_factor = INITIAL_SPEED_FACTOR
        self.chapter_count = 0
        self.total_tokens = 0
        self.compressed_tokens = 0

    def _get_speed_delay(self):
        """Returns delay (seconds) to wait before generating, based on speed factor.
        Slower speed = longer delay = more 'deliberate' generation."""
        base_delay = 0.5  # minimum delay
        max_delay = 8.0   # maximum delay at slowest speed
        delay = base_delay + (1.0 - self.speed_factor) * (max_delay - base_delay)
        # Add randomness for organic feel
        delay *= random.uniform(0.7, 1.3)
        return delay

    def _get_temperature(self):
        """Temperature increases slightly as speed decreases (more creative when slow)."""
        return 0.7 + (1.0 - self.speed_factor) * 0.3  # 0.7 → 1.0

    def _decay_speed(self):
        """Slow down generation to preserve novelty."""
        self.speed_factor = max(MIN_SPEED_FACTOR, self.speed_factor * SPEED_DECAY_PER_CHAPTER)
        self.chapter_count += 1

    def _get_node(self):
        """Round-robin to next healthy node."""
        for node in self.nodes:
            if node.healthy:
                return node
        # All unhealthy — reset and try first
        for node in self.nodes:
            node.healthy = True
        return self.nodes[0]

    def generate_section(self, system_prompt, user_prompt, target_tokens, context=None):
        """Generate a section via sequential requests within one node."""
        node = self._get_node()
        messages = [{"role": "system", "content": system_prompt}]

        if context:
            # Include compressed context for continuity
            messages.append({"role": "user", "content": f"Previous context (compressed):\n{context[:4000]}"})
            messages.append({"role": "assistant", "content": "Understood. I'll continue from this context."})

        messages.append({"role": "user", "content": user_prompt})

        section_content = ""
        section_tokens = 0
        rotations = 0

        while section_tokens < target_tokens and rotations < 50:
            current_msgs = list(messages)

            if rotations > 0:
                current_msgs.append({
                    "role": "user",
                    "content": "Continue exactly where you left off. Do not repeat. Write the next part of this section."
                })

            # Apply speed delay for novelty preservation
            delay = self._get_speed_delay()
            if delay > 0.1:
                time.sleep(delay)

            temp = self._get_temperature()

            try:
                content, tokens, finish = node.chat(
                    current_msgs, max_tokens=MAX_TOKENS_PER_REQUEST, temperature=temp
                )

                if not content.strip():
                    break

                section_content += content
                section_tokens += tokens
                self.total_tokens += tokens
                rotations += 1

                # Add to context for continuity
                messages.append({"role": "assistant", "content": content})

                # Prune context to prevent KV cache bloat
                if len(messages) > 8:
                    # Keep system + first user + last 4 exchanges
                    messages = messages[:2] + messages[-4:]

                print(f"    [{rotations}] {section_tokens}/{target_tokens} tok | "
                      f"speed={self.speed_factor:.2f} | delay={delay:.1f}s | temp={temp:.1f}")

                # Natural stop
                if finish == "stop" and tokens < MAX_TOKENS_PER_REQUEST * 0.5:
                    break

            except Exception as e:
                print(f"    [error] {e}")
                time.sleep(5)
                continue

        return section_content, section_tokens

    def generate_chapter(self, tome, chapter_num, total_chapters, compressed_context=""):
        """Generate one chapter (fractal: each chapter is book-length with sections)."""
        chapter_title = f"Chapter {chapter_num}: {self._chapter_title(tome, chapter_num)}"

        print(f"\n  📖 {chapter_title}")
        print(f"     Speed factor: {self.speed_factor:.3f} | "
              f"Delay: {self._get_speed_delay():.1f}s | "
              f"Temp: {self._get_temperature():.1f}")

        system = (
            f"You are a celebrated queer novelist writing {tome['title']}. "
            f"Theme: {tome['theme']}\n"
            f"Characters: {', '.join(tome['characters'])}\n"
            f"Setting: {tome['setting']}\n\n"
            f"Write vivid, immersive prose. Include dialogue, sensory details, "
            f"emotional depth, and queer joy. This is literary fiction — not a summary. "
            f"Write the actual narrative prose."
        )

        chapter_content = ""
        chapter_tokens = 0

        # Each chapter has multiple sections (fractal: chapter = book)
        for section_num in range(1, SECTIONS_PER_CHAPTER + 1):
            section_prompt = (
                f"Write Section {section_num} of {SECTIONS_PER_CHAPTER} of {chapter_title}.\n"
                f"This is chapter {chapter_num} of {total_chapters} in {tome['title']}.\n\n"
                f"Section focus: {self._section_focus(tome, chapter_num, section_num)}\n\n"
                f"Write full narrative prose — at least 1500 words. Include dialogue, "
                f"description, internal monologue, and sensory detail. Do not summarize."
            )

            print(f"\n    ─── Section {section_num}/{SECTIONS_PER_CHAPTER} ───")
            content, tokens = self.generate_section(
                system, section_prompt, TOKENS_PER_SECTION,
                context=compressed_context if section_num == 1 else None
            )

            chapter_content += f"\n\n## Section {section_num}\n\n{content}"
            chapter_tokens += tokens

            # Save section incrementally
            self._save_chapter(tome, chapter_num, chapter_title, chapter_content, chapter_tokens)

        # Crawler: compress this chapter for future context
        compressed = ""
        if CRAWLER_ENABLED:
            print(f"\n  🕷️  Crawler compressing chapter {chapter_num}...")
            compressed = self.crawler.compress(chapter_content, CRAWLER_COMPRESSION_TARGET)
            comp_tokens = len(compressed) // 4
            self.compressed_tokens += comp_tokens
            print(f"     {chapter_tokens}→{comp_tokens} tokens "
                  f"({comp_tokens/max(chapter_tokens,1)*100:.0f}%)")

        # Decay speed for next chapter (novelty preservation)
        self._decay_speed()

        return chapter_content, chapter_tokens, compressed

    def generate_tome(self, tome, tome_num):
        """Generate one full tome (20 chapters)."""
        print(f"\n{'='*70}")
        print(f"  📕 {tome['title']}")
        print(f"     {tome['theme'][:100]}...")
        print(f"{'='*70}")

        tome_content = ""
        tome_tokens = 0
        compressed_context = ""  # Accumulates compressed chapters

        for chapter_num in range(1, CHAPTERS_PER_TOME + 1):
            chapter_content, chapter_tokens, compressed = self.generate_chapter(
                tome, chapter_num, CHAPTERS_PER_TOME, compressed_context
            )

            tome_content += f"\n\n# {tome['title']} — Chapter {chapter_num}\n\n{chapter_content}"
            tome_tokens += chapter_tokens

            # Add compressed chapter to running context
            if compressed:
                compressed_context = self._merge_context(compressed_context, compressed)

            # Save tome incrementally
            self._save_tome(tome, tome_num, tome_content, tome_tokens)

            # Stats
            self._print_stats()

        return tome_content, tome_tokens

    def generate_all(self, num_tomes=6):
        """Generate all tomes. Continuous, endless generation."""
        print(f"\n{'#'*70}")
        print(f"#  FRACTAL BOOK GENERATOR")
        print(f"#  {num_tomes} tomes × {CHAPTERS_PER_TOME} chapters × {SECTIONS_PER_CHAPTER} sections")
        print(f"#  Speed decay: {INITIAL_SPEED_FACTOR}→{MIN_SPEED_FACTOR} (novelty preservation)")
        print(f"#  Crawler: {'ON' if CRAWLER_ENABLED else 'OFF'} (compresses to {CRAWLER_COMPRESSION_TARGET*100:.0f}%)")
        print(f"#  LGBTQ+ themed: love, chosen family, identity, queer joy")
        print(f"{'#'*70}")

        start_time = time.time()

        # Health check all nodes
        print("\nHealth checking nodes...")
        for node in self.nodes:
            healthy = node.health()
            print(f"  {node.url}: {'✓' if healthy else '✗'}")

        all_content = ""
        all_tokens = 0

        for tome_num, tome in enumerate(TOMES[:num_tomes], 1):
            tome_content, tome_tokens = self.generate_tome(tome, tome_num)
            all_content += tome_content
            all_tokens += tome_tokens

            # Save complete book so far
            self._save_book(all_content, all_tokens, start_time)

        elapsed = time.time() - start_time
        print(f"\n{'#'*70}")
        print(f"#  COMPLETE: {num_tomes} tomes, {all_tokens} tokens")
        print(f"#  Time: {elapsed/3600:.1f} hours")
        print(f"#  Compressed: {self.compressed_tokens} tokens saved by crawler")
        print(f"#  Words: ~{all_tokens * 4 // 1}")
        print(f"#  Pages: ~{all_tokens * 4 // 250}")
        print(f"{'#'*70}")

    # ─── HELPERS ──────────────────────────────────────────────────────────────

    def _chapter_title(self, tome, chapter_num):
        titles = [
            "The First Light", "Salt and Skin", "The Bar at the End of the Pier",
            "What the Ocean Knows", "Chosen", "The Art of Being Seen",
            "Ebb", "Flood", "The Dinner Party", "Midnight Swims",
            "The Gallery", "What We Carry", "The Long Walk Home",
            "Letters Never Sent", "The Return", "Saudade",
            "The Lighthouse", "Becoming", "The Eternal Now", "Full Circle",
        ]
        return titles[(chapter_num - 1) % len(titles)]

    def _section_focus(self, tome, chapter_num, section_num):
        focuses = [
            "Open with a vivid scene. Introduce the emotional landscape. Who is present? What do they want?",
            "Deepen the scene. Add dialogue — let characters reveal themselves through speech.",
            "A shift or complication. Something changes. Internal monologue, doubt, desire.",
            "The emotional peak of this chapter. The most vulnerable moment. Sensory immersion.",
            "Resolution and transition. A closing image that lingers. Set up the next chapter.",
        ]
        return focuses[(section_num - 1) % len(focuses)]

    def _merge_context(self, existing, new):
        """Merge compressed contexts, keeping total under ~6000 tokens."""
        merged = existing + "\n\n" + new if existing else new
        max_chars = 24000  # ~6000 tokens
        if len(merged) > max_chars:
            # Keep the most recent (end of the context)
            merged = merged[-max_chars:]
        return merged

    def _save_chapter(self, tome, chapter_num, title, content, tokens):
        """Save chapter incrementally."""
        tome_dir = self.output_dir / f"tome_{tome['title'].split(':')[0].split()[-1]}"
        tome_dir.mkdir(parents=True, exist_ok=True)
        filepath = tome_dir / f"chapter_{chapter_num:02d}.md"
        with open(filepath, "w") as f:
            f.write(f"# {title}\n\n*{tokens} tokens*\n\n{content}")

    def _save_tome(self, tome, tome_num, content, tokens):
        """Save complete tome."""
        filepath = self.output_dir / f"tome_{tome_num:02d}_{tome['title'].split(':')[1].strip().lower().replace(' ', '_')}.md"
        with open(filepath, "w") as f:
            f.write(f"# {tome['title']}\n\n*{tokens} tokens, ~{tokens*4//250} pages*\n\n{content}")

    def _save_book(self, content, tokens, start_time):
        """Save the complete book."""
        filepath = self.output_dir / "fractal_book_complete.md"
        elapsed = time.time() - start_time
        words = tokens * 4
        pages = words // 250

        with open(filepath, "w") as f:
            f.write(f"# The Eternal Book: Six Tomes\n\n")
            f.write(f"*Generated: {datetime.now().isoformat()}*\n")
            f.write(f"*Tokens: {tokens} | Words: ~{words} | Pages: ~{pages}*\n")
            f.write(f"*Time: {elapsed/3600:.1f} hours*\n")
            f.write(f"*Crawler saved: {self.compressed_tokens} tokens*\n\n")
            f.write(f"---\n\n{content}")

    def _print_stats(self):
        """Print running stats."""
        print(f"\n  📊 Stats: {self.total_tokens} tokens | "
              f"Speed: {self.speed_factor:.3f} | "
              f"Crawler saved: {self.compressed_tokens} tokens | "
              f"Chapters: {self.chapter_count}")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fractal Book Generator — 6 Tomes")
    parser.add_argument("--tomes", type=int, default=6, help="Number of tomes (default: 6)")
    parser.add_argument("--chapters", type=int, default=20, help="Chapters per tome (default: 20)")
    parser.add_argument("--sections", type=int, default=5, help="Sections per chapter (default: 5)")
    parser.add_argument("--output", type=str, default="./book", help="Output directory")
    parser.add_argument("--no-crawler", action="store_true", help="Disable crawler compression")
    parser.add_argument("--no-decay", action="store_true", help="Disable speed decay")
    args = parser.parse_args()

    global CHAPTERS_PER_TOME, SECTIONS_PER_CHAPTER, CRAWLER_ENABLED
    CHAPTERS_PER_TOME = args.chapters
    SECTIONS_PER_CHAPTER = args.sections
    if args.no_crawler:
        global CRAWLER_ENABLED
        CRAWLER_ENABLED = False

    # Build nodes
    nodes = [InferenceNode(ep["url"], ep["model"]) for ep in ENDPOINTS]

    # Create generator
    gen = FractalBookGenerator(nodes, output_dir=args.output)

    if args.no_decay:
        gen.speed_factor = 1.0
        global SPEED_DECAY_PER_CHAPTER
        SPEED_DECAY_PER_CHAPTER = 1.0

    # Generate!
    gen.generate_all(num_tomes=args.tomes)


if __name__ == "__main__":
    main()
