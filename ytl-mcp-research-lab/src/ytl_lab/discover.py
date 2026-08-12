"""Competitor discovery + API endpoint extraction.

Real HTTP crawling — no Ollama, no Selenium. Fetches pages, extracts API
endpoints from HTML, detects tech stack, pricing signals, and external links.
Works in Vercel serverless functions (pure fetch + parse).
"""

from __future__ import annotations

import re
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import json

FETCH_TIMEOUT = 10
USER_AGENT = "Mozilla/5.0 (compatible; SixBrowseBot/2.0; +https://github.com/overandor/six-browse)"


def _fetch(url: str, timeout: int = FETCH_TIMEOUT) -> Dict[str, Any]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("content-type", "")
            headers = dict(resp.headers)
            body = resp.read().decode("utf-8", errors="replace")
            return {
                "reachable": True,
                "status": resp.status,
                "content_type": content_type,
                "headers": headers,
                "body": body,
                "error": None,
            }
    except urllib.error.HTTPError as e:
        return {"reachable": e.code < 500, "status": e.code, "content_type": "", "headers": {}, "body": "", "error": str(e)}
    except Exception as e:
        return {"reachable": False, "status": 0, "content_type": "", "headers": {}, "body": "", "error": str(e)}


def _extract_meta(html: str) -> Dict[str, Optional[str]]:
    def get_meta(name: str) -> Optional[str]:
        pattern = rf'<meta[^>]+(?:name|property)=["\']({re.escape(name)})["\'][^>]+content=["\']([^"\']+)["\']'
        m = re.search(pattern, html, re.IGNORECASE)
        return m.group(2) if m else None

    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return {
        "title": title_match.group(1).strip() if title_match else None,
        "description": get_meta("description") or get_meta("og:description"),
        "og_title": get_meta("og:title"),
        "og_image": get_meta("og:image"),
    }


def _extract_api_endpoints(html: str, base_url: str) -> List[str]:
    endpoints: Set[str] = set()
    patterns = [
        r'["\'`](https?://[^"\'`\s]+/api[^"\'`\s]*?)["\'`]',
        r'["\'`](https?://api\.[^"\'`\s]+)["\'`]',
        r'["\'`](/api/[^"\'`\s]+)["\'`]',
        r'["\'`](https?://[^"\'`\s]+/(?:swagger|openapi|api-docs)[^"\'`\s]*?)["\'`]',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html, re.IGNORECASE):
            ep = match.group(1)
            if ep.startswith("/"):
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(base_url)
                    ep = f"{parsed.scheme}://{parsed.netloc}{ep}"
                except:
                    continue
            if "api" in ep.lower() or "swagger" in ep.lower() or "openapi" in ep.lower():
                endpoints.add(ep)
    return list(endpoints)[:20]


def _detect_tech_stack(html: str, headers: Dict[str, str]) -> List[str]:
    tech: Set[str] = set()
    combined = (json.dumps(headers) + html).lower()
    checks = [
        ("next.js", ["__next", "next.js", "_next"]),
        ("react", ["react"]),
        ("vue", ["vue"]),
        ("svelte", ["svelte"]),
        ("angular", ["angular"]),
        ("stripe", ["stripe"]),
        ("cloudflare", ["cloudflare"]),
        ("vercel", ["vercel"]),
        ("netlify", ["netlify"]),
        ("fastapi", ["fastapi"]),
        ("django", ["django"]),
        ("express", ["express"]),
        ("tailwind", ["tailwind"]),
        ("graphql", ["graphql"]),
        ("supabase", ["supabase"]),
        ("firebase", ["firebase"]),
        ("openai", ["openai"]),
        ("anthropic", ["anthropic"]),
        ("websocket", ["websocket", "ws://"]),
    ]
    for name, keywords in checks:
        if any(kw in combined for kw in keywords):
            tech.add(name)
    server = headers.get("Server", "")
    if server:
        tech.add(server)
    return list(tech)


def _extract_pricing_signals(html: str) -> List[str]:
    lower = html.lower()
    signals = []
    checks = [
        ("has_pricing_page", ["pricing", "plans"]),
        ("free_tier", ["free tier", "free plan", "free forever"]),
        ("paid_tiers", ["pro plan", "premium", "enterprise"]),
        ("subscription_billing", ["stripe", "checkout", "subscription"]),
        ("developer_api", ["api key", "api access", "developer"]),
        ("monthly_pricing", ["/mo", "/month", "per month"]),
    ]
    for name, keywords in checks:
        if any(kw in lower for kw in keywords):
            signals.append(name)
    return signals


