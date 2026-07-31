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


def mutate_bio(parent: str, mutation_rate: float = 0.3) -> str:
    """Generate a mutated bio from a parent by swapping components."""
    if random.random() < mutation_rate:
        template = random.choice(BIO_TEMPLATES)
        return template.format(
            specialty=random.choice(SPECIALTIES),
            years=random.choice(["5", "6", "8", "10"]),
            benefit=random.choice(BENEFITS),
            availability=random.choice(AVAILABILITY),
            cta=random.choice(CTAS),
            social_proof=random.choice(SOCIAL_PROOF),
            target_audience=random.choice(TARGET_AUDIENCES),
        )
    return parent


def generate_bio_candidates(count: int = 3, parent: str = "") -> list[dict]:
    """Generate bio candidates, optionally mutating from a parent."""
    candidates = []
    for i in range(count):
        if parent and random.random() < 0.5:
            text = mutate_bio(parent)
        else:
            template = random.choice(BIO_TEMPLATES)
            text = template.format(
                specialty=random.choice(SPECIALTIES),
                years=random.choice(["5", "6", "8", "10"]),
                benefit=random.choice(BENEFITS),
                availability=random.choice(AVAILABILITY),
                cta=random.choice(CTAS),
                social_proof=random.choice(SOCIAL_PROOF),
                target_audience=random.choice(TARGET_AUDIENCES),
            )
        animal = random.choice(["wolf", "fox", "bear", "eagle", "lion", "hawk", "panther"])
        adjective = random.choice(["controlled", "confident", "gentle", "swift", "bold", "calm"])
        label = f"{adjective.title()} {animal.title()} v{random.randint(1, 9)}"
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
    titles = [
        f"5 Benefits of {topic or 'Deep Tissue Massage'}",
        f"Why {topic or 'Sports Massage'} Could Change Your Recovery",
        f"The Science Behind {topic or 'Swedish Massage'}: What Really Happens",
    ]
    bodies = [
        f"{topic or 'Deep tissue massage'} offers numerous benefits including pain relief, stress reduction, "
        f"improved blood pressure, injury rehabilitation, and scar tissue breakdown. "
        f"Regular sessions can significantly improve your quality of life and athletic performance.",
        f"Many people don't realize that {topic or 'massage therapy'} is backed by serious science. "
        f"Studies show measurable reductions in cortisol, improvements in circulation, and faster recovery times. "
        f"Here's what the research actually says about {topic or 'regular massage'}.",
    ]
    return {
        "type": "blog",
        "title": random.choice(titles),
        "body": random.choice(bodies),
    }


def _gen_social(topic: str) -> dict:
    posts = [
        f"Book a 90-minute session this Tuesday and get 20% off! Limited slots available. #massage #wellness #{topic or 'recovery'}",
        f"Your body works hard for you. Time to return the favor. Book your session today. 💆‍♂️ #selfcare",
        f"Just had a client say 'I feel like a new person.' That's why I do what I do. #massage #nyc",
        f"Tip: drink plenty of water after your massage to help flush toxins and reduce soreness. #wellness",
    ]
    return {"type": "social", "title": "Social Post", "body": random.choice(posts)}


def _gen_seo(topic: str) -> dict:
    keywords = [
        f"massage therapist {topic or 'downtown'}", "deep tissue massage", "swedish massage",
        "sports massage", "same-day appointment", "massage therapy NYC",
        f"best massage {topic or 'manhattan'}", "therapeutic massage", "recovery massage",
    ]
    selected = random.sample(keywords, min(5, len(keywords)))
    return {
        "type": "seo",
        "title": f"SEO Keywords: {topic or 'massage therapist'}",
        "body": f"Target keywords: {', '.join(selected)}",
    }


def _gen_email(topic: str) -> dict:
    templates = [
        "Hi [Name], thanks for visiting my profile! I noticed you've been back a few times. "
        "I'd love to help you with your wellness goals. Reply to schedule a session.",
        "Hi [Name], it's been a while since your last visit. I have some openings this week "
        "and would love to see you again. Book now and get 10% off your next session.",
    ]
    return {"type": "email", "title": f"Email: {topic or 'Follow-up'}", "body": random.choice(templates)}


def _gen_interview(topic: str) -> dict:
    qs = [
        ("What inspired you to become a massage therapist?", "I've always been fascinated by how the body heals itself. Massage therapy lets me facilitate that healing directly."),
        ("What's the most common issue you see?", "Chronic tension from desk work. So many people carry stress in their neck and shoulders without realizing it."),
        ("How often should someone get a massage?", "For maintenance, once a month. For recovery from injury or intense training, weekly or bi-weekly."),
    ]
    q, a = random.choice(qs)
    return {"type": "interview", "title": f"Interview Q: {q[:40]}...", "body": f"Q: {q}\n\nA: {a}"}


def _gen_generic(topic: str) -> dict:
    return {"type": "generic", "title": topic or "Generated Content", "body": f"Content about {topic or 'massage therapy'}."}


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
