from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    db_path: Path
    receipt_ledger_path: Path
    log_level: str

    @classmethod
    def load_settings(cls) -> "Settings":
        data_dir = Path(_getenv("YTL_DATA_DIR", "./data")).expanduser().resolve()
        db_path = Path(_getenv("YTL_DB_PATH", str(data_dir / "ytl_lab.db"))).expanduser().resolve()
        receipt_path = Path(
            _getenv("YTL_RECEIPT_LEDGER_PATH", str(data_dir / "receipts" / "ledger.jsonl"))
        ).expanduser().resolve()
        log_level = _getenv("YTL_LOG_LEVEL", "INFO")
        return cls(
            data_dir=data_dir,
            db_path=db_path,
            receipt_ledger_path=receipt_path,
            log_level=log_level,
        )


def load_settings() -> Settings:
    return Settings.load_settings()


def _getenv(name: str, default: str) -> str:
    import os

    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value