def _extract_external_links(html: str, base_url: str) -> List[str]:
    from urllib.parse import urlparse
    links: Set[str] = set()
    try:
        base_origin = f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}"
    except:
        return []

    skip = {"twitter.com", "facebook.com", "linkedin.com", "github.com", "youtube.com", "instagram.com", "google.com"}
    for match in re.finditer(r'href=["\'](https?://[^"\']+)["\']', html, re.IGNORECASE):
        try:
            parsed = urlparse(match.group(1))
            if parsed.netloc not in base_origin and not any(s in parsed.netloc for s in skip):
                links.add(f"{parsed.scheme}://{parsed.netloc}")
        except:
            continue
    return list(links)[:15]


def _verify_api_endpoint(url: str) -> Dict[str, Any]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=6) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            is_json = False
            try:
                json.loads(body)
                is_json = True
            except:
                pass
            return {
                "reachable": resp.status < 500,
                "status": resp.status,
                "is_json": is_json,
                "has_cors": resp.headers.get("access-control-allow-origin") is not None,
                "body_preview": body[:200],
            }
    except Exception as e:
        return {"reachable": False, "status": 0, "is_json": False, "has_cors": False, "body_preview": "", "error": str(e)}


def _score(reachable: bool, status: int, api_count: int, api_verified: Optional[Dict], pricing: List[str], tech_count: int) -> int:
    score = 0
    if reachable: score += 20
    if status == 200: score += 10
    if api_count > 0: score += 20
    if api_verified and api_verified.get("reachable"): score += 15
    if api_verified and api_verified.get("is_json"): score += 10
    if api_verified and api_verified.get("has_cors"): score += 5
    if "developer_api" in pricing: score += 15
    if "free_tier" in pricing: score += 10
    if tech_count > 3: score += 5
    return min(score, 100)


def _search_ddg(query: str, limit: int = 4) -> List[Dict[str, str]]:
    """Search using Bing RSS format (no JS rendering required)."""
    from urllib.parse import quote, urlparse
    url = f"https://www.bing.com/search?format=rss&q={quote(query)}"
    result = _fetch(url, timeout=12)
    if not result["reachable"]:
        return []
    body = result["body"]
    # Parse RSS <link> tags
    links: List[str] = []
    for match in re.finditer(r"<link>([^<]+)</link>", body):
        link = match.group(1).strip()
        if link.startswith("http") and "bing.com" not in link and "microsoft.com" not in link:
            links.append(link)

    # Also try <item><title>...</title><link>...</link></item> pattern
    items = re.findall(r"<item>\s*<title>([^<]*)</title>\s*<link>([^<]*)</link>", body, re.DOTALL)
    results = []
    seen = set()
    for title, link in items:
        if len(results) >= limit:
            break
        link = link.strip()
        if link in seen or "bing.com" in link or "microsoft.com" in link:
            continue
        seen.add(link)
        try:
            p = urlparse(link)
            results.append({"url": f"{p.scheme}://{p.netloc}", "display_url": link, "title": title.strip() or p.netloc})
        except:
            continue

    # Fallback: use raw links if items didn't work
    if not results:
        for link in links:
            if len(results) >= limit:
                break
            if link in seen:
                continue
            seen.add(link)
            try:
                p = urlparse(link)
                results.append({"url": f"{p.scheme}://{p.netloc}", "display_url": link, "title": p.netloc})
            except:
                continue

    return results


def crawl_url(url: str) -> Dict[str, Any]:
    result = _fetch(url)
    if not result["reachable"] or "text/html" not in result.get("content_type", ""):
        return {
            "url": url, "reachable": result["reachable"], "status": result["status"],
            "content_type": result.get("content_type", ""), "meta": {}, "api_endpoints": [],
            "tech_stack": [], "external_links": [], "pricing_signals": [], "error": result["error"],
        }
    html = result["body"]
    meta = _extract_meta(html)
    api_endpoints = _extract_api_endpoints(html, url)
    tech_stack = _detect_tech_stack(html, result["headers"])
    external_links = _extract_external_links(html, url)
    pricing_signals = _extract_pricing_signals(html)
    return {
        "url": url, "reachable": True, "status": result["status"],
        "content_type": result["content_type"], "meta": meta, "api_endpoints": api_endpoints,
        "tech_stack": tech_stack, "external_links": external_links,
        "pricing_signals": pricing_signals, "html_length": len(html), "error": None,
    }


