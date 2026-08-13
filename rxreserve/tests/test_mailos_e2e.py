"""End-to-end test for RxMailOS: ingest → decompose → compile → route → verify."""

import json
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.mailos import MailObject, ObligationStatus, HCPIntentType, ObjectType, SystemOfRecord
from rxreserve.mailos_engine import (
    RxMailOS, SemanticDecomposer, ObligationCompiler, HCPIntentExtractor,
    NegativeActionEngine, ResponseDebtLedger, EngagementDiagnostic,
    ContentDemandMiner, CRMSynchronizer, MailEventBus, MailEventType,
)
from rxreserve.database import Database


def test_full_pipeline():
    """Test the complete email-to-action pipeline."""
    os = RxMailOS()

    # 1. Ingest a safety signal email from an HCP
    mail = MailObject(
        from_address="dr.smith@hospital.com",
        from_name="Dr. John Smith",
        from_type="hcp",
        to_addresses=["rep.jane@gilead.com"],
        subject="Patient adverse event on Biktarvy",
        body="My patient experienced severe nausea and fatigue after starting Biktarvy three weeks ago. Please send me the latest safety profile data. I'll follow up next week.",
        timestamp=datetime.now(timezone.utc).isoformat(),
        matched_hcp_id="hcp-001",
        matched_employee_id="emp-jane",
    )

    result = os.ingest(mail)

    # 2. Verify decomposition produced multiple objects
    assert len(result["objects"]) >= 2, f"Expected >=2 objects, got {len(result['objects'])}"
    object_types = [o["object_type"] for o in result["objects"]]
    assert "potential_safety_signal" in object_types, f"Safety signal not found in {object_types}"
    print(f"  [PASS] Decomposed into {len(result['objects'])} objects: {object_types}")

    # 3. Verify obligations were compiled
    assert len(result["obligations"]) >= 2, f"Expected >=2 obligations, got {len(result['obligations'])}"
    obl_types = [o["obligation_type"] for o in result["obligations"]]
    assert "safety_report" in obl_types, f"Safety report obligation not found in {obl_types}"
    print(f"  [PASS] Compiled {len(result['obligations'])} obligations: {obl_types}")

    # 4. Verify safety obligation has 24h regulatory deadline
    safety_obl = None
    for o in result["obligations"]:
        if o["obligation_type"] == "safety_report":
            safety_obl = o
            break
    assert safety_obl is not None
    assert safety_obl["is_regulatory_deadline"] is True
    assert safety_obl["deadline_hours"] == 24
    assert safety_obl["target_system"] == "safety"
    print(f"  [PASS] Safety obligation: 24h regulatory deadline, routed to safety system")

    # 5. Verify HCP intent was extracted
    assert result["intent"] is not None, "Intent should be extracted from HCP email"
    intent = result["intent"]
    assert intent["intent_type"] == "adverse_experience"
    assert intent["confidence"] >= 0.90
    print(f"  [PASS] HCP intent: {intent['intent_type']} (confidence={intent['confidence']})")

    # 6. Verify negative action was generated
    assert len(result["negative_actions"]) >= 1, "Negative action should be generated for AE"
    na = result["negative_actions"][0]
    assert na["action_type"] == "route_to_safety"
    print(f"  [PASS] Negative action: {na['action_type']} — {na['reason']}")

    # 7. Verify events were published
    assert len(result["events"]) >= 3, f"Expected >=3 events, got {len(result['events'])}"
    event_types = [e["event_type"] for e in result["events"]]
    assert "mail_ingested" in event_types
    assert "potential_safety_signal" in event_types
    assert "hcp_intent_detected" in event_types
    print(f"  [PASS] Published {len(result['events'])} events: {event_types}")

    # 8. Assign and execute the safety obligation
    safety_obl_id = safety_obl["obligation_id"]
    os.assign_obligation(safety_obl_id, "safety-team-lead", "pharmacovigilance")
    assert os.obligations[safety_obl_id].status == ObligationStatus.ASSIGNED
    print(f"  [PASS] Assigned safety obligation to safety-team-lead")

    os.execute_obligation(safety_obl_id, "Safety case SC-2024-001 created in safety system")
    assert os.obligations[safety_obl_id].status == ObligationStatus.EXECUTED
    print(f"  [PASS] Executed safety obligation with evidence: SC-2024-001")

    # 9. Verify the obligation
    obl, receipt = os.verify_obligation(
        safety_obl_id,
        verified_by="qa-reviewer",
        independent_signal="Safety case SC-2024-001 confirmed in safety database",
        independent_signal_source="safety_system",
    )
    assert obl.status == ObligationStatus.VERIFIED
    assert receipt.is_verified is True
    print(f"  [PASS] Verified by qa-reviewer with independent signal from safety_system")

    # 10. Check response debt
    debt = os.response_debt()
    assert debt.total_obligations >= 2
    assert debt.verified >= 1
    print(f"  [PASS] Response debt: {debt.total_obligations} total, {debt.unresolved} unresolved, {debt.verified} verified")

    # 11. Diagnose HCP engagement
    diag = os.diagnose_hcp("hcp-001")
    assert diag.hcp_id == "hcp-001"
    assert len(diag.diagnosis) > 0
    print(f"  [PASS] Engagement diagnosis: {diag.diagnosis}")

    # 12. CRM reconciliation
    discreps = os.crm_reconciliation()
    print(f"  [PASS] CRM reconciliation: {len(discreps)} discrepancies found")

    # 13. Summary
    summary = os.summary()
    assert summary["mails_ingested"] == 1
    assert summary["obligations_compiled"] >= 2
    assert summary["verifications"] == 1
    print(f"  [PASS] Summary: {json.dumps(summary, indent=2)}")

    print("\n=== Full pipeline test PASSED ===\n")


