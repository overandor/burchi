// Netlify serverless function — proxies /api/* requests to the ChatSync backend.
// Requires CHATSYNC_URL env var (e.g. https://your-tunnel.trycloudflare.com)
//
// This replaces the Python function because Netlify's build system doesn't
// reliably detect Python functions. The JS function forwards all requests
// to the ChatSync backend and returns the response.

const CHATSYNC_URL = process.env.CHATSYNC_URL || "http://localhost:8765";

const DEFAULT_TIMEOUT_MS = 30000;
const VIDEO_TIMEOUT_MS = 120000;

export default async (req, context) => {
  // Extract the API path from the request URL.
  const url = new URL(req.url);
  const apiPath = url.pathname;
  const queryString = url.search;

  // Build the target URL.
  const targetUrl = `${CHATSYNC_URL}${apiPath}${queryString}`;

  // Determine timeout based on path (video conversion takes longer).
  const isVideoConvert = apiPath.includes("/video/convert") && req.method === "POST";
  const timeoutMs = isVideoConvert ? VIDEO_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  // Clone request headers and body.
  const init = {
    method: req.method,
    headers: {},
  };

  // Copy relevant headers.
  const reqHeaders = req.headers;
  for (const [key, value] of reqHeaders.entries()) {
    // Skip host header — the target server has its own.
    if (key.toLowerCase() !== "host") {
      init.headers[key] = value;
    }
  }

  // Forward body for POST/PUT/PATCH.
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(targetUrl, {
      ...init,
      signal: controller.signal,
    });

    clearTimeout(timer);

    // Get response body.
    const contentType = res.headers.get("content-type") || "";

    // Binary responses (video, image) — return as blob.
    if (
      contentType.includes("video/") ||
      contentType.includes("application/octet-stream") ||
      contentType.includes("image/")
    ) {
      const buffer = await res.arrayBuffer();
      return new Response(buffer, {
        status: res.status,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": res.headers.get("content-disposition") || "",
          "Cache-Control": "no-store",
        },
      });
    }

    // JSON or text responses.
    const text = await res.text();

    // If it's JSON, pass through with correct content type.
    if (contentType.includes("application/json")) {
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Markdown, SRT, or other text.
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": contentType || "text/plain" },
    });
  } catch (err) {
    const isAbort = err.name === "AbortError";
    return Response.json(
      {
        ok: false,
        error: isAbort
          ? "ChatSync backend timed out"
          : `ChatSync unreachable: ${err.message}`,
        chatsync_url: CHATSYNC_URL,
      },
      { status: isAbort ? 504 : 503 }
    );
  }
};

export const config = {
  path: "/api/*",
};
