"""BurchiWeb — API routes and web UI."""

import asyncio
import json
import time
from typing import Any, Dict

from flask import Blueprint, Response, jsonify, render_template, request

from .burchi import BurchiBrowser, CrawlConfig, CrawledPage

bp = Blueprint("burchi", __name__)


def _run_async(coro):
    """Run an async coroutine in a fresh event loop (thread-safe)."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _json_response(data: Any, status: int = 200) -> Response:
    return Response(json.dumps(data, indent=2, default=str), status=status, mimetype="application/json")


def _error(msg: str, status: int = 400) -> Response:
    return _json_response({"error": msg}, status)


# ── Web UI ─────────────────────────────────────────────────────────────────────

@bp.route("/")
def index():
    return render_template("index.html")


# ── Health ────────────────────────────────────────────────────────────────────

@bp.route("/health")
def health():
    return _json_response({"status": "ok", "service": "burchi-web", "version": "4.0"})


# ── API Endpoints ──────────────────────────────────────────────────────────────

@bp.route("/api/digest")
def api_digest():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")
    max_el = int(request.args.get("max", "100"))

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            result = await browser.digest(max_elements=max_el)
            return _json_response({"url": browser.url, "title": await browser._page.title(), "digest": result})
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/markdown")
def api_markdown():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            md = await browser.to_markdown()
            return _json_response({"url": browser.url, "title": await browser._page.title(), "markdown": md})
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/find")
def api_find():
    url = request.args.get("url")
    intent = request.args.get("intent")
    if not url or not intent:
        return _error("Missing 'url' or 'intent' parameter")
    top_k = int(request.args.get("top", "5"))

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            await browser.build_index()
            matches = await browser.find(intent, top_k=top_k)
            return _json_response(json.loads(browser._matches_to_json(matches)))
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/smart")
def api_smart():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            result = await browser.smart_extract()
            return _json_response(result)
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/ask")
def api_ask():
    url = request.args.get("url")
    intent = request.args.get("intent")
    if not url or not intent:
        return _error("Missing 'url' or 'intent' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            result = await browser.ask(intent)
            return _json_response(result)
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/script", methods=["POST"])
def api_script():
    body = request.get_json(silent=True)
    if not body or not isinstance(body, list):
        return _error("Expected JSON array of actions")

    async def _do():
        browser = BurchiBrowser()
        try:
            results = await browser.execute_script(body)
            return _json_response(results)
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/site")
def api_site():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")
    depth = int(request.args.get("depth", "3"))
    max_pages = int(request.args.get("max", "50"))
    delay = float(request.args.get("delay", "0.5"))
    fmt = request.args.get("format", "markdown")

    async def _do():
        browser = BurchiBrowser()
        try:
            config = CrawlConfig(max_depth=depth, max_pages=max_pages, delay=delay, output_format=fmt)
            pages = await browser.crawl_site(url, config=config)
            result = []
            for p in pages:
                entry: Dict[str, Any] = {"url": p.url, "title": p.title, "depth": p.depth, "success": p.success}
                if p.success:
                    entry["content"] = p.content
                    entry["links"] = p.links
                    entry["metadata"] = p.metadata
                    entry["content_hash"] = p.content_hash
                else:
                    entry["error"] = p.error or "Unknown error"
                result.append(entry)
            return _json_response(result)
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/sitemap")
def api_sitemap():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            urls = await browser.parse_sitemap(url)
            return _json_response({"url": url, "count": len(urls), "urls": urls})
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/crawl")
def api_crawl():
    urls_param = request.args.get("urls")
    if not urls_param:
        return _error("Missing 'urls' parameter (comma-separated)")
    urls = [u.strip() for u in urls_param.split(",") if u.strip()]

    async def _do():
        browser = BurchiBrowser()
        try:
            results = await browser.crawl(urls)
            return _json_response(results)
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/snapshot")
def api_snapshot():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")
    intent = request.args.get("intent")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            result = await browser._snapshot(intent if intent else None)
            return _json_response({"url": browser.url, "snapshot": result})
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/links")
def api_links():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            links = await browser.extract_links()
            return _json_response({"url": browser.url, "links": links})
        finally:
            await browser.close()

    return _run_async(_do())


@bp.route("/api/metadata")
def api_metadata():
    url = request.args.get("url")
    if not url:
        return _error("Missing 'url' parameter")

    async def _do():
        browser = BurchiBrowser()
        try:
            if not await browser.goto(url):
                return _error("Navigation failed", 502)
            meta = await browser.extract_metadata()
            return _json_response({"url": browser.url, "metadata": meta})
        finally:
            await browser.close()

    return _run_async(_do())
