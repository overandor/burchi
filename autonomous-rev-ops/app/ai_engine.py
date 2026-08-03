"""AI Decision & Optimization Engine.

Implements the closed loop: Observe → Decide → Act → Measure → Learn.

Core algorithms:
  - Thompson sampling for variant selection
  - Genetic optimization for candidate mutation
  - Reward calculation from telemetry deltas
  - Confidence scoring from observation count
  - Decision receipts for auditability
"""

from __future__ import annotations

import json
import os
import random
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Reward Calculation ──────────────────────────────────────────

def calculate_reward(impressions: int, clicks: int, contacts: int,
                     conversions: int, baseline_ctr: float = 0.0) -> float:
    """Calculate a normalized reward score for a variant.

    Reward = weighted combination of CTR, contact rate, and conversion rate,
    normalized to roughly [-1, +1].
    """
    if impressions <= 0:
        return 0.0
    ctr = clicks / impressions
    contact_rate = contacts / max(impressions, 1)
    conversion_rate = conversions / max(clicks, 1) if clicks > 0 else 0.0

    # Weighted reward: conversions matter most, then contacts, then clicks
    raw = (ctr * 0.2) + (contact_rate * 0.3) + (conversion_rate * 0.5)

    # Normalize relative to baseline (0.0 to ~0.5 typical)
    normalized = (raw - baseline_ctr) * 2.0
    return round(max(-1.0, min(1.0, normalized)), 4)


def calculate_confidence(observations: int, min_observations: int = 30) -> float:
    """Calculate statistical confidence from observation count.

    Uses a diminishing-returns curve: confidence approaches 1.0 as
    observations increase, but with decreasing marginal gains.
    """
    if observations <= 0:
        return 0.0
    # Sigmoid-like curve centered at min_observations
    import math
    z = (observations - min_observations) / (min_observations * 0.5)
    confidence = 1.0 / (1.0 + math.exp(-z))
    return round(confidence, 4)


# ─── Thompson Sampling for Variant Selection ─────────────────────

def thompson_sample(variants: list[dict]) -> dict | None:
    """Select a variant using Thompson sampling.

    Each variant's reward is treated as a Beta distribution.
    We sample from each and pick the highest.
    """
    if not variants:
        return None

    best_sample = -float("inf")
    best_variant = variants[0]

    for v in variants:
        if v.get("status") == "eliminated":
            continue
        impressions = max(v.get("impressions", 0), 1)
        clicks = v.get("clicks", 0)
        contacts = v.get("contacts", 0)
        # Alpha = successes (clicks + contacts weighted), Beta = failures
        alpha = clicks + contacts * 2 + 1
        beta = max(impressions - clicks, 1)
        sample = random.betavariate(alpha, beta)
        if sample > best_sample:
            best_sample = sample
            best_variant = v

    return best_variant


# ─── Genetic Optimization for Candidate Mutation ─────────────────

BIO_TEMPLATES = [
    "Certified {specialty} specialist with {years}+ years experience. {benefit}. {availability}. {cta}.",
    "Award-winning {specialty} therapist. {social_proof}. {availability}. {cta}.",
    "Elite {specialty} for discerning clients. {benefit}. Private studio. {availability}. {cta}.",
    "Warm, intuitive {specialty} in a safe, welcoming space. {social_proof}. {benefit}. {cta}.",
    "{specialty} and recovery specialist. {target_audience}. Clinical precision, therapeutic pressure. {cta}.",
]

SPECIALTIES = ["deep tissue", "Swedish", "sports massage", "deep tissue and Swedish", "therapeutic"]
BENEFITS = [
    "Your stress ends here", "Relax, breathe, let go", "Recover faster, perform better",
    "Pain relief and stress reduction", "Restore balance to body and mind",
]
AVAILABILITY = [
    "Available evenings & weekends", "Same-day appointments", "Online booking 24/7",
    "Text preferred", "Outcalls available",
]
CTAS = [
    "Book now", "Text to schedule", "Book online", "Schedule your session",
    "You deserve quality",
]
SOCIAL_PROOF = [
    "500+ satisfied clients", "8 years experience", "Trained in multiple techniques",
    "LGBTQ+ friendly", "6 years experience",
]
TARGET_AUDIENCES = [
    "Marathon runners, weightlifters, weekend warriors",
    "For discerning clients",
    "Serving downtown professionals",
]


