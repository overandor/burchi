"""RentMasseur Unified Dashboard data — scraped competitor/visitor/content data."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_DATA_CACHE: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _DATA_CACHE
    if _DATA_CACHE is None:
        path = Path(__file__).parent / "hfdata.json"
        with open(path) as f:
            _DATA_CACHE = json.load(f)
    return _DATA_CACHE


def get_competitors(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    comps = data.get("competitors", [])
    return comps[offset:offset + limit]


def get_visitors(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("visitors", [])[offset:offset + limit]


def get_reviews(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("reviews", [])[offset:offset + limit]


def get_bios(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("bios", [])[offset:offset + limit]


def get_blogs(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("blogs", [])[offset:offset + limit]


def get_interviews(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("interviews", [])[offset:offset + limit]


def get_abtests(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("abtests", [])[offset:offset + limit]


def get_strategies(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("strategies", [])[offset:offset + limit]


def get_clients(limit: int = 50, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("clients", [])[offset:offset + limit]


def get_kpis(limit: int = 200, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("kpis", [])[offset:offset + limit]


def get_profile_stats(limit: int = 100, offset: int = 0) -> list[dict]:
    data = _load()
    return data.get("profile_stats", [])[offset:offset + limit]


def get_profile_snapshot() -> dict:
    data = _load()
    return data.get("profile_snapshot", {})


def get_counts() -> dict[str, int]:
    data = _load()
    return {k: v for k, v in data.items() if k.startswith("_count_")}


def get_overview() -> dict:
    data = _load()
    return {
        "counts": get_counts(),
        "profile_snapshot": get_profile_snapshot(),
        "recent_competitors": data.get("competitors", [])[:5],
        "recent_visitors": data.get("visitors", [])[:5],
        "recent_bios": data.get("bios", [])[:3],
        "recent_blogs": data.get("blogs", [])[:3],
        "recent_abtests": data.get("abtests", [])[:5],
        "recent_strategies": data.get("strategies", [])[:5],
    }
