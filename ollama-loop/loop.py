"""
24/7 Ollama inference loop — chat history → inference → cognitive market.

Pulls prompts from chat-bank (user's aggregated chat history from Devin,
Claude Code, Codex), runs inference on Ollama, and posts the generated
ideas as problems into the trichannel cognitive liquidity pool.

This is the wire: chat history → prompt → inference → problem → AMM.

Configuration via environment:
  OLLAMA_BASE_URL    target Ollama server (default: https://prism-ollama.fly.dev)
  LOOP_MODEL         model to use (default: qwen2.5:0.5b — fastest)
  LOOP_CONCURRENCY   parallel requests (default: 2)
  LOOP_INTERVAL      seconds between requests (default: 5)
  CHAT_BANK_URL      chat-bank API (default: https://chat-bank.fly.dev)
  TRICHANNEL_URL     trichannel cognitive market (default: https://trichannel.fly.dev)
  INGEST             post results to trichannel (default: 1)
  PORT               health endpoint port (default: 8000)
"""

import os
import json
import time
import asyncio
import urllib.request
import urllib.error
import signal
import threading
import re
from collections import deque

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "https://prism-ollama.fly.dev")
LOOP_MODEL = os.environ.get("LOOP_MODEL", "qwen2.5:0.5b")
LOOP_CONCURRENCY = int(os.environ.get("LOOP_CONCURRENCY", "2"))
LOOP_INTERVAL = float(os.environ.get("LOOP_INTERVAL", "5"))
CHAT_BANK_URL = os.environ.get("CHAT_BANK_URL", "https://chat-bank.fly.dev")
TRICHANNEL_URL = os.environ.get("TRICHANNEL_URL", "https://trichannel.fly.dev")
INGEST = os.environ.get("INGEST", "1") == "1"
PORT = int(os.environ.get("PORT", "8000"))

running = True

# Stats (rolling 5-minute window)
stats_lock = threading.Lock()
stats = {
    "total_requests": 0,
    "total_errors": 0,
    "total_tokens": 0,
    "total_duration_ns": 0,
    "total_ingested": 0,
    "total_ingest_errors": 0,
    "recent_latencies": deque(maxlen=100),
    "started_at": time.time(),
    "last_error": None,
    "last_success": None,
    "last_ingest": None,
}


def update_stat(key, value):
    with stats_lock:
        if key in stats:
            if isinstance(stats[key], deque):
                stats[key].append(value)
            elif isinstance(stats[key], (int, float)):
                stats[key] += value
            else:
                stats[key] = value
        else:
            stats[key] = value


def get_prompt():
    """Get a prompt from chat-bank API. Returns (prompt, source) or (fallback, 'static')."""
    try:
        req = urllib.request.Request(f"{CHAT_BANK_URL}/api/random", method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            prompt = data.get("prompt", "")
            source = data.get("source", "chat-bank")
            # Clean: strip XML tags, truncate for small models
            prompt = re.sub(r'<[^>]+>', '', prompt).strip()
            prompt = prompt.replace('\n', ' ')[:300]
            if len(prompt) < 10:
                return None, None
            return prompt, source
    except Exception:
        return None, None


def ingest_to_trichannel(text, source):
    """POST generated idea to trichannel as a problem."""
    if not INGEST or not text or len(text) < 20:
        return False
    try:
        body = json.dumps({
            "text": text,
            "source": f"ollama-loop:{source}",
            "funder": "0xloop",
            "bounty": 100,
        }).encode()
        req = urllib.request.Request(
            f"{TRICHANNEL_URL}/cog-liquidity/ingest",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if data.get("status") == "ingested":
                update_stat("total_ingested", 1)
                update_stat("last_ingest", time.time())
                return True
    except Exception as e:
        update_stat("total_ingest_errors", 1)
    return False


def do_inference():
    """Pull prompt from chat-bank, run inference, ingest result to trichannel.
    Returns (success, tokens, duration_ns)."""
    prompt, source = get_prompt()
    if not prompt:
        # No prompt available — skip this cycle
        return False, 0, 0

    # Ask the model to turn the chat prompt into a problem statement
    full_prompt = (
        f"Based on this idea from a developer's chat history, "
        f"write a clear problem statement (1-2 sentences) that could be solved "
        f"with software:\n\n{prompt}\n\nProblem statement:"
    )

    body = json.dumps({
        "model": LOOP_MODEL,
        "prompt": full_prompt,
        "stream": False,
        "options": {"temperature": 0.7, "num_predict": 100},
    }).encode()

    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            tokens = data.get("eval_count", 0)
            duration = data.get("total_duration", 0)
            response_text = data.get("response", "").strip()

            # Ingest the generated problem statement to trichannel
            if response_text and len(response_text) > 20:
                ingest_to_trichannel(response_text, source)

            return True, tokens, duration
    except urllib.error.HTTPError as e:
        update_stat("last_error", f"HTTP {e.code}: {e.reason}")
        return False, 0, 0
    except urllib.error.URLError as e:
        update_stat("last_error", f"URL error: {e.reason}")
        return False, 0, 0
    except Exception as e:
        update_stat("last_error", str(e))
        return False, 0, 0


async def worker(worker_id: int):
    """Single worker loop — fires requests continuously."""
    global running
    while running:
        start = time.time()

        success, tokens, duration = await asyncio.to_thread(do_inference)

        if success:
            update_stat("total_requests", 1)
            update_stat("total_tokens", tokens)
            update_stat("total_duration_ns", duration)
            update_stat("recent_latencies", time.time() - start)
            update_stat("last_success", time.time())
        else:
            update_stat("total_errors", 1)

        # Brief pause to prevent overwhelming
        if LOOP_INTERVAL > 0:
            await asyncio.sleep(LOOP_INTERVAL)
        else:
            await asyncio.sleep(0.1)  # 100ms minimum between requests per worker


async def monitor():
    """Print stats every 30 seconds."""
    global running
    while running:
        await asyncio.sleep(30)
        with stats_lock:
            uptime = time.time() - stats["started_at"]
            reqs = stats["total_requests"]
            errors = stats["total_errors"]
            tokens = stats["total_tokens"]
            latencies = list(stats["recent_latencies"])

            avg_latency = sum(latencies) / len(latencies) if latencies else 0
            rps = reqs / uptime if uptime > 0 else 0
            tps = tokens / uptime if uptime > 0 else 0
            error_rate = (errors / (reqs + errors) * 100) if (reqs + errors) > 0 else 0

            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"uptime={uptime:.0f}s reqs={reqs} errors={errors} ({error_rate:.1f}%) "
                  f"tokens={tokens} rps={rps:.1f} tps={tps:.1f} "
                  f"avg_latency={avg_latency:.2f}s "
                  f"model={LOOP_MODEL} workers={LOOP_CONCURRENCY}")


def handle_sigterm(signum, frame):
    global running
    print("\nReceived SIGTERM — shutting down gracefully...")
    running = False


signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)


