"""DiscoveryEngine — crawls directory sites to find beautiful websites.

The Scout has acquisition streams (seed URLs for design directories).
The DiscoveryEngine goes further: it visits those directories,
extracts links to actual showcased websites, and builds a queue
of real sites to observe.

It never runs out of sources. When the queue is low, it crawls
the next directory page to refill it. It tracks which sites have
been visited to avoid re-crawling.

The output is a stream of URLs — real websites where beautiful
UI might reside — ready for the BeautyObserver to render and score.
"""

from __future__ import annotations

import hashlib
import re
import time
from collections import deque
from typing import Optional
from urllib.parse import urljoin, urlparse

from rxreserve.design_genome import SourceEntry, SourceCategory, LicenseState
from rxreserve.scout import Scout


class DiscoveryEngine:
    """Crawls directory pages to discover beautiful websites.

    Workflow:
    1. Start with seed directory URLs (from Scout.ACQUISITION_STREAMS)
    2. Fetch each directory page and extract links to showcased sites
    3. Filter out ads, social media, and self-references
    4. Queue discovered URLs for observation
    5. When queue runs low, crawl more directories
    """

    # Directory pages that list beautiful websites
    DIRECTORY_SEEDS: list[dict] = [
        {"url": "https://www.awwwards.com/websites/", "category": SourceCategory.AWARD_WINNING},
        {"url": "https://www.awwwards.com/websites/site-of-the-day/", "category": SourceCategory.AWARD_WINNING},
        {"url": "https://www.cssdesignawards.com/sites", "category": SourceCategory.EMERGING_INTERFACES},
        {"url": "https://www.siteinspire.com/websites", "category": SourceCategory.EMERGING_INTERFACES},
        {"url": "https://www.webbyawards.com/winners/", "category": SourceCategory.AWARD_WINNING},
        {"url": "https://www.designrush.com/best-designs/websites", "category": SourceCategory.AWARD_WINNING},
        {"url": "https://csswinner.com/", "category": SourceCategory.EMERGING_INTERFACES},
        {"url": "https://www.fwa.xyz/", "category": SourceCategory.AWARD_WINNING},
        {"url": "https://www.lapa.ninja/", "category": SourceCategory.EMERGING_INTERFACES},
        {"url": "https://httpster.net/", "category": SourceCategory.EMERGING_INTERFACES},
    ]

    # Domains to skip (social media, CDNs, ad networks, etc.)
    SKIP_DOMAINS = {
        "facebook.com", "twitter.com", "x.com", "instagram.com",
        "linkedin.com", "youtube.com", "tiktok.com", "pinterest.com",
        "google.com", "googletagmanager.com", "google-analytics.com",
        "doubleclick.net", "addthis.com", "sharethis.com",
        "fonts.googleapis.com", "fonts.gstatic.com",
        "cdnjs.cloudflare.com", "cdn.jsdelivr.net",
        "unpkg.com", "w3.org", "github.com", "behance.net",
        "dribbble.com", "medium.com", "wordpress.com",
    }

    def __init__(self) -> None:
        self._queue: deque[SourceEntry] = deque()
        self._visited: set[str] = set()  # content hashes of visited URLs
        self._crawled_dirs: set[str] = set()  # directory URLs already crawled
        self._scout = Scout()
        self._last_request: dict[str, float] = {}

    def _rate_limit(self, domain: str, min_interval: float = 2.0) -> None:
        """Enforce rate limiting per domain."""
        now = time.time()
        last = self._last_request.get(domain, 0)
        if now - last < min_interval:
            time.sleep(min_interval - (now - last))
        self._last_request[domain] = time.time()

    def _should_skip_url(self, url: str) -> bool:
        """Check if a URL should be skipped."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace("www.", "")

        # Skip social media, CDNs, etc.
        for skip in self.SKIP_DOMAINS:
            if skip in domain:
                return True

        # Skip if no valid scheme
        if parsed.scheme not in ("http", "https"):
            return True

        # Skip if it's just a fragment or query
        if not parsed.netloc:
            return True

        # Skip file downloads
        if any(url.lower().endswith(ext) for ext in
               [".pdf", ".jpg", ".png", ".gif", ".svg", ".zip", ".css", ".js",
                ".mp4", ".webm", ".woff", ".woff2", ".ttf", ".ico"]):
            return True

        return False

    def _extract_links(self, html: str, base_url: str) -> list[str]:
        """Extract external links from a directory page."""
        links: list[str] = []
        base_domain = urlparse(base_url).netloc.lower().replace("www.", "")

        # Find all href links
        for match in re.finditer(r'href=["\']([^"\']+)["\']', html, re.IGNORECASE):
            href = match.group(1)
            # Resolve relative URLs
            full_url = urljoin(base_url, href)
            # Normalize
            full_url = full_url.split("#")[0].split("?")[0].rstrip("/")

            if self._should_skip_url(full_url):
                continue

            # Skip self-references to the directory domain
            link_domain = urlparse(full_url).netloc.lower().replace("www.", "")
            if link_domain == base_domain:
                continue

            links.append(full_url)

        # Deduplicate while preserving order
        seen = set()
        unique = []
        for url in links:
            if url not in seen:
                seen.add(url)
                unique.append(url)

        return unique

    def _fetch_url(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch URL content with error handling."""
        try:
            from httpx import AsyncClient
            # This is a sync fallback — async version is preferred
            import httpx
            with httpx.Client(timeout=timeout, follow_redirects=True,
                              headers={"User-Agent": "DesignGenomeBot/1.0"}) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    return resp.text
        except Exception:
            pass
        return None

    async def crawl_directory(self, dir_url: str,
                              category: SourceCategory) -> list[SourceEntry]:
        """Crawl a directory page and extract links to showcased websites."""
        if dir_url in self._crawled_dirs:
            return []

        domain = urlparse(dir_url).netloc
        self._rate_limit(domain)

        try:
            import httpx
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=True,
                headers={"User-Agent": "DesignGenomeBot/1.0"}
            ) as client:
                resp = await client.get(dir_url)
                if resp.status_code != 200:
                    self._crawled_dirs.add(dir_url)
                    return []
                html = resp.text
        except Exception:
            self._crawled_dirs.add(dir_url)
            return []

        self._crawled_dirs.add(dir_url)
        links = self._extract_links(html, dir_url)

        sources: list[SourceEntry] = []
        for url in links:
            content_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
            if content_hash in self._visited:
                continue
            self._visited.add(content_hash)
            source = SourceEntry(
                url=url,
                category=category,
                license_state=LicenseState.UNKNOWN,
                access_policy_checked=False,
            )
            sources.append(source)

        return sources

    async def refill_queue(self, max_sources: int = 20) -> int:
        """Crawl directory pages to refill the queue. Returns count added."""
        added = 0
        for seed in self.DIRECTORY_SEEDS:
            if added >= max_sources:
                break
            if seed["url"] in self._crawled_dirs:
                continue
            sources = await self.crawl_directory(seed["url"], seed["category"])
            for source in sources:
                if added >= max_sources:
                    break
                self._queue.append(source)
                added += 1
        return added

    async def next_source(self) -> Optional[SourceEntry]:
        """Get the next source to observe. Refills queue if empty."""
        if not self._queue:
            added = await self.refill_queue()
            if added == 0 and not self._queue:
                return None
        if self._queue:
            return self._queue.popleft()
        return None

    def queue_size(self) -> int:
        return len(self._queue)

    def crawled_count(self) -> int:
        return len(self._crawled_dirs)

    def visited_count(self) -> int:
        return len(self._visited)

    def summary(self) -> dict:
        return {
            "queue_size": self.queue_size(),
            "directories_crawled": self.crawled_count(),
            "urls_discovered": self.visited_count(),
            "seeds_total": len(self.DIRECTORY_SEEDS),
        }
