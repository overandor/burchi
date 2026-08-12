import os
import sys
import json
from pathlib import Path
from urllib.parse import urlparse

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "_backend"))

# Set serverless DB path
os.environ.setdefault("CHATSYNC_DB_PATH", "/tmp/chatsync.db")

from main import app
import httpx


def handler(event, context):
    """Netlify Python function handler — proxies to FastAPI ASGI app."""
    import asyncio

    http_method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    headers = event.get("headers", {})
    query_string = event.get("queryStringParameters", {}) or {}
    body = event.get("body", "") or ""
    is_base64 = event.get("isBase64Encoded", False)

    # Build raw query string
    if query_string:
        from urllib.parse import urlencode
        raw_qs = urlencode(query_string)
    else:
        raw_qs = ""

    # Construct scope for ASGI
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": http_method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": raw_qs.encode("utf-8"),
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("127.0.0.1", 0),
        "server": ("0.0.0.0", 443),
    }

    if is_base64:
        import base64
        body_bytes = base64.b64decode(body)
    else:
        body_bytes = body.encode("utf-8")

    # Collect response
    response_body = b""
    response_status = 200
    response_headers = {}

    async def receive():
        return {
            "type": "http.request",
            "body": body_bytes,
            "more_body": False,
        }

    async def send(message):
        nonlocal response_body, response_status, response_headers
        if message["type"] == "http.response.start":
            response_status = message["status"]
            for k, v in message.get("headers", []):
                response_headers[k.decode()] = v.decode()
        elif message["type"] == "http.response.body":
            response_body += message.get("body", b"")

    async def run():
        await app(scope, receive, send)

    asyncio.run(run())

    # Check if response is binary
    content_type = response_headers.get("content-type", "")
    is_binary = "image" in content_type or "font" in content_type

    if is_binary:
        import base64
        encoded_body = base64.b64encode(response_body).decode("utf-8")
        return {
            "statusCode": response_status,
            "headers": response_headers,
            "body": encoded_body,
            "isBase64Encoded": True,
        }

    return {
        "statusCode": response_status,
        "headers": response_headers,
        "body": response_body.decode("utf-8", errors="replace"),
    }