def test_database_persistence():
    """Test that mailos objects persist to and load from SQLite."""
    db = Database(":memory:")

    # Create and ingest
    os = RxMailOS()
    mail = MailObject(
        from_address="dr.jones@clinic.com",
        from_name="Dr. Mary Jones",
        from_type="hcp",
        to_addresses=["msl.bob@gilead.com"],
        subject="Request for drug interaction data",
        body="Can you send me information about Biktarvy drug interactions? I need the latest evidence.",
        timestamp=datetime.now(timezone.utc).isoformat(),
        matched_hcp_id="hcp-002",
        matched_employee_id="emp-bob",
    )
    result = os.ingest(mail)

    # Persist everything
    db.upsert_mail(mail)
    for o in os.objects.values():
        db.upsert_decomposed_object(o)
    for obl in os.obligations.values():
        db.upsert_obligation(obl)
    for c in os.commitments.values():
        db.upsert_commitment(c)
    for i in os.intents.values():
        db.upsert_intent(i)
    for na in os.negative_actions.values():
        db.upsert_negative_action(na)
    for ev in os.event_bus.events:
        db.upsert_mail_event(ev)

    # Load back
    loaded_mails = db.get_all_mails()
    assert len(loaded_mails) == 1
    assert loaded_mails[0].from_address == "dr.jones@clinic.com"
    print(f"  [PASS] Mail persisted and loaded: {loaded_mails[0].subject}")

    loaded_obls = db.get_all_obligations()
    assert len(loaded_obls) >= 1
    print(f"  [PASS] {len(loaded_obls)} obligations persisted and loaded")

    loaded_intents = db.get_all_intents()
    assert len(loaded_intents) == 1
    assert loaded_intents[0].intent_type.value == "wants_evidence"
    print(f"  [PASS] Intent persisted and loaded: {loaded_intents[0].intent_type.value}")

    print("\n=== Database persistence test PASSED ===\n")


def test_content_fatigue_flow():
    """Test content fatigue detection and negative action generation."""
    os = RxMailOS()
    mail = MailObject(
        from_address="dr.brown@hospital.com",
        from_name="Dr. Lisa Brown",
        from_type="hcp",
        to_addresses=["rep.tom@gilead.com"],
        subject="Re: Biktarvy updates",
        body="Please stop sending me these emails. I already have this information and I'm not interested in receiving more.",
        timestamp=datetime.now(timezone.utc).isoformat(),
        matched_hcp_id="hcp-003",
        matched_employee_id="emp-tom",
    )
    result = os.ingest(mail)

    assert result["intent"] is not None
    assert result["intent"]["intent_type"] == "content_fatigue"
    print(f"  [PASS] Content fatigue detected: confidence={result['intent']['confidence']}")

    assert len(result["negative_actions"]) >= 1
    na = result["negative_actions"][0]
    assert na["action_type"] == "do_not_send_campaign"
    print(f"  [PASS] Negative action: {na['action_type']}")

    print("\n=== Content fatigue test PASSED ===\n")