def _llm_generate(prompt: str, max_tokens: int = 300, temperature: float = 0.8) -> str:
    """Generate text using a real LLM via Pollinations.ai (free, no API key)."""
    import urllib.request
    import urllib.error

    messages = [{"role": "user", "content": prompt}]
    payload = json.dumps({
        "model": "openai-fast",
        "messages": messages,
        "max_tokens": max_tokens,
        "seed": 42,
    }).encode("utf-8")

    # Try Pollinations.ai
    try:
        req = urllib.request.Request(
            "https://text.pollinations.ai/openai",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://pollinations.ai/",
                "Origin": "https://pollinations.ai",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception:
        pass

    # Try Ollama tunnels
    for ollama_url in [
        "https://proud-post-highest-college.trycloudflare.com/api/chat",
        "http://localhost:11434/api/chat",
    ]:
        try:
            ollama_payload = json.dumps({
                "model": "alpha-gpt:latest",
                "messages": messages,
                "stream": False,
            }).encode("utf-8")
            req = urllib.request.Request(ollama_url, data=ollama_payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("message", {}).get("content"):
                    return data["message"]["content"].strip()
        except Exception:
            pass

    raise RuntimeError("All inference endpoints unavailable")


def mutate_bio(parent: str, mutation_rate: float = 0.3) -> str:
    """Generate a mutated bio from a parent using the LLM."""
    if not parent:
        return parent
    prompt = (
        f"You are a professional massage therapist bio writer. "
        f"Rewrite the following bio with a different angle, tone, or structure. "
        f"Keep it professional and under 300 characters.\n\n"
        f"Original bio:\n{parent}\n\n"
        f"Write a new variation:"
    )
    try:
        return _llm_generate(prompt, max_tokens=200, temperature=0.9)
    except Exception:
        return parent


def generate_bio_candidates(count: int = 3, parent: str = "") -> list[dict]:
    """Generate bio candidates using the LLM."""
    candidates = []
    labels = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]

    for i in range(count):
        if parent:
            prompt = (
                f"You are a professional massage therapist bio writer. "
                f"Create a variation of this bio with a different angle or emphasis. "
                f"Keep it professional, compelling, and under 300 characters.\n\n"
                f"Original: {parent}\n\n"
                f"New variation:"
            )
        else:
            prompt = (
                f"You are a professional massage therapist bio writer. "
                f"Write a compelling, professional massage therapy bio. "
                f"Include specialty, experience, and a call to action. "
                f"Keep it under 300 characters."
            )
        try:
            text = _llm_generate(prompt, max_tokens=200, temperature=0.7 + (i * 0.1))
        except Exception as e:
            text = f"[LLM generation failed: {str(e)[:80]}]"
        label = labels[i] if i < len(labels) else f"Variant_{i+1}"
        candidates.append({
            "label": label,
            "content": text,
            "char_count": len(text),
            "status": "candidate",
        })
    return candidates


# ─── Content Generation ──────────────────────────────────────────

def generate_content(content_type: str, topic: str = "", count: int = 1) -> list[dict]:
    """Generate content items of a given type."""
    items = []
    generators = {
        "bio": lambda t: generate_bio_candidates(1)[0],
        "blog": _gen_blog,
        "social": _gen_social,
        "seo": _gen_seo,
        "email": _gen_email,
        "interview": _gen_interview,
    }
    gen = generators.get(content_type, _gen_generic)
    for _ in range(count):
        item = gen(topic)
        item["type"] = content_type
        items.append(item)
    return items


def _gen_blog(topic: str) -> dict:
    """Generate a blog post using the LLM."""
    prompt = (
        f"Write a short blog post (200-300 words) about {topic or 'deep tissue massage'} "
        f"for a massage therapy practice. Include a compelling title. "
        f"Format: Title on first line, then the body."
    )
    try:
        text = _llm_generate(prompt, max_tokens=400, temperature=0.7)
    except Exception as e:
        text = f"Blog about {topic or 'massage'}\n\n[LLM generation failed: {str(e)[:80]}]"
    lines = text.split("\n", 1)
    title = lines[0].strip() if lines else "Blog Post"
    body = lines[1].strip() if len(lines) > 1 else text
    return {"type": "blog", "title": title, "body": body}


def _gen_social(topic: str) -> dict:
    """Generate a social media post using the LLM."""
    prompt = (
        f"Write a short social media post (1-3 sentences) for a massage therapy practice "
        f"about {topic or 'wellness and recovery'}. Include relevant hashtags. "
        f"Keep it engaging and professional."
    )
    try:
        text = _llm_generate(prompt, max_tokens=150, temperature=0.8)
    except Exception as e:
        text = f"[LLM generation failed: {str(e)[:80]}]"
    return {"type": "social", "title": "Social Post", "body": text}


def _gen_seo(topic: str) -> dict:
    """Generate SEO keywords using the LLM."""
    prompt = (
        f"You are an SEO expert. List 8-10 high-value SEO keywords for a massage therapy practice "
        f"focusing on {topic or 'general massage therapy'}. "
        f"Return only the keywords, comma-separated."
    )
    try:
        text = _llm_generate(prompt, max_tokens=100, temperature=0.5)
    except Exception as e:
        text = f"[LLM generation failed: {str(e)[:80]}]"
    return {
        "type": "seo",
        "title": f"SEO Keywords: {topic or 'massage therapist'}",
        "body": text,
    }


def _gen_email(topic: str) -> dict:
    """Generate a follow-up email using the LLM."""
    prompt = (
        f"Write a professional follow-up email for a massage therapy client "
        f"about {topic or 'scheduling their next session'}. "
        f"Keep it warm, concise, and include a clear call to action. "
        f"Use [Name] as a placeholder for the client's name."
    )
    try:
        text = _llm_generate(prompt, max_tokens=200, temperature=0.7)
    except Exception as e:
        text = f"[LLM generation failed: {str(e)[:80]}]"
    return {"type": "email", "title": f"Email: {topic or 'Follow-up'}", "body": text}


def _gen_interview(topic: str) -> dict:
    """Generate an interview Q&A using the LLM."""
    prompt = (
        f"Write a short interview Q&A for a massage therapist about {topic or 'their practice'}. "
        f"Include one question and a thoughtful answer. "
        f"Format: Q: <question>\n\nA: <answer>"
    )
    try:
        text = _llm_generate(prompt, max_tokens=250, temperature=0.7)
    except Exception as e:
        text = f"Q: [LLM generation failed]\n\nA: {str(e)[:80]}"
    q_match = text.split("\n")[0].replace("Q:", "").strip()[:40] if "Q:" in text else text[:40]
    return {"type": "interview", "title": f"Interview Q: {q_match}...", "body": text}


def _gen_generic(topic: str) -> dict:
    """Generate generic content using the LLM."""
    prompt = f"Write a short professional content piece about {topic or 'massage therapy'}."
    try:
        text = _llm_generate(prompt, max_tokens=200, temperature=0.7)
    except Exception as e:
        text = f"[LLM generation failed: {str(e)[:80]}]"
    return {"type": "generic", "title": topic or "Generated Content", "body": text}


# ─── Decision Cycle ──────────────────────────────────────────────

def run_decision_cycle(experiment_id: str = "") -> dict:
    """Run one AI decision cycle.

    This is the core closed-loop:
    1. Observe: gather current experiment state and telemetry
    2. Decide: use Thompson sampling + reward to pick action
    3. Act: create a decision record (mutation happens in control plane)
    4. Receipt: create evidence chain
    """
    experiments = store.list_experiments(limit=10)
    if not experiments:
        return {"status": "no_experiments", "message": "No active experiments to optimize"}

    # Find the target experiment
    exp = None
    if experiment_id:
        exp = store.get_experiment(experiment_id)
    if not exp:
        exp = experiments[0]

    variants = exp.get("variants", [])
    active_variants = [v for v in variants if v.get("status") != "eliminated"]
    if not active_variants:
        return {"status": "no_active_variants", "experiment": exp["name"]}

    # 1. OBSERVE: Calculate rewards and confidence
    total_impressions = sum(v.get("impressions", 0) for v in variants)
    baseline_ctr = sum(v.get("clicks", 0) for v in variants) / max(total_impressions, 1)
    observations = exp.get("observations", total_impressions)

    for v in variants:
        reward = calculate_reward(
            v.get("impressions", 0), v.get("clicks", 0),
            v.get("contacts", 0), v.get("conversions", 0), baseline_ctr
        )
        store.update_variant(v["id"], {"reward": reward})

    confidence = calculate_confidence(observations)

    # 2. DECIDE: Thompson sample to pick the best variant
    winner = thompson_sample(active_variants)
    if not winner:
        return {"status": "no_winner", "experiment": exp["name"]}

    # Determine action based on current state
    current_leader = max(active_variants, key=lambda v: v.get("reward", 0))
    action_type = "continue"
    rationale = ""

    if winner["id"] == current_leader["id"]:
        if confidence > 0.8:
            action_type = "promote"
            rationale = f"{winner['label']} is the clear leader with {confidence:.0%} confidence and reward {winner.get('reward', 0):.2f}. Promote to deployed."
        else:
            action_type = "continue"
            rationale = f"{winner['label']} leading but confidence only {confidence:.0%}. Continue measurement window."
    else:
        if confidence > 0.7:
            action_type = "rotate"
            rationale = f"Thompson sampling selected {winner['label']} over current leader {current_leader['label']}. Confidence {confidence:.0%}."
        else:
            action_type = "observe"
            rationale = f"Insufficient confidence ({confidence:.0%}) to rotate. Continue observing."

    # Check for underperformers to eliminate
    eliminated = []
    for v in active_variants:
        if v["id"] != winner["id"] and v.get("reward", 0) < -0.15 and observations > 50:
            store.update_variant(v["id"], {"status": "eliminated"})
            eliminated.append(v["label"])

    # 3. ACT: Create decision
    mode = store.get_control_state("mode") or "OBSERVE"
    decision = store.create_decision(
        experiment_id=exp["id"],
        variant_id=winner["id"],
        action_type=action_type,
        rationale=rationale,
        confidence=confidence,
        mode=mode,
    )

    # 4. RECEIPT: Create evidence chain
    receipt = store.create_receipt(
        decision_id=decision["id"],
        input_obs=f"{observations} observations across {len(variants)} variants",
        source="telemetry_pipeline",
        model="thompson_sampling_v2",
        decision=rationale,
        action=f"variant_status={action_type}",
        result=f"{winner['label']} selected" + (f", eliminated: {', '.join(eliminated)}" if eliminated else ""),
        reward=winner.get("reward", 0),
    )

    # Log live events
    store.log_live_event("ai_decision", f"AI decision: {action_type} — {winner['label']}", "info")
    if eliminated:
        store.log_live_event("variant_eliminated", f"Eliminated: {', '.join(eliminated)}", "warning")
    store.log_live_event("confidence_update", f"Experiment confidence: {confidence:.0%}", "info")

    # Update experiment confidence
    with store._lock:
        conn = store._get_conn()
        conn.execute("UPDATE experiments SET confidence=?, observations=? WHERE id=?",
                      (confidence, observations, exp["id"]))
        conn.commit()

    return {
        "status": "decided",
        "experiment": exp["name"],
        "decision_id": decision["id"],
        "action": action_type,
        "variant": winner["label"],
        "confidence": confidence,
        "reward": winner.get("reward", 0),
        "eliminated": eliminated,
        "receipt_id": receipt.get("timestamp", ""),
    }


# ─── Visitor Engagement Scoring ──────────────────────────────────

def score_visitor_engagement(visit_count: int, message_count: int,
                              days_since_last: int, converted: bool) -> tuple[float, str]:
    """Score a visitor's engagement and assign a lifecycle stage.

    Returns (engagement_score 0-1, lifecycle_stage).
    """
    if converted:
        return 1.0, "converted"

    # Visit frequency component (0-0.4)
    visit_score = min(visit_count / 10, 1.0) * 0.4

    # Messaging component (0-0.3)
    msg_score = min(message_count / 5, 1.0) * 0.3

    # Recency component (0-0.3) — more recent = higher
    if days_since_last <= 1:
        recency = 0.3
    elif days_since_last <= 3:
        recency = 0.2
    elif days_since_last <= 7:
        recency = 0.1
    else:
        recency = 0.0

    total = round(visit_score + msg_score + recency, 2)

    # Assign lifecycle stage
    if total >= 0.7:
        stage = "high_intent"
    elif total >= 0.5:
        stage = "engaged"
    elif total >= 0.3:
        stage = "browsing"
    elif total >= 0.15:
        stage = "new"
    else:
        stage = "bounced"

    return total, stage


def infer_intent(visit_count: int, message_count: int, engagement: float) -> str:
    """Infer visitor intent from behavior patterns."""
    if engagement >= 0.8:
        return "booking_imminent"
    if engagement >= 0.6 and message_count > 0:
        return "evaluating"
    if engagement >= 0.5:
        return "interested"
    if visit_count >= 3:
        return "curious"
    if visit_count >= 1:
        return "browsing"
    return "unknown"
