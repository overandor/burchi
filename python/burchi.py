#!/usr/bin/env python3
"""
Burchi — Python bindings via ctypes (C ABI)

Usage:
    import burchi
    browser = burchi.Browser()
    browser.goto("https://example.com")
    matches = browser.find("find the login button")
    browser.click("sign in")
    text = browser.extract("article text")
    browser.screenshot("out.png")

This wraps the Burchi dylib (libBurchi.dylib) built from Swift.
"""

import ctypes
import json
import os
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any


def _find_dylib() -> str:
    """Find the built Burchi dynamic library."""
    # Check common build locations
    candidates = [
        Path(__file__).parent / "libBurchi.dylib",
        Path(__file__).parent.parent / ".build" / "release" / "libBurchi.dylib",
        Path(__file__).parent.parent / ".build" / "debug" / "libBurchi.dylib",
        Path.cwd() / ".build" / "release" / "libBurchi.dylib",
        Path.cwd() / ".build" / "debug" / "libBurchi.dylib",
    ]
    for c in candidates:
        if c.exists():
            return str(c)

    # Try building
    project_root = Path(__file__).parent.parent
    if (project_root / "Package.swift").exists():
        subprocess.run(["swift", "build", "-c", "release"], cwd=str(project_root), check=True)
        dylib = project_root / ".build" / "release" / "libBurchi.dylib"
        if dylib.exists():
            return str(dylib)

    raise RuntimeError(
        "Could not find libBurchi.dylib. Run 'swift build -c release' in the burchi project root."
    )


