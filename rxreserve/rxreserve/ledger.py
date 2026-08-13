"""LAIDER Canonical Ledger — Event-Sourced Economic History.

Never mutate history. Everything else becomes projections over this event log.

The ledger is the single source of truth. All other data structures are
projections (materialized views) over the immutable event stream.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:12]}"


class EventType(str, Enum):
    OBSERVATION_RECORDED = "OBSERVATION_RECORDED"
    UNCERTAINTY_CREATED = "UNCERTAINTY_CREATED"
    HYPOTHESIS_PROPOSED = "HYPOTHESIS_PROPOSED"
    EMPLOYEE_TWIN_UNDERWRITTEN = "EMPLOYEE_TWIN_UNDERWRITTEN"
    COMPANY_TWIN_UNDERWRITTEN = "COMPANY_TWIN_UNDERWRITTEN"
    GOVERNOR_REVIEWED = "GOVERNOR_REVIEWED"
    EXPERIMENT_CONTRACTED = "EXPERIMENT_CONTRACTED"
    CAPITAL_RESERVED = "CAPITAL_RESERVED"
    EXPERIMENT_STARTED = "EXPERIMENT_STARTED"
    ARTIFACT_CREATED = "ARTIFACT_CREATED"
    EVIDENCE_ATTACHED = "EVIDENCE_ATTACHED"
    BASELINE_MEASURED = "BASELINE_MEASURED"
    OUTCOME_MEASURED = "OUTCOME_MEASURED"
    VALUE_CLAIMED = "VALUE_CLAIMED"
    VALUE_CHALLENGED = "VALUE_CHALLENGED"
    VALUE_VERIFIED = "VALUE_VERIFIED"
    ATTRIBUTION_PROPOSED = "ATTRIBUTION_PROPOSED"
    ATTRIBUTION_CHALLENGED = "ATTRIBUTION_CHALLENGED"
    ATTRIBUTION_SETTLED = "ATTRIBUTION_SETTLED"
    RECOGNITION_REQUESTED = "RECOGNITION_REQUESTED"
    RECOGNITION_GRANTED = "RECOGNITION_GRANTED"
    CAREER_TRANSACTION_OPENED = "CAREER_TRANSACTION_OPENED"
    CAREER_TRANSACTION_SETTLED = "CAREER_TRANSACTION_SETTLED"
    PRIMITIVE_EXTRACTED = "PRIMITIVE_EXTRACTED"
    DERIVATIVE_GENERATED = "DERIVATIVE_GENERATED"
    DERIVATIVE_REACTIVATED = "DERIVATIVE_REACTIVATED"
    KILL_CREDITED = "KILL_CREDITED"
    INFORMATION_VALUE_RECORDED = "INFORMATION_VALUE_RECORDED"
    CAREER_WARRANT_ISSUED = "CAREER_WARRANT_ISSUED"
    CAREER_WARRANT_EXERCISED = "CAREER_WARRANT_EXERCISED"
    TRANCHE_ADVANCED = "TRANCHE_ADVANCED"
    TRANCHE_KILLED = "TRANCHE_KILLED"


# Canonical state machine — defines valid transitions
CANONICAL_STATES = [
    "OBSERVED",
    "UNCERTAINTY",
    "HYPOTHESIS",
    "UNDERWRITING",
    "CONTRACTED",
    "FUNDED",
    "RUNNING",
    "MEASURED",
    "VERIFIED",
    "ATTRIBUTED",
    "RECOGNIZED",
    "SETTLED",
    "PRIMITIVE_EXTRACTED",
    "MAGNIFIED",
    "DORMANT",
    "KILLED",
    "INFORMATION_VALUE",
]

CANONICAL_TRANSITIONS: dict[str, list[str]] = {
    "OBSERVED": ["UNCERTAINTY"],
    "UNCERTAINTY": ["HYPOTHESIS"],
    "HYPOTHESIS": ["UNDERWRITING"],
    "UNDERWRITING": ["CONTRACTED", "DORMANT"],
    "DORMANT": ["UNDERWRITING"],
    "CONTRACTED": ["FUNDED"],
    "FUNDED": ["RUNNING"],
    "RUNNING": ["MEASURED", "KILLED"],
    "KILLED": ["INFORMATION_VALUE"],
    "MEASURED": ["VERIFIED"],
    "VERIFIED": ["ATTRIBUTED"],
    "ATTRIBUTED": ["RECOGNIZED"],
    "RECOGNIZED": ["SETTLED"],
    "SETTLED": ["PRIMITIVE_EXTRACTED"],
    "PRIMITIVE_EXTRACTED": ["MAGNIFIED"],
    "MAGNIFIED": [],  # → DERIVATIVE OPPORTUNITIES → feeds back to UNDERWRITING
    "INFORMATION_VALUE": ["ATTRIBUTED"],
}


@dataclass
class LedgerEvent:
    """A single immutable event in the canonical ledger."""
    event_id: str = field(default_factory=lambda: _uid("EVT-"))
    event_type: EventType = EventType.OBSERVATION_RECORDED
    timestamp: str = field(default_factory=_now)
    actor: str = ""  # employee_id, agent_id, or system
    entity_id: str = ""  # the primary entity this event pertains to
    entity_type: str = ""  # uncertainty, experiment, primitive, employee, etc.
    payload: dict[str, Any] = field(default_factory=dict)
    prev_event_id: Optional[str] = None  # links to previous event for same entity
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "timestamp": self.timestamp,
            "actor": self.actor,
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "payload": self.payload,
            "prev_event_id": self.prev_event_id,
            "metadata": self.metadata,
        }


class CanonicalLedger:
    """Append-only event-sourced ledger.

    Never mutate history. Everything else becomes projections over this event log.

    The ledger supports:
    - append: add new events (never modify or delete)
    - project: compute current state by replaying events
    - replay: re-derive any past state
    - audit: full traceability
    """

    def __init__(self) -> None:
        self._events: list[LedgerEvent] = []
        self._entity_index: dict[str, list[int]] = {}  # entity_id → event indices

    def append(self, event: LedgerEvent) -> str:
        """Append an event. Never modify or delete."""
        # Link to previous event for same entity
        if event.entity_id and event.entity_id in self._entity_index:
            prev_idx = self._entity_index[event.entity_id][-1]
            event.prev_event_id = self._events[prev_idx].event_id
        self._events.append(event)
        idx = len(self._events) - 1
        if event.entity_id:
            if event.entity_id not in self._entity_index:
                self._entity_index[event.entity_id] = []
            self._entity_index[event.entity_id].append(idx)
        return event.event_id

    def record(
        self,
        event_type: EventType,
        actor: str = "",
        entity_id: str = "",
        entity_type: str = "",
        payload: Optional[dict[str, Any]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> str:
        """Convenience method to create and append an event."""
        event = LedgerEvent(
            event_type=event_type,
            actor=actor,
            entity_id=entity_id,
            entity_type=entity_type,
            payload=payload or {},
            metadata=metadata or {},
        )
        return self.append(event)

    def get_events_for_entity(self, entity_id: str) -> list[LedgerEvent]:
        """Get all events for an entity in chronological order."""
        indices = self._entity_index.get(entity_id, [])
        return [self._events[i] for i in indices]

    def project(self, entity_id: str) -> dict[str, Any]:
        """Compute current state by replaying all events for an entity."""
        events = self.get_events_for_entity(entity_id)
        state: dict[str, Any] = {
            "entity_id": entity_id,
            "canonical_state": None,
            "history": [],
        }
        for event in events:
            state["history"].append(event.to_dict())
            # Update state based on event type
            if event.event_type == EventType.OBSERVATION_RECORDED:
                state["canonical_state"] = "OBSERVED"
                state["observation"] = event.payload
            elif event.event_type == EventType.UNCERTAINTY_CREATED:
                state["canonical_state"] = "UNCERTAINTY"
                state["uncertainty"] = event.payload
            elif event.event_type == EventType.HYPOTHESIS_PROPOSED:
                state["canonical_state"] = "HYPOTHESIS"
                state["hypothesis"] = event.payload
            elif event.event_type in (
                EventType.EMPLOYEE_TWIN_UNDERWRITTEN,
                EventType.COMPANY_TWIN_UNDERWRITTEN,
                EventType.GOVERNOR_REVIEWED,
            ):
                state["canonical_state"] = "UNDERWRITING"
                state.setdefault("underwriting", []).append(event.payload)
            elif event.event_type == EventType.EXPERIMENT_CONTRACTED:
                state["canonical_state"] = "CONTRACTED"
                state["experiment"] = event.payload
            elif event.event_type == EventType.CAPITAL_RESERVED:
                state["canonical_state"] = "FUNDED"
                state.setdefault("capital", []).append(event.payload)
            elif event.event_type == EventType.EXPERIMENT_STARTED:
                state["canonical_state"] = "RUNNING"
            elif event.event_type in (
                EventType.ARTIFACT_CREATED,
                EventType.EVIDENCE_ATTACHED,
                EventType.BASELINE_MEASURED,
            ):
                state.setdefault("artifacts", []).append(event.payload)
            elif event.event_type == EventType.OUTCOME_MEASURED:
                state["canonical_state"] = "MEASURED"
                state["outcome"] = event.payload
            elif event.event_type == EventType.VALUE_VERIFIED:
                state["canonical_state"] = "VERIFIED"
                state["verified_value"] = event.payload
            elif event.event_type == EventType.ATTRIBUTION_SETTLED:
                state["canonical_state"] = "ATTRIBUTED"
                state["attribution"] = event.payload
            elif event.event_type == EventType.RECOGNITION_GRANTED:
                state["canonical_state"] = "RECOGNIZED"
                state["recognition"] = event.payload
            elif event.event_type == EventType.CAREER_TRANSACTION_SETTLED:
                state["canonical_state"] = "SETTLED"
                state["settlement"] = event.payload
            elif event.event_type == EventType.PRIMITIVE_EXTRACTED:
                state["canonical_state"] = "PRIMITIVE_EXTRACTED"
                state["primitive"] = event.payload
            elif event.event_type == EventType.DERIVATIVE_GENERATED:
                state["canonical_state"] = "MAGNIFIED"
                state.setdefault("derivatives", []).append(event.payload)
            elif event.event_type == EventType.TRANCHE_KILLED:
                state["canonical_state"] = "KILLED"
            elif event.event_type == EventType.INFORMATION_VALUE_RECORDED:
                state["canonical_state"] = "INFORMATION_VALUE"
                state["information_value"] = event.payload
        return state

    def replay(self, entity_id: str, up_to_event_id: str) -> dict[str, Any]:
        """Re-derive past state up to a specific event."""
        events = self.get_events_for_entity(entity_id)
        # Find the index of the target event
        target_idx = None
        for i, e in enumerate(events):
            if e.event_id == up_to_event_id:
                target_idx = i
                break
        if target_idx is None:
            return self.project(entity_id)
        # Temporarily project only up to that event
        all_events = self._events
        self._events = self._events[:self._entity_index[entity_id][target_idx] + 1]
        result = self.project(entity_id)
        self._events = all_events
        return result

    def all_events(self) -> list[LedgerEvent]:
        """Get all events in the ledger."""
        return list(self._events)

    def audit_trail(self, entity_id: str) -> list[dict[str, Any]]:
        """Full audit trail for an entity."""
        return [e.to_dict() for e in self.get_events_for_entity(entity_id)]

    def summary(self) -> dict[str, Any]:
        """Summary statistics of the ledger."""
        type_counts: dict[str, int] = {}
        entity_counts: dict[str, int] = {}
        for e in self._events:
            type_counts[e.event_type.value] = type_counts.get(e.event_type.value, 0) + 1
            if e.entity_type:
                entity_counts[e.entity_type] = entity_counts.get(e.entity_type, 0) + 1
        return {
            "total_events": len(self._events),
            "event_type_counts": type_counts,
            "entity_type_counts": entity_counts,
            "unique_entities": len(self._entity_index),
        }


def validate_transition(from_state: str, to_state: str) -> bool:
    """Validate a state transition against the canonical state machine."""
    valid = CANONICAL_TRANSITIONS.get(from_state, [])
    return to_state in valid
