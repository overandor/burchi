"""Tests for the Canonical Ledger — event-sourced economic history.

Tests the architectural contracts enforced in ledger.py:
- EventType enum values
- LedgerEvent immutability and to_dict serialization
- CanonicalLedger append / record / get_events_for_entity
- validate_transition against the canonical state machine
- prev_event_id linking for same-entity events
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.ledger import (
    EventType,
    LedgerEvent,
    CanonicalLedger,
    validate_transition,
    CANONICAL_TRANSITIONS,
)


# ─── EventType ───

def test_event_type_values_are_strings():
    assert EventType.OBSERVATION_RECORDED.value == "OBSERVATION_RECORDED"
    assert EventType.UNCERTAINTY_CREATED.value == "UNCERTAINTY_CREATED"
    assert EventType.HYPOTHESIS_PROPOSED.value == "HYPOTHESIS_PROPOSED"
    assert EventType.VALUE_VERIFIED.value == "VALUE_VERIFIED"
    assert EventType.ATTRIBUTION_SETTLED.value == "ATTRIBUTION_SETTLED"


# ─── LedgerEvent ───

def test_ledger_event_defaults_and_to_dict():
    ev = LedgerEvent(
        event_type=EventType.OBSERVATION_RECORDED,
        actor="emp-001",
        entity_id="ent-1",
        entity_type="uncertainty",
        payload={"note": "observed gap"},
    )
    d = ev.to_dict()
    assert d["event_type"] == "OBSERVATION_RECORDED"
    assert d["actor"] == "emp-001"
    assert d["entity_id"] == "ent-1"
    assert d["entity_type"] == "uncertainty"
    assert d["payload"] == {"note": "observed gap"}
    assert d["prev_event_id"] is None
    # event_id auto-generated with EVT- prefix
    assert d["event_id"].startswith("EVT-")


def test_ledger_event_auto_generates_id_and_timestamp():
    ev = LedgerEvent()
    assert ev.event_id.startswith("EVT-")
    assert ev.timestamp  # non-empty ISO string


# ─── CanonicalLedger: append ───

def test_append_returns_event_id_and_links_prev():
    ledger = CanonicalLedger()
    eid1 = ledger.append(LedgerEvent(
        event_type=EventType.OBSERVATION_RECORDED,
        entity_id="ent-1",
    ))
    eid2 = ledger.append(LedgerEvent(
        event_type=EventType.UNCERTAINTY_CREATED,
        entity_id="ent-1",
    ))
    assert eid1 != eid2
    events = ledger.get_events_for_entity("ent-1")
    assert len(events) == 2
    # second event should link to first
    assert events[1].prev_event_id == eid1
    assert events[0].prev_event_id is None


# ─── CanonicalLedger: record ───

def test_record_creates_and_appends_event():
    ledger = CanonicalLedger()
    eid = ledger.record(
        EventType.OBSERVATION_RECORDED,
        actor="emp-001",
        entity_id="ent-1",
        entity_type="uncertainty",
        payload={"gap": "renal dosing"},
        metadata={"source": "field_call"},
    )
    events = ledger.get_events_for_entity("ent-1")
    assert len(events) == 1
    assert events[0].event_id == eid
    assert events[0].actor == "emp-001"
    assert events[0].payload == {"gap": "renal dosing"}
    assert events[0].metadata == {"source": "field_call"}


def test_record_multiple_entities_kept_separate():
    ledger = CanonicalLedger()
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-A")
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-B")
    ledger.record(EventType.UNCERTAINTY_CREATED, entity_id="ent-A")
    assert len(ledger.get_events_for_entity("ent-A")) == 2
    assert len(ledger.get_events_for_entity("ent-B")) == 1
    assert ledger.get_events_for_entity("ent-UNKNOWN") == []


# ─── get_events_for_entity ───

def test_get_events_for_entity_chronological_order():
    ledger = CanonicalLedger()
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-1")
    ledger.record(EventType.UNCERTAINTY_CREATED, entity_id="ent-1")
    ledger.record(EventType.HYPOTHESIS_PROPOSED, entity_id="ent-1")
    events = ledger.get_events_for_entity("ent-1")
    assert [e.event_type for e in events] == [
        EventType.OBSERVATION_RECORDED,
        EventType.UNCERTAINTY_CREATED,
        EventType.HYPOTHESIS_PROPOSED,
    ]


# ─── validate_transition ───

def test_validate_transition_valid_paths():
    assert validate_transition("OBSERVED", "UNCERTAINTY") is True
    assert validate_transition("UNCERTAINTY", "HYPOTHESIS") is True
    assert validate_transition("HYPOTHESIS", "UNDERWRITING") is True
    assert validate_transition("UNDERWRITING", "CONTRACTED") is True
    assert validate_transition("RUNNING", "MEASURED") is True
    assert validate_transition("RUNNING", "KILLED") is True


def test_validate_transition_invalid_paths():
    assert validate_transition("OBSERVED", "VERIFIED") is False
    assert validate_transition("UNCERTAINTY", "FUNDED") is False
    assert validate_transition("MAGNIFIED", "OBSERVED") is False  # terminal-ish
    assert validate_transition("NONEXISTENT", "OBSERVED") is False


def test_validate_transition_dormant_loop():
    # DORMANT can go back to UNDERWRITING
    assert validate_transition("DORMANT", "UNDERWRITING") is True
    assert validate_transition("DORMANT", "CONTRACTED") is False


# ─── project / summary ───

def test_project_replays_state():
    ledger = CanonicalLedger()
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-1", payload={"note": "gap"})
    ledger.record(EventType.UNCERTAINTY_CREATED, entity_id="ent-1", payload={"question": "why?"})
    state = ledger.project("ent-1")
    assert state["canonical_state"] == "UNCERTAINTY"
    assert state["observation"] == {"note": "gap"}
    assert state["uncertainty"] == {"question": "why?"}
    assert len(state["history"]) == 2


def test_summary_counts():
    ledger = CanonicalLedger()
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-1", entity_type="uncertainty")
    ledger.record(EventType.UNCERTAINTY_CREATED, entity_id="ent-1", entity_type="uncertainty")
    ledger.record(EventType.OBSERVATION_RECORDED, entity_id="ent-2", entity_type="uncertainty")
    s = ledger.summary()
    assert s["total_events"] == 3
    assert s["event_type_counts"]["OBSERVATION_RECORDED"] == 2
    assert s["event_type_counts"]["UNCERTAINTY_CREATED"] == 1
    assert s["unique_entities"] == 2
