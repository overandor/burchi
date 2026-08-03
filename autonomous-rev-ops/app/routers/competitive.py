"""Competitive inference router — real streaming race with actual task cancellation.

NOT a mock. The race:
1. Opens SSE streaming connections to N inference workers simultaneously
2. Reads tokens as they arrive from each worker in real time
3. Once a worker produces enough tokens to evaluate, scores it
4. As soon as >=2 workers are scored (or timeout), picks the winner
5. Actually calls asyncio.Task.cancel() on losing tasks — aborts HTTP connections
6. CancelledError is caught inside every worker, reporting partial output
7. Only the winner continues streaming to full max_tokens
8. Returns proof fields: cancellation timestamps, tokens before cancellation,
   tokens avoided, winner, per-worker latency
9. Thompson Sampling bandit learns from race outcomes + user preferences
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import store_gguf as store
from app.auth_gguf import verify_api_key
from app.router import get_router
from app.preference_loop import get_pipeline

router = APIRouter(prefix="/api/competitive", tags=["competitive"])

# Local workers (2080 Ti fleet) take priority; remote workers are fallback
LOCAL_WORKERS = [
    {"worker_id": "worker-A", "url": "http://localhost:8110"},
    {"worker_id": "worker-B", "url": "http://localhost:8111"},
    {"worker_id": "worker-local-8102", "url": "http://localhost:8102"},
    {"worker_id": "worker-local-8103", "url": "http://localhost:8103"},
]
REMOTE_WORKERS = [
    {"worker_id": "worker-p2p", "url": "https://gguf-p2p-deploy.vercel.app"},
    {"worker_id": "worker-serverless", "url": "https://gguf-serverless-poc.vercel.app"},
    {"worker_id": "worker-vercel-poc", "url": "https://gguf-vercel-poc.vercel.app"},
]
KNOWN_WORKERS = LOCAL_WORKERS + REMOTE_WORKERS
FALLBACK_WORKERS = [LOCAL_WORKERS[0]] if LOCAL_WORKERS else REMOTE_WORKERS[:1]

# Winner selection: once this many workers are scored, pick best and cancel rest
_MIN_SCORED_TO_DECIDE = 2
# If not enough workers scored by this timeout, decide with what we have
_DECIDE_TIMEOUT_S = 30.0


class RaceRequest(BaseModel):
    prompt: str
    model_id: str = "qwen2-0.5b-q3k"
    num_workers: int = 2
    partial_tokens: int = 32
    max_tokens: int = 128
    temperature: float = 0.7
    system_prompt: Optional[str] = None


class CancellationProof(BaseModel):
    worker_id: str
    cancelled_at: str  # ISO timestamp
    tokens_before_cancellation: int
    tokens_avoided: int  # max_tokens - tokens_before_cancellation
    task_was_alive: bool  # was the asyncio.Task still running when cancelled?
    latency_ms: int


class WorkerResult(BaseModel):
    worker_id: str
    score: float
    tokens: int
    latency_ms: int
    status: str  # "winner" | "cancelled" | "failed" | "timeout"


class RaceResponse(BaseModel):
    race_id: str
    status: str
    winner: Optional[dict] = None
    final_response: str = ""
    workers: list[WorkerResult] = []
    total_elapsed_ms: int = 0
    tokens_saved: int = 0
    cancellation_events: list[CancellationProof] = []
    decision_reason: str = ""  # "first_past_post" | "timeout" | "all_done" | "single_worker"


class PreferenceRequest(BaseModel):
    race_id: str
    worker_id: str


def _select_workers(num: int, prompt: str = "") -> list[dict]:
    """Select workers using the contextual router (LinTS over prompt features).

    Falls back to non-contextual Thompson Sampling if the contextual router
    has no data yet, or to the default worker list if no stats exist at all.
    """
    # Try contextual router first — uses prompt features to pick the best workers
    if prompt:
        try:
            router = get_router()
            # Filter to workers that have stats OR are local (always available)
            available = KNOWN_WORKERS
            selected = router.select_workers(prompt, available, num)
            if selected:
                return selected
        except Exception:
            pass  # Fall through to legacy selection

    # Legacy: non-contextual Thompson Sampling from Beta(alpha, beta)
    stats = store.list_worker_stats()
    if not stats:
        return KNOWN_WORKERS[:num]
    scored = []
    for s in stats:
        sample = random.betavariate(max(s["alpha"], 0.01), max(s["beta"], 0.01))
        scored.append((sample, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [{"worker_id": s["worker_id"], "url": s["worker_url"]} for _, s in scored[:num]]
    while len(selected) < num:
        for w in KNOWN_WORKERS:
            if w["worker_id"] not in [s["worker_id"] for s in selected]:
                selected.append(w)
                break
        else:
            break
    return selected[:num]


def _evaluate_partial(text: str, prompt: str) -> float:
    """Score a partial generation — higher is better."""
    if not text or not text.strip():
        return 0.0
    words = text.split()
    wc = len(words)
    if wc == 0:
        return 0.0
    length_score = min(math.log(wc + 1) / math.log(50), 1.0)
    unique = set(w.lower() for w in words)
    rep_ratio = len(unique) / wc
    prompt_words = set(w.lower() for w in prompt.split())
    overlap = len(unique & prompt_words) / max(len(prompt_words), 1)
    completeness = 0.1 if text.rstrip().endswith((".", "!", "?", " ", "\n")) else 0.0
    return round(0.3 * length_score + 0.3 * rep_ratio + 0.2 * overlap + 0.1 * completeness + 0.1 * (wc / 50), 4)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _stream_worker(
    worker_url: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
    result_queue: asyncio.Queue,
    worker_id: str,
) -> None:
    """Stream tokens from a single worker via SSE.

    Pushes incremental results to result_queue as tokens arrive.
    Handles CancelledError — reports partial output when cancelled.
    """
    t0 = time.time()
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    accumulated = ""
    token_count = 0

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{worker_url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": "gguf-model",
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": True,
                },
            ) as resp:
                if not resp.is_success:
                    await result_queue.put({
                        "worker_id": worker_id, "type": "error",
                        "error": f"HTTP {resp.status_code}",
                        "elapsed_ms": int((time.time() - t0) * 1000),
                    })
                    return

                async for line in resp.aiter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            chunk = json.loads(line[6:])
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                accumulated += content
                                token_count += 1
                                await result_queue.put({
                                    "worker_id": worker_id, "type": "token",
                                    "text": accumulated, "tokens": token_count,
                                    "elapsed_ms": int((time.time() - t0) * 1000),
                                })
                        except (json.JSONDecodeError, IndexError):
                            pass

                await result_queue.put({
                    "worker_id": worker_id, "type": "done",
                    "text": accumulated, "tokens": token_count,
                    "elapsed_ms": int((time.time() - t0) * 1000),
                })

    except asyncio.CancelledError:
        # Task was actually cancelled by the race coordinator.
        # Report exactly what we got before cancellation.
        await result_queue.put({
            "worker_id": worker_id, "type": "cancelled",
            "text": accumulated, "tokens": token_count,
            "elapsed_ms": int((time.time() - t0) * 1000),
            "cancelled_at": _now_iso(),
        })
        # Re-raise so asyncio knows we handled it
        raise
    except httpx.ReadTimeout:
        await result_queue.put({
            "worker_id": worker_id, "type": "timeout",
            "text": accumulated, "tokens": token_count,
            "elapsed_ms": int((time.time() - t0) * 1000),
        })
    except Exception as e:
        await result_queue.put({
            "worker_id": worker_id, "type": "error",
            "error": str(e), "text": accumulated,
            "tokens": token_count,
            "elapsed_ms": int((time.time() - t0) * 1000),
        })


@router.post("/race", response_model=RaceResponse)
async def competitive_race(body: RaceRequest, key_info: dict = Depends(verify_api_key)):
    """Run a real competitive inference race with streaming + actual task cancellation.

    Winner selection fires BEFORE all workers finish:
    - As each worker crosses partial_tokens, score it
    - Once >=2 workers are scored (or timeout), pick best score as winner
    - Immediately call task.cancel() on all losing tasks
    - CancelledError is caught in workers, reporting partial output
    - Winner continues streaming to completion
    - Returns proof: cancellation timestamps, tokens before/after, per-worker latency
    """
    t0 = time.time()
    workers = _select_workers(body.num_workers, body.prompt)
    if not workers:
        workers = FALLBACK_WORKERS

    race = store.create_race(body.prompt, body.model_id, len(workers), body.partial_tokens)
    race_id = race["id"]
    for w in workers:
        store.add_race_worker(race_id, w["worker_id"], w["url"])
        store.get_or_create_worker_stats(w["worker_id"], w["url"])

    result_queue: asyncio.Queue = asyncio.Queue()
    task_map: dict[str, asyncio.Task] = {}
    for w in workers:
        task = asyncio.create_task(
            _stream_worker(
                w["url"], body.prompt, body.system_prompt or "",
                body.max_tokens, body.temperature,
                result_queue, w["worker_id"],
            )
        )
        task_map[w["worker_id"]] = task

    worker_texts = {w["worker_id"]: "" for w in workers}
    worker_tokens = {w["worker_id"]: 0 for w in workers}
    worker_elapsed = {w["worker_id"]: 0 for w in workers}
    worker_status = {w["worker_id"]: "streaming" for w in workers}
    scored_workers: dict[str, float] = {}
    cancellation_events: list[CancellationProof] = []
    winner_id: Optional[str] = None
    decision_reason = ""

    deadline = time.time() + _DECIDE_TIMEOUT_S
    while winner_id is None:
        remaining = deadline - time.time()
        if remaining <= 0:
            if scored_workers:
                winner_id = max(scored_workers, key=scored_workers.get)
                decision_reason = "timeout"
            else:
                for wid in worker_texts:
                    if worker_texts[wid]:
                        scored_workers[wid] = _evaluate_partial(worker_texts[wid], body.prompt)
                        worker_status[wid] = "scored"
                if scored_workers:
                    winner_id = max(scored_workers, key=scored_workers.get)
                    decision_reason = "timeout"
                else:
                    decision_reason = "all_failed"
                break
            break

        try:
            msg = await asyncio.wait_for(result_queue.get(), timeout=remaining)
        except asyncio.TimeoutError:
            continue

        wid = msg["worker_id"]
        mtype = msg["type"]

        if mtype == "token":
            worker_texts[wid] = msg["text"]
            worker_tokens[wid] = msg["tokens"]
            worker_elapsed[wid] = msg["elapsed_ms"]
            if wid not in scored_workers and msg["tokens"] >= body.partial_tokens:
                score = _evaluate_partial(msg["text"], body.prompt)
                scored_workers[wid] = score
                worker_status[wid] = "scored"
                store.update_race_worker(race_id, wid, {
                    "partial_text": msg["text"][:500], "score": score,
                    "status": "scored", "tokens_generated": msg["tokens"],
                    "elapsed_ms": msg["elapsed_ms"],
                })
                if len(scored_workers) >= min(_MIN_SCORED_TO_DECIDE, len(workers)):
                    winner_id = max(scored_workers, key=scored_workers.get)
                    decision_reason = "first_past_post"
                    break

        elif mtype == "done":
            if wid not in scored_workers:
                worker_texts[wid] = msg["text"]
                worker_tokens[wid] = msg["tokens"]
                worker_elapsed[wid] = msg["elapsed_ms"]
                score = _evaluate_partial(msg["text"], body.prompt)
                scored_workers[wid] = score
                worker_status[wid] = "done"
                store.update_race_worker(race_id, wid, {
                    "partial_text": msg["text"][:500], "score": score,
                    "status": "done", "tokens_generated": msg["tokens"],
                    "elapsed_ms": msg["elapsed_ms"],
                })
                if len(scored_workers) >= min(_MIN_SCORED_TO_DECIDE, len(workers)):
                    winner_id = max(scored_workers, key=scored_workers.get)
                    decision_reason = "first_past_post"
                    break
                if len(scored_workers) >= len(workers):
                    winner_id = max(scored_workers, key=scored_workers.get)
                    decision_reason = "all_done"
                    break

        elif mtype in ("error", "timeout", "cancelled"):
            if wid not in scored_workers:
                worker_texts[wid] = msg.get("text", "")
                worker_tokens[wid] = msg.get("tokens", 0)
                worker_elapsed[wid] = msg.get("elapsed_ms", 0)
                scored_workers[wid] = 0.0
                worker_status[wid] = mtype
                store.update_race_worker(race_id, wid, {
                    "partial_text": msg.get("text", "")[:500], "score": 0.0,
                    "status": mtype, "tokens_generated": msg.get("tokens", 0),
                    "elapsed_ms": msg.get("elapsed_ms", 0),
                })
                if len(scored_workers) >= len(workers):
                    if any(worker_texts[w] for w in worker_texts):
                        winner_id = max(scored_workers, key=scored_workers.get)
                        decision_reason = "all_done"
                    else:
                        decision_reason = "all_failed"
                    break

    if decision_reason == "all_failed" or winner_id is None:
        store.complete_race(race_id, "", "All workers failed", int((time.time() - t0) * 1000), 0)
        return RaceResponse(
            race_id=race_id, status="failed", final_response="",
            decision_reason=decision_reason,
            total_elapsed_ms=int((time.time() - t0) * 1000),
        )

    # CANCEL LOSING WORKERS — actual asyncio.Task.cancel()
    cancel_timestamp = _now_iso()
    for wid, task in task_map.items():
        if wid == winner_id:
            continue
        was_alive = not task.done()
        if was_alive:
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

        tokens_before = worker_tokens[wid]
        tokens_avoided = max(0, body.max_tokens - tokens_before)
        cancellation_events.append(CancellationProof(
            worker_id=wid,
            cancelled_at=cancel_timestamp,
            tokens_before_cancellation=tokens_before,
            tokens_avoided=tokens_avoided,
            task_was_alive=was_alive,
            latency_ms=worker_elapsed[wid],
        ))
        worker_status[wid] = "cancelled"
        store.update_race_worker(race_id, wid, {"status": "cancelled"})

    # WINNER CONTINUES — drain remaining tokens
    winner_final_text = worker_texts[winner_id]
    winner_task = task_map[winner_id]
    if not winner_task.done():
        while True:
            try:
                msg = await asyncio.wait_for(result_queue.get(), timeout=5.0)
                if msg["worker_id"] == winner_id and msg["type"] in ("token", "done"):
                    winner_final_text = msg.get("text", winner_final_text)
                    worker_elapsed[winner_id] = msg.get("elapsed_ms", worker_elapsed[winner_id])
                    if msg["type"] == "done":
                        break
            except asyncio.TimeoutError:
                break

    if not winner_task.done():
        winner_task.cancel()
        try:
            await winner_task
        except asyncio.CancelledError:
            pass

    total_ms = int((time.time() - t0) * 1000)
    tokens_saved = sum(c.tokens_avoided for c in cancellation_events)

    store.complete_race(race_id, winner_id, winner_final_text, total_ms, tokens_saved)
    for wid, score in scored_workers.items():
        won = wid == winner_id
        store.update_worker_stats(wid, won, score, worker_elapsed[wid])
    store.log_event("competitive_race", model_id=body.model_id, metadata={
        "race_id": race_id, "winner": winner_id,
        "tokens_saved": tokens_saved, "total_ms": total_ms,
        "decision_reason": decision_reason,
        "workers_cancelled": len(cancellation_events),
    })

    # ─── Feed the preference loop ───────────────────────────────────────
    # Record race outcome as preference pairs, train ranker, update router
    try:
        pipeline = get_pipeline()
        pipeline.record_race_outcome(
            race_id=race_id,
            prompt=body.prompt,
            workers=workers,
            winner_id=winner_id,
            scores=scored_workers,
            texts=worker_texts,
        )
    except Exception:
        pass  # Don't fail the race if preference loop errors

    worker_results = []
    for w in workers:
        wid = w["worker_id"]
        worker_results.append(WorkerResult(
            worker_id=wid,
            score=scored_workers.get(wid, 0.0),
            tokens=worker_tokens[wid],
            latency_ms=worker_elapsed[wid],
            status="winner" if wid == winner_id else worker_status.get(wid, "unknown"),
        ))

    return RaceResponse(
        race_id=race_id, status="completed",
        winner={
            "worker_id": winner_id,
            "score": scored_workers[winner_id],
            "partial_text": worker_texts[winner_id][:200],
            "latency_ms": worker_elapsed[winner_id],
        },
        final_response=winner_final_text,
        workers=worker_results,
        total_elapsed_ms=total_ms,
        tokens_saved=tokens_saved,
        cancellation_events=cancellation_events,
        decision_reason=decision_reason,
    )


@router.post("/race/stream")
async def competitive_race_stream(body: RaceRequest, key_info: dict = Depends(verify_api_key)):
    """Stream a competitive race in real time via SSE.

    Events: start, token, scored, cancelled, winner, final, [DONE]
    """
    workers = _select_workers(body.num_workers, body.prompt)
    if not workers:
        workers = FALLBACK_WORKERS
    race = store.create_race(body.prompt, body.model_id, len(workers), body.partial_tokens)
    race_id = race["id"]
    for w in workers:
        store.add_race_worker(race_id, w["worker_id"], w["url"])
        store.get_or_create_worker_stats(w["worker_id"], w["url"])

    async def generate():
        yield f"data: {json.dumps({'type':'start','race_id':race_id,'workers':[w['worker_id'] for w in workers]})}\n\n"
        result_queue: asyncio.Queue = asyncio.Queue()
        task_map: dict[str, asyncio.Task] = {}
        for w in workers:
            task = asyncio.create_task(
                _stream_worker(w["url"], body.prompt, body.system_prompt or "",
                               body.max_tokens, body.temperature,
                               result_queue, w["worker_id"])
            )
            task_map[w["worker_id"]] = task
        worker_texts = {w["worker_id"]: "" for w in workers}
        worker_tokens = {w["worker_id"]: 0 for w in workers}
        scored: dict[str, float] = {}
        winner_id: Optional[str] = None
        t0 = time.time()
        deadline = time.time() + _DECIDE_TIMEOUT_S
        while winner_id is None:
            remaining = deadline - time.time()
            if remaining <= 0:
                for wid in worker_texts:
                    if worker_texts[wid] and wid not in scored:
                        scored[wid] = _evaluate_partial(worker_texts[wid], body.prompt)
                if scored:
                    winner_id = max(scored, key=scored.get)
                break
            try:
                msg = await asyncio.wait_for(result_queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                continue
            wid = msg["worker_id"]
            mtype = msg["type"]
            if mtype == "token":
                worker_texts[wid] = msg["text"]
                worker_tokens[wid] = msg["tokens"]
                yield f"data: {json.dumps({'type':'token','worker_id':wid,'text':msg['text'][-100:],'tokens':msg['tokens']})}\n\n"
                if wid not in scored and msg["tokens"] >= body.partial_tokens:
                    score = _evaluate_partial(msg["text"], body.prompt)
                    scored[wid] = score
                    yield f"data: {json.dumps({'type':'scored','worker_id':wid,'score':score})}\n\n"
                    if len(scored) >= min(_MIN_SCORED_TO_DECIDE, len(workers)):
                        winner_id = max(scored, key=scored.get)
                        break
            elif mtype == "done" and wid not in scored:
                worker_texts[wid] = msg["text"]
                worker_tokens[wid] = msg["tokens"]
                score = _evaluate_partial(msg["text"], body.prompt)
                scored[wid] = score
                yield f"data: {json.dumps({'type':'scored','worker_id':wid,'score':score})}\n\n"
                if len(scored) >= min(_MIN_SCORED_TO_DECIDE, len(workers)):
                    winner_id = max(scored, key=scored.get)
                    break
            elif mtype in ("error", "timeout", "cancelled") and wid not in scored:
                scored[wid] = 0.0
                if len(scored) >= len(workers):
                    if any(worker_texts[w] for w in worker_texts):
                        winner_id = max(scored, key=scored.get)
                    break
        if winner_id:
            yield f"data: {json.dumps({'type':'winner','worker_id':winner_id})}\n\n"
            for wid, task in task_map.items():
                if wid != winner_id:
                    was_alive = not task.done()
                    if was_alive:
                        task.cancel()
                        try:
                            await asyncio.wait_for(task, timeout=2.0)
                        except (asyncio.CancelledError, asyncio.TimeoutError):
                            pass
                    yield f"data: {json.dumps({'type':'cancelled','worker_id':wid,'tokens_wasted':worker_tokens[wid],'task_was_alive':was_alive})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(result_queue.get(), timeout=5.0)
                    if msg["worker_id"] == winner_id and msg["type"] in ("token", "done"):
                        worker_texts[winner_id] = msg.get("text", worker_texts[winner_id])
                except asyncio.TimeoutError:
                    break
            if not task_map[winner_id].done():
                task_map[winner_id].cancel()
                try:
                    await task_map[winner_id]
                except asyncio.CancelledError:
                    pass
            total_ms = int((time.time() - t0) * 1000)
            tokens_saved = sum(worker_tokens[w["worker_id"]] for w in workers if w["worker_id"] != winner_id)
            store.complete_race(race_id, winner_id, worker_texts[winner_id], total_ms, tokens_saved)
            yield f"data: {json.dumps({'type':'final','text':worker_texts[winner_id],'tokens_saved':tokens_saved,'total_ms':total_ms})}\n\n"
        else:
            yield f"data: {json.dumps({'type':'failed','error':'No worker produced output'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/preference")
async def set_preference(body: PreferenceRequest, key_info: dict = Depends(verify_api_key)):
    race = store.get_race(body.race_id)
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    store.set_user_preference(body.race_id, body.worker_id)
    store.log_event("user_preference", metadata={"race_id": body.race_id, "worker_id": body.worker_id})

    # Feed user preference into the preference loop (data flywheel)
    try:
        pipeline = get_pipeline()
        race_workers = [
            {"worker_id": w["worker_id"], "url": w["worker_url"]}
            for w in race.get("workers", [])
        ]
        texts = {w["worker_id"]: w.get("partial_text", "") for w in race.get("workers", [])}
        feedback = pipeline.record_user_preference(
            race_id=body.race_id,
            prompt=race.get("prompt", ""),
            chosen_worker_id=body.worker_id,
            all_workers=race_workers,
            texts=texts,
        )
        return {
            "ok": True, "race_id": body.race_id, "preferred_worker": body.worker_id,
            "feedback": feedback,
        }
    except Exception as e:
        return {
            "ok": True, "race_id": body.race_id, "preferred_worker": body.worker_id,
            "feedback_error": str(e),
        }


@router.get("/races")
async def list_races(limit: int = 20, key_info: dict = Depends(verify_api_key)):
    return store.list_races(limit)


@router.get("/races/{race_id}")
async def get_race(race_id: str, key_info: dict = Depends(verify_api_key)):
    race = store.get_race(race_id)
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    return race


@router.get("/workers")
async def list_workers(key_info: dict = Depends(verify_api_key)):
    return store.list_worker_stats()


@router.get("/stats")
async def competitive_stats(key_info: dict = Depends(verify_api_key)):
    races = store.list_races(100)
    workers = store.list_worker_stats()
    total_saved = sum(r["tokens_saved"] for r in races)
    completed = sum(1 for r in races if r["status"] == "completed")
    user_prefs = sum(1 for r in races if r["user_preference"])
    return {
        "total_races": len(races),
        "completed_races": completed,
        "total_tokens_saved": total_saved,
        "avg_tokens_saved": round(total_saved / completed, 1) if completed else 0,
        "user_preferences": user_prefs,
        "active_workers": len(workers),
        "workers": workers,
    }
