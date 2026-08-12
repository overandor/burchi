from __future__ import annotations

import logging


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=_parse_level(level),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


def _parse_level(level: str) -> int:
    normalized = (level or "").strip().upper()
    return getattr(logging, normalized, logging.INFO)
