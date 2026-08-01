"""Multi-modal content generation — photos, video scripts, and booking flows.

Features:
  1. Photo generation prompts (for image generation models)
  2. Video script generation for promotional content
  3. Interactive booking flow templates
  4. Multi-modal content orchestration
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_photo_prompts(theme: str = "professional", count: int = 5) -> dict:
    """Generate prompts for photo/image generation models."""
    prompts = []

    templates = {
        "professional": [
            "Professional massage therapy room with soft lighting, clean linens, and calming atmosphere, photorealistic, high quality",
            "Massage therapist in professional attire, warm and welcoming expression, spa environment, soft natural light",
            "Serene massage studio interior with plants, soft towels, and ambient lighting, lifestyle photography",
            "Close-up of massage therapy tools and essential oils on a wooden surface, product photography, soft focus",
            "Relaxing spa scene with candles, stones, and soft textures, warm color palette, professional photography",
        ],
        "luxury": [
            "Luxury spa suite with marble surfaces, gold accents, and panoramic city views, architectural photography",
            "High-end massage table with premium linens, silk drapes, and crystal decorations, elegant lighting",
            "Exclusive wellness retreat with infinity pool, mountain views, and modern design, lifestyle photography",
            "Premium massage oils and skincare products arranged on marble, luxury product photography",
            "Private spa room with fireplace, fur throws, and champagne, opulent atmosphere, magazine quality",
        ],
        "natural": [
            "Outdoor massage setting with bamboo, water features, and tropical plants, natural lighting, zen aesthetic",
            "Beachside massage cabana with white curtains, ocean view, and tropical flowers, lifestyle photography",
            "Forest massage retreat with wooden elements, moss, and dappled sunlight, nature photography",
            "Natural skincare products with botanical ingredients, herbs, and stones, organic aesthetic",
            "Garden spa with flowering plants, stone pathway, and meditation area, golden hour photography",
        ],
    }

    selected = templates.get(theme, templates["professional"])
    for i in range(min(count, len(selected))):
        prompts.append({
            "id": str(uuid4()),
            "prompt": selected[i],
            "theme": theme,
            "style": "photorealistic",
            "recommended_model": "stable-diffusion-xl",
            "negative_prompt": "blurry, low quality, distorted, unprofessional, cluttered",
        })

    return {
        "theme": theme,
        "count": len(prompts),
        "prompts": prompts,
        "timestamp": _utc_now(),
    }


def generate_video_script(topic: str = "service_promo", duration: int = 60) -> dict:
    """Generate a video script for promotional content."""
    scripts = {
        "service_promo": {
            "title": "Professional Massage Therapy — Service Promo",
            "duration_seconds": duration,
            "scenes": [
                {"time": "0-10s", "visual": "Opening shot of serene spa entrance", "narration": "Experience the ultimate in relaxation and wellness."},
                {"time": "10-20s", "visual": "Therapist preparing the room", "narration": "Our certified therapists create a personalized experience just for you."},
                {"time": "20-35s", "visual": "Close-up of massage techniques", "narration": "Using premium oils and expert techniques, we melt away your tension."},
                {"time": "35-50s", "visual": "Client relaxing with calm expression", "narration": "Feel the stress fade as you enter a state of pure tranquility."},
                {"time": "50-60s", "visual": "Logo and booking information", "narration": "Book your session today. Your wellbeing awaits."},
            ],
            "call_to_action": "Book now at [website] or call [phone]",
            "music": "Soft ambient, calming tones",
        },
        "testimonial": {
            "title": "Client Testimonial — 60 Second Spot",
            "duration_seconds": duration,
            "scenes": [
                {"time": "0-10s", "visual": "Client interview, soft background", "narration": "I've been coming here for months, and it's transformed my wellbeing."},
                {"time": "10-25s", "visual": "B-roll of session", "narration": "The attention to detail and professionalism is unmatched."},
                {"time": "25-45s", "visual": "Client walking out, relaxed", "narration": "I leave every session feeling renewed and energized."},
                {"time": "45-60s", "visual": "Logo and contact", "narration": "Experience the difference. Book your session today."},
            ],
            "call_to_action": "Schedule your appointment: [website]",
            "music": "Uplifting, gentle piano",
        },
    }

    script = scripts.get(topic, scripts["service_promo"])

    return {
        "topic": topic,
        "script": script,
        "estimated_duration": duration,
        "format": "vertical_9:16" if duration <= 30 else "horizontal_16:9",
        "timestamp": _utc_now(),
    }


def generate_booking_flow(flow_type: str = "standard") -> dict:
    """Generate an interactive booking flow template."""
    flows = {
        "standard": {
            "name": "Standard Booking Flow",
            "steps": [
                {"step": 1, "name": "Service Selection", "fields": ["service_type", "duration"], "type": "selection"},
                {"step": 2, "name": "Date & Time", "fields": ["date", "time_slot"], "type": "calendar"},
                {"step": 3, "name": "Contact Info", "fields": ["name", "email", "phone"], "type": "form"},
                {"step": 4, "name": "Confirmation", "fields": ["summary", "payment_method"], "type": "review"},
            ],
            "estimated_completion_time": "2-3 minutes",
        },
        "express": {
            "name": "Express Booking Flow",
            "steps": [
                {"step": 1, "name": "Quick Select", "fields": ["service_type", "date", "time"], "type": "combined"},
                {"step": 2, "name": "Contact & Confirm", "fields": ["phone", "name"], "type": "minimal_form"},
            ],
            "estimated_completion_time": "30-60 seconds",
        },
        "premium": {
            "name": "Premium Booking Flow",
            "steps": [
                {"step": 1, "name": "Service Customization", "fields": ["service_type", "add_ons", "duration"], "type": "wizard"},
                {"step": 2, "name": "Therapist Preference", "fields": ["therapist", "special_requests"], "type": "selection"},
                {"step": 3, "name": "Schedule", "fields": ["date", "time_slot", "recurring"], "type": "calendar"},
                {"step": 4, "name": "Payment & Tips", "fields": ["payment_method", "tip_amount"], "type": "payment"},
                {"step": 5, "name": "Confirmation & Reminders", "fields": ["contact", "reminder_prefs"], "type": "review"},
            ],
            "estimated_completion_time": "3-5 minutes",
        },
    }

    flow = flows.get(flow_type, flows["standard"])

    return {
        "flow_type": flow_type,
        "flow": flow,
        "timestamp": _utc_now(),
    }


def generate_multimodal_campaign(theme: str = "wellness") -> dict:
    """Generate a complete multi-modal content campaign."""
    photos = generate_photo_prompts(theme=theme, count=3)
    video = generate_video_script(topic="service_promo", duration=60)
    booking = generate_booking_flow(flow_type="standard")

    return {
        "campaign_name": f"{theme.title()} Campaign",
        "theme": theme,
        "components": {
            "photos": photos,
            "video": video,
            "booking_flow": booking,
        },
        "content_calendar": [
            {"day": "Monday", "content": "Photo post — professional room shot", "platform": "instagram"},
            {"day": "Wednesday", "content": "Video — service promo", "platform": "website"},
            {"day": "Friday", "content": "Photo post — therapist portrait", "platform": "instagram"},
            {"day": "Saturday", "content": "Booking flow promotion", "platform": "email"},
        ],
        "timestamp": _utc_now(),
    }