def find_competitors(niche: str, max_results: int = 6) -> List[Dict[str, Any]]:
    queries = [f"{niche} API", f"{niche} tool free", f"{niche} software platform", f"best {niche} services"]
    all_results: Dict[str, Dict] = {}
    for query in queries:
        for r in _search_ddg(query, 3):
            if r["url"] not in all_results:
                all_results[r["url"]] = {**r, "query": query}

    urls = list(all_results.values())[:max_results]
    competitors = []

    # Crawl in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_url = {executor.submit(crawl_url, r["url"]): r for r in urls}
        for future in as_completed(future_to_url):
            r = future_to_url[future]
            try:
                crawl = future.result()
            except:
                continue

            api_verified = None
            if crawl["api_endpoints"]:
                api_verified = _verify_api_endpoint(crawl["api_endpoints"][0])

            score = _score(crawl["reachable"], crawl["status"], len(crawl["api_endpoints"]),
                          api_verified, crawl["pricing_signals"], len(crawl["tech_stack"]))

            competitors.append({
                "url": r["url"],
                "title": crawl["meta"].get("title") or r["title"],
                "description": crawl["meta"].get("description") or "",
                "reachable": crawl["reachable"],
                "status": crawl["status"],
                "api_endpoints": crawl["api_endpoints"],
                "api_verified": api_verified,
                "tech_stack": crawl["tech_stack"],
                "pricing_signals": crawl["pricing_signals"],
                "external_links": crawl["external_links"],
                "score": score,
                "source_query": r["query"],
                "crawled_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            })

    competitors.sort(key=lambda c: c["score"], reverse=True)
    return competitors


# ─── Page proxy: fetch + rewrite for in-app browsing (no iframe needed) ───

def proxy_page(url: str) -> Dict[str, Any]:
    """Fetch a page server-side, strip security headers, rewrite relative URLs
    and resource references so the HTML renders correctly when served from our
    own domain. Returns clean HTML + metadata for in-app rendering.

    This replaces iframes — most sites block framing via X-Frame-Options/CSP.
    By proxying through our server, we bypass those restrictions and can
    render the content in a div or a same-origin iframe.
    """
    from urllib.parse import urlparse, urljoin

    result = _fetch(url, timeout=15)
    if not result["reachable"]:
        return {"ok": False, "error": result["error"] or f"HTTP {result['status']}", "html": ""}

    html = result["body"]
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # 1. Inject <base> tag so relative URLs resolve to the original domain
    base_tag = f'<base href="{url}">'
    if re.search(r"<head[^>]*>", html, re.IGNORECASE):
        html = re.sub(r"(<head[^>]*>)", rf"\1{base_tag}", html, count=1, flags=re.IGNORECASE)
    else:
        html = base_tag + html

    # 2. Rewrite all href links to route through our browser
    #    Links become: javascript:browseTo('original-url')
    #    This keeps navigation inside the browser-in-browser
    def _rewrite_href(match):
        val = match.group(2)
        if val.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
            return match.group(0)
        if val.startswith("//"):
            val = parsed.scheme + ":" + val
        absolute = urljoin(url, val)
        return f'{match.group(1)}="javascript:browserNavigate(\'{absolute}\')"'

    html = re.sub(r'(href)="([^"]+)"', _rewrite_href, html, flags=re.IGNORECASE)
    html = re.sub(r"(href)='([^']+)'", _rewrite_href, html, flags=re.IGNORECASE)

    # 3. Rewrite form actions to submit through proxy
    def _rewrite_form(match):
        form_tag = match.group(0)
        action_match = re.search(r'action="([^"]+)"', form_tag, re.IGNORECASE)
        if action_match:
            action_val = action_match.group(1)
            if not action_val.startswith(("javascript:", "mailto:")):
                absolute = urljoin(url, action_val)
                form_tag = form_tag.replace(action_match.group(0), f'action="javascript:browserSubmit(\'{absolute}\', this)"')
        else:
            # No action attribute — submit to current URL
            form_tag = form_tag.replace("<form", f'<form action="javascript:browserSubmit(\'{url}\', this)"', 1)
        # Add method tracking
        form_tag = form_tag.replace("<form", '<form data-proxy="1"', 1)
        return form_tag

    html = re.sub(r"<form[^>]*>", _rewrite_form, html, flags=re.IGNORECASE)

    # 4. Absolutize src attributes (images, CSS, JS) — don't route through proxy
    def _absolutize_src(match):
        attr = match.group(1)
        val = match.group(2)
        if val.startswith(("http://", "https://", "//", "data:", "javascript:", "blob:")):
            if val.startswith("//"):
                val = parsed.scheme + ":" + val
            return f'{attr}="{val}"'
        absolute = urljoin(url, val)
        return f'{attr}="{absolute}"'

    html = re.sub(r'(src)="([^"]+)"', _absolutize_src, html, flags=re.IGNORECASE)
    html = re.sub(r"(src)='([^']+)'", _absolutize_src, html, flags=re.IGNORECASE)

    # Also fix CSS url() references
    def _fix_css_url(match):
        val = match.group(1).strip().strip("'\"")
        if val.startswith(("http://", "https://", "//", "data:")):
            if val.startswith("//"):
                val = parsed.scheme + ":" + val
            return f"url({val})"
        absolute = urljoin(url, val)
        return f"url({absolute})"

    html = re.sub(r"url\(([^)]+)\)", _fix_css_url, html, flags=re.IGNORECASE)

    # 5. Remove X-Frame-Options and CSP meta tags
    html = re.sub(r'<meta[^>]+http-equiv=["\']X-Frame-Options["\'][^>]*>', "", html, re.IGNORECASE)
    html = re.sub(r'<meta[^>]+http-equiv=["\']Content-Security-Policy["\'][^>]*>', "", html, re.IGNORECASE)

    # 6. Inject browser controller script — intercepts clicks, manages navigation
    browser_script = """
<script>
// Browser-in-browser navigation controller
function browserNavigate(url) {
    if (window.parent && window.parent.browserGo) {
        window.parent.browserGo(url);
    }
}
function browserSubmit(url, form) {
    if (window.parent && window.parent.browserSubmitForm) {
        window.parent.browserSubmitForm(url, form);
    }
    return false;
}
// Intercept all clicks on links that weren't rewritten
document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a && a.href && !a.href.startsWith('javascript:')) {
        e.preventDefault();
        e.stopPropagation();
        browserNavigate(a.href);
    }
}, true);
</script>
"""
    # Insert before </body> or at end
    if re.search(r"</body>", html, re.IGNORECASE):
        html = re.sub(r"</body>", browser_script + "</body>", html, count=1, flags=re.IGNORECASE)
    else:
        html += browser_script

    # 7. Extract readable content for reader-mode display
    html_no_script = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html_no_style = re.sub(r"<style[^>]*>.*?</style>", "", html_no_script, flags=re.DOTALL | re.IGNORECASE)

    content_match = re.search(r'<(?:main|article|div[^>]*class="[^"]*(?:content|main|post|article|entry)[^"]*")[^>]*>(.*?)</(?:main|article|div)>', html_no_style, re.DOTALL | re.IGNORECASE)
    reader_html = content_match.group(1) if content_match else html_no_style

    text_only = re.sub(r"<[^>]+>", " ", reader_html)
    text_only = re.sub(r"\s+", " ", text_only).strip()
    word_count = len(text_only.split())

    images = re.findall(r'<img[^>]+src="([^"]+)"', html, re.IGNORECASE)
    headings = re.findall(r"<(h[1-3])[^>]*>([^<]+)</\1>", html_no_style, re.IGNORECASE)
    toc = [{"level": int(h[0][1]), "text": h[1].strip()} for h in headings[:20]]

    meta = _extract_meta(html)

    # Extract all links for the browser's link map
    all_links = []
    for match in re.finditer(r'javascript:browserNavigate\(\'([^\']+)\'\)', html):
        all_links.append(match.group(1))

    return {
        "ok": True,
        "url": url,
        "final_url": url,  # TODO: track redirects
        "status": result["status"],
        "title": meta.get("title") or parsed.netloc,
        "description": meta.get("description"),
        "og_image": meta.get("og_image"),
        "html": html,  # full rewritten HTML — renders in div, links route through browser
        "reader_html": reader_html[:50000],
        "word_count": word_count,
        "image_count": len(images),
        "images": images[:10],
        "toc": toc,
        "links": all_links[:50],  # all navigable links on the page
        "content_type": result.get("content_type", ""),
    }