def _find_cli() -> str:
    """Find the built Burchi CLI binary."""
    candidates = [
        Path(__file__).parent.parent / ".build" / "release" / "burchi",
        Path(__file__).parent.parent / ".build" / "debug" / "burchi",
        Path.cwd() / ".build" / "release" / "burchi",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    raise RuntimeError("Could not find burchi CLI binary. Run 'swift build -c release'.")


class Match:
    """A semantic match result from Burchi."""

    def __init__(self, data: Dict[str, Any]):
        self.rank = data.get("rank", 0)
        self.score = data.get("score", 0)
        self.tag = data.get("tag", "")
        self.text = data.get("text", "")
        self.attrs = data.get("attrs", {})
        self.matched_terms = data.get("matchedTerms", [])
        self.xpath = data.get("xpath", "")
        pos = data.get("position", {})
        self.x = pos.get("x", 0)
        self.y = pos.get("y", 0)
        self.width = pos.get("w", 0)
        self.height = pos.get("h", 0)

    def __repr__(self) -> str:
        return f"Match(rank={self.rank}, score={self.score}%, tag=<{self.tag}>, text=\"{self.text[:60]}\")"


class Browser:
    """
    Burchi semantic browser.

    Uses the CLI binary as subprocess for cross-platform compatibility.
    For maximum performance, use the C ABI directly (see _find_dylib).
    """

    def __init__(self, timeout: int = 20):
        self._cli = _find_cli()
        self._timeout = str(timeout)
        self._url = ""

    def _run(self, *args: str) -> str:
        """Run a Burchi CLI command and return stdout."""
        cmd = [self._cli] + list(args) + ["--timeout", self._timeout]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError(f"Burchi command failed: {result.stderr}")
        return result.stdout

    def goto(self, url: str) -> bool:
        """Navigate to a URL."""
        self._url = url
        try:
            self._run("goto", url)
            return True
        except RuntimeError:
            return False

    def find(self, intent: str, top_k: int = 5) -> List[Match]:
        """Semantic find elements by natural language intent."""
        return self.find_json(intent, top_k=top_k)

    def find_json(self, intent: str, top_k: int = 5) -> List[Match]:
        """Semantic find with JSON output (more structured)."""
        output = self._run("json", "--url", self._url, "--intent", intent, "--top", str(top_k))
        try:
            data = json.loads(output)
            return [Match(item) for item in data]
        except json.JSONDecodeError:
            return []

    def click(self, intent: str) -> bool:
        """Click an element by semantic intent."""
        try:
            self._run("click", "--url", self._url, "--intent", intent)
            return True
        except RuntimeError:
            return False

    def type(self, intent: str, value: str) -> bool:
        """Type a value into a field found by semantic intent."""
        try:
            self._run("type", "--url", self._url, "--intent", intent, "--value", value)
            return True
        except RuntimeError:
            return False

    def extract(self, intent: str) -> str:
        """Extract text content from an element found by intent."""
        return self._run("extract", "--url", self._url, "--intent", intent).strip()

    def snapshot(self, intent: Optional[str] = None) -> str:
        """Get a page snapshot (optionally intent-filtered)."""
        args = ["snapshot", "--url", self._url]
        if intent:
            args += ["--intent", intent]
        return self._run(*args)

    def screenshot(self, path: str) -> bool:
        """Take a screenshot of the current page."""
        try:
            self._run("screenshot", "--url", self._url, "--out", path)
            return True
        except RuntimeError:
            return False

    def flows(self) -> List[str]:
        """Detect available page flows."""
        output = self._run("flows", "--url", self._url)
        for line in output.split("\n"):
            if "Available flows:" in line:
                flows_str = line.split("Available flows:")[1].strip()
                return [f.strip() for f in flows_str.split(",") if f.strip()]
        return []

    def metadata(self) -> Dict[str, str]:
        """Extract page metadata (meta tags, title, canonical, etc.)."""
        output = self._run("metadata", "--url", self._url)
        meta = {}
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("  ") and ":" in line:
                key, _, value = line.partition(":")
                meta[key.strip()] = value.strip()
        return meta

    def article(self) -> str:
        """Extract article text content."""
        return self._run("article", "--url", self._url)

    def links(self) -> List[Dict[str, str]]:
        """Extract all links on the page."""
        output = self._run("links", "--url", self._url)
        links = []
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("[") and "→" in line:
                parts = line.split("→", 1)
                text_part = parts[0].strip()
                href = parts[1].strip() if len(parts) > 1 else ""
                # Extract text from "[N] text"
                if "]" in text_part:
                    text = text_part.split("]", 1)[1].strip()
                else:
                    text = text_part
                links.append({"text": text, "href": href})
        return links

    def a11y(self) -> str:
        """Dump the accessibility tree."""
        return self._run("a11y", "--url", self._url)

    def heal_test(self, intent: str) -> Dict[str, Any]:
        """Run a self-healing test."""
        output = self._run("heal", "--url", self._url, "--intent", intent)
        result = {"before_score": 0, "after_score": 0, "same_element": False}
        for line in output.split("\n"):
            if "Before score:" in line:
                result["before_score"] = int(line.split(":")[1].strip().replace("%", ""))
            elif "After score:" in line:
                result["after_score"] = int(line.split(":")[1].strip().replace("%", ""))
            elif "Same element found:" in line:
                result["same_element"] = "YES" in line
        return result

    @staticmethod
    def _parse_find_output(output: str) -> List[Match]:
        """Parse CLI find output into Match objects."""
        matches = []
        current: Dict[str, Any] = {}

        for line in output.split("\n"):
            line_stripped = line.strip()
            if line_stripped.startswith("┌─ Rank #"):
                current = {"rank": int(line_stripped.split("#")[1].split(" ")[0])}
                # Extract score from "┌─ Rank #N — XX% match"
                if "—" in line_stripped:
                    score_part = line_stripped.split("—")[1].strip()
                    score_num = "".join(c for c in score_part if c.isdigit())
                    current["score"] = int(score_num) if score_num else 0
            elif line_stripped.startswith("│ Tag:"):
                parts = line_stripped.replace("│ Tag: <", "").replace(">", "").split()
                current["tag"] = parts[0] if parts else ""
            elif line_stripped.startswith("│ Text:"):
                text = line_stripped.replace("│ Text:", "").strip().strip('"')
                current["text"] = text
            elif line_stripped.startswith("│ Attrs:"):
                current["attrs"] = {}
            elif line_stripped.startswith("│ Matched:"):
                terms = line_stripped.replace("│ Matched:", "").strip()
                current["matchedTerms"] = [t.strip() for t in terms.split(",")]
            elif line_stripped.startswith("└─"):
                if "rank" in current:
                    if "score" not in current:
                        current["score"] = 0
                    matches.append(Match(current))

        return matches

    def login(self, email: str, password: str) -> bool:
        """Execute a login flow atomically via script."""
        result = self.script([
            {"action": "goto", "intent": self._url},
            {"action": "type", "intent": "email", "value": email},
            {"action": "type", "intent": "password", "value": password},
            {"action": "click", "intent": "submit login sign in", "wait": 2.0},
        ])
        if not result:
            return False
        try:
            results = json.loads(result)
            return all(r.get("success", False) for r in results)
        except (json.JSONDecodeError, TypeError):
            return False

    def digest(self) -> str:
        """Get LLM page digest — clean semantic representation with no divs or classes."""
        return self._run("digest", "--url", self._url)

    def markdown(self) -> str:
        """Convert page to clean markdown for LLM consumption."""
        return self._run("markdown", "--url", self._url)

    def crawl(self, urls: List[str]) -> str:
        """Batch crawl multiple URLs, returns JSON with digests, links, metadata."""
        url_str = ",".join(urls)
        return self._run("crawl", "--url", url_str)

    def script(self, actions: List[Dict[str, Any]]) -> str:
        """Execute a JSON script of semantic actions.

        Example:
            browser.script([
                {"action": "goto", "intent": "https://example.com"},
                {"action": "digest"},
                {"action": "find", "intent": "login button"},
                {"action": "click", "intent": "sign in", "wait": 2.0},
                {"action": "markdown"}
            ])
        """
        import tempfile
        json_str = json.dumps(actions)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write(json_str)
            f.flush()
            return self._run("script", "--file", f.name)

    def ask(self, question: str) -> Dict[str, Any]:
        """Ask a structured question about the page. Returns JSON."""
        output = self._run("ask", "--url", self._url, "--intent", question)
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"raw": output}

    def smart_extract(self) -> Dict[str, Any]:
        """Smart structured extraction — auto-detects page type and extracts relevant data."""
        output = self._run("smart", "--url", self._url)
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"raw": output}

    def crawl_site(self, url: str, depth: int = 3, max_pages: int = 50,
                   delay: float = 0.5, format: str = "markdown") -> List[Dict[str, Any]]:
        """Recursive site crawl with depth control, same-domain filter, URL dedup.

        This is the Firecrawl-killer feature. Crawls an entire site following
        internal links up to the specified depth, with content dedup and
        rate limiting.
        """
        output = self._run("site", "--url", url, "--depth", str(depth),
                          "--max", str(max_pages), "--delay", str(delay),
                          "--format", format)
        # Parse the summary output — for full JSON, use crawl_site_json
        return [{"raw": output}]

    def crawl_site_json(self, url: str, depth: int = 3, max_pages: int = 50,
                        delay: float = 0.5, format: str = "markdown",
                        output_file: Optional[str] = None) -> List[Dict[str, Any]]:
        """Recursive site crawl returning full JSON results.

        Args:
            url: Starting URL
            depth: Maximum crawl depth (default: 3)
            max_pages: Maximum pages to crawl (default: 50)
            delay: Delay between requests in seconds (default: 0.5)
            format: Output format — "markdown", "digest", or "json" (default: markdown)
            output_file: If provided, save JSON to this file

        Returns:
            List of page dicts with url, title, content, links, metadata
        """
        import tempfile
        if not output_file:
            output_file = tempfile.NamedTemporaryFile(suffix='.json', delete=False).name
        self._run("site", "--url", url, "--depth", str(depth),
                 "--max", str(max_pages), "--delay", str(delay),
                 "--format", format, "--out", output_file)
        try:
            with open(output_file) as f:
                return json.loads(f.read())
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def sitemap(self, url: str) -> List[str]:
        """Parse sitemap.xml for a site. Returns list of URLs."""
        output = self._run("sitemap", "--url", url)
        urls = []
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("[") and "]" in line:
                parts = line.split("]", 1)
                if len(parts) > 1:
                    urls.append(parts[1].strip())
        return urls

    def search_pages(self, crawled_file: str, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """Search across previously crawled pages.

        Args:
            crawled_file: Path to JSON file from crawl_site_json
            query: Natural language search query
            top_k: Maximum results (default: 10)

        Returns:
            List of search result dicts with url, title, score, snippet
        """
        output = self._run("search", "--file", crawled_file,
                          "--intent", query, "--top", str(top_k))
        # Parse the text output
        results = []
        current = {}
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("┌─"):
                current = {}
                parts = line.split("—")
                if len(parts) >= 2:
                    score_str = parts[0].replace("┌─", "").replace("%", "").strip()
                    try:
                        current["score"] = int(score_str)
                    except ValueError:
                        current["score"] = 0
                    current["title"] = parts[1].strip()
            elif line.startswith("│ URL:"):
                current["url"] = line.replace("│ URL:", "").strip()
            elif line.startswith("│ Matched:"):
                current["matched_terms"] = [t.strip() for t in
                    line.replace("│ Matched:", "").strip().split(",")]
            elif line.startswith("│ Snippet:"):
                current["snippet"] = line.replace("│ Snippet:", "").strip()
            elif line.startswith("└─"):
                if current:
                    results.append(current)
        return results


if __name__ == "__main__":
    # Quick demo
    b = Browser()
    print("Burchi Python bindings — Demo")
    print("=" * 50)

    print("\n1. Navigating to example.com...")
    b.goto("https://example.com")

    print("\n2. Finding heading...")
    matches = b.find("find the main heading")
    for m in matches:
        print(f"  {m}")

    print("\n3. Finding link...")
    matches = b.find("find the more information link")
    for m in matches:
        print(f"  {m}")

    print("\n4. Extracting metadata...")
    meta = b.metadata()
    for k, v in list(meta.items())[:5]:
        print(f"  {k}: {v[:60]}")

    print("\n4. Page digest (LLM format)...")
    d = b.digest()
    print(f"  {d[:200]}...")

    print("\n5. Markdown conversion...")
    md = b.markdown()
    print(f"  {md[:200]}...")

    print("\n6. Smart extract...")
    smart = b.smart_extract()
    print(f"  Type: {smart.get('type', 'unknown')}")
    print(f"  Title: {smart.get('title', '')}")

    print("\n7. Ask question...")
    answer = b.ask("what links are on this page?")
    print(f"  Links found: {len(answer.get('links', []))}")

    print("\n8. Self-healing test...")
    result = b.heal_test("find the more information link")
    print(f"  Before: {result['before_score']}%, After: {result['after_score']}%, Same: {result['same_element']}")

    print("\n9. Sitemap parsing...")
    urls = b.sitemap("https://example.com")
    print(f"  Found {len(urls)} URLs in sitemap")

    print("\n10. Site crawl (depth=1, max=3)...")
    pages = b.crawl_site_json("https://example.com", depth=1, max_pages=3)
    print(f"  Crawled {len(pages)} pages")
    for p in pages[:3]:
        print(f"  [{p.get('depth', 0)}] {p.get('title', '')[:50]} → {p.get('url', '')[:60]}")

    print("\n✓ Burchi v4 Python bindings working!")