# ── Health/stats HTTP server ────────────────────────────────────

async def health_server():
    """Minimal HTTP server for health checks and stats."""
    from asyncio import start_server

    async def handle(reader, writer):
        data = await reader.read(1024)
        request_line = data.decode().split("\r\n")[0]
        path = request_line.split(" ")[1] if " " in request_line else "/"

        if path == "/health":
            body = json.dumps({"status": "running", "model": LOOP_MODEL,
                               "workers": LOOP_CONCURRENCY})
        elif path == "/stats":
            with stats_lock:
                uptime = time.time() - stats["started_at"]
                latencies = list(stats["recent_latencies"])
                body = json.dumps({
                    "status": "running",
                    "uptime_seconds": uptime,
                    "total_requests": stats["total_requests"],
                    "total_errors": stats["total_errors"],
                    "total_tokens": stats["total_tokens"],
                    "total_ingested": stats["total_ingested"],
                    "total_ingest_errors": stats["total_ingest_errors"],
                    "requests_per_second": stats["total_requests"] / uptime if uptime > 0 else 0,
                    "tokens_per_second": stats["total_tokens"] / uptime if uptime > 0 else 0,
                    "avg_latency_seconds": sum(latencies) / len(latencies) if latencies else 0,
                    "model": LOOP_MODEL,
                    "concurrency": LOOP_CONCURRENCY,
                    "chat_bank_url": CHAT_BANK_URL,
                    "trichannel_url": TRICHANNEL_URL,
                    "ingest_enabled": INGEST,
                    "last_error": stats["last_error"],
                    "last_success": stats["last_success"],
                    "last_ingest": stats["last_ingest"],
                }, indent=2)
        else:
            body = "OK"

        response = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}"
        writer.write(response.encode())
        await writer.drain()
        writer.close()

    server = await start_server(handle, "0.0.0.0", PORT)
    print(f"Health/stats server on :{PORT} (/health, /stats)")
    async with server:
        await server.serve_forever()


async def main():
    print(f"Starting 24/7 Ollama loop")
    print(f"  Target: {OLLAMA_BASE_URL}")
    print(f"  Model: {LOOP_MODEL}")
    print(f"  Concurrency: {LOOP_CONCURRENCY} workers")
    print(f"  Interval: {LOOP_INTERVAL}s")
    print()

    # Start health server
    health_task = asyncio.create_task(health_server())

    # Start monitor
    monitor_task = asyncio.create_task(monitor())

    # Start workers
    workers = [asyncio.create_task(worker(i)) for i in range(LOOP_CONCURRENCY)]

    # Wait for shutdown
    await asyncio.gather(*workers, monitor_task, health_task, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