def test_access_barrier_flow():
    """Test access barrier detection and routing."""
    os = RxMailOS()
    mail = MailObject(
        from_address="dr.wilson@medicalcenter.com",
        from_name="Dr. James Wilson",
        from_type="hcp",
        to_addresses=["rep.sarah@gilead.com"],
        subject="Biktarvy formulary issue",
        body="Biktarvy is not covered on our hospital formulary. The insurance company requires prior authorization and step therapy. Can you help with this access problem?",
        timestamp=datetime.now(timezone.utc).isoformat(),
        matched_hcp_id="hcp-004",
        matched_employee_id="emp-sarah",
    )
    result = os.ingest(mail)

    object_types = [o["object_type"] for o in result["objects"]]
    assert "access_barrier" in object_types
    print(f"  [PASS] Access barrier detected in objects: {object_types}")

    obl_types = [o["obligation_type"] for o in result["obligations"]]
    assert "access_resolution" in obl_types
    access_obl = [o for o in result["obligations"] if o["obligation_type"] == "access_resolution"][0]
    assert access_obl["target_system"] == "market_access"
    assert access_obl["deadline_hours"] == 120
    print(f"  [PASS] Access obligation routed to market_access with 120h deadline")

    assert result["intent"]["intent_type"] == "access_problem"
    print(f"  [PASS] HCP intent: access_problem")

    print("\n=== Access barrier test PASSED ===\n")


def test_commitment_extraction():
    """Test that commitments are extracted from email text."""
    os = RxMailOS()
    mail = MailObject(
        from_address="rep.kate@gilead.com",
        from_name="Kate Johnson",
        from_type="rep",
        to_addresses=["dr.adams@clinic.com"],
        subject="Re: Your question about Biktarvy",
        body="I'll follow up with the latest efficacy data by end of week. Let me check on the drug interaction information and get back to you next week.",
        timestamp=datetime.now(timezone.utc).isoformat(),
        matched_hcp_id="hcp-005",
        matched_employee_id="emp-kate",
    )
    result = os.ingest(mail)

    assert len(result["commitments"]) >= 1, f"Expected commitments, got {len(result['commitments'])}"
    for c in result["commitments"]:
        print(f"  [PASS] Commitment: '{c['requested_action'][:50]}' by {c['promisor']}")
    print("\n=== Commitment extraction test PASSED ===\n")


def test_communication_graph():
    """Test communication graph construction."""
    os = RxMailOS()

    mail1 = MailObject(
        from_address="rep.jane@gilead.com", from_name="Jane", from_type="rep",
        to_addresses=["dr.smith@hospital.com"], subject="Update", body="Hello",
        matched_hcp_id="hcp-001", matched_employee_id="emp-jane",
    )
    mail2 = MailObject(
        from_address="dr.smith@hospital.com", from_name="Dr. Smith", from_type="hcp",
        to_addresses=["rep.jane@gilead.com"], subject="Re: Update", body="Thanks",
        matched_hcp_id="hcp-001", matched_employee_id="emp-jane",
    )
    os.ingest(mail1)
    os.ingest(mail2)

    summary = os.communication_graph_summary()
    assert summary["total_entities"] >= 2
    assert summary["total_communications"] >= 2
    print(f"  [PASS] Graph: {summary['total_entities']} entities, {summary['total_communications']} edges")

    influencers = os.influencers()
    assert len(influencers) >= 1
    print(f"  [PASS] Top influencer: {influencers[0]['entity']} (centrality={influencers[0]['centrality']})")

    print("\n=== Communication graph test PASSED ===\n")


if __name__ == "__main__":
    print("=== RxMailOS End-to-End Tests ===\n")
    test_full_pipeline()
    test_database_persistence()
    test_content_fatigue_flow()
    test_access_barrier_flow()
    test_commitment_extraction()
    test_communication_graph()
    print("=== ALL TESTS PASSED ===")
