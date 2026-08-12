from __future__ import annotations

import re


_EVENT_TYPE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$")
_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


class ValidationError(ValueError):
    pass


def require_non_empty_str(value: object, field: str, *, max_len: int) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field}_must_be_string")
    s = value.strip()
    if s == "":
        raise ValidationError(f"{field}_must_not_be_empty")
    if len(s) > max_len:
        raise ValidationError(f"{field}_too_long")
    return s


def require_id(value: object, field: str) -> str:
    s = require_non_empty_str(value, field, max_len=64)
    if not _ID_RE.match(s):
        raise ValidationError(f"{field}_invalid")
    return s


def require_event_type(value: object, field: str = "event_type") -> str:
    s = require_non_empty_str(value, field, max_len=64)
    if not _EVENT_TYPE_RE.match(s):
        raise ValidationError(f"{field}_invalid")
    return s


def require_int_in_range(value: object, field: str, *, min_value: int, max_value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{field}_must_be_int")
    if value < min_value or value > max_value:
        raise ValidationError(f"{field}_out_of_range")
    return value
