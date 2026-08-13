"""RxMailOS Engine — the execution layer.

Implements the full pipeline: Email → Meaning → Obligation → Enterprise Action → Outcome → Evidence
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import re

from rxreserve.mailos import (
    MailObject, DecomposedObject, Obligation, ObligationStatus,
    Commitment, HCPIntent, HCPIntentType,
    NegativeAction, NegativeActionType,
    EngagementDiagnosis, ResponseDebt, ContentDemand,
    MailEvent, MailEventType, VerificationReceipt, InvisibleWorkChain,
    ObjectType, ObjectPriority, SystemOfRecord,
)
from rxreserve.franchise import FranchiseKnowledgeGraph, seed_biktarvy_descovy


# ─── Policy Registry ───

OBLIGATION_POLICIES: dict[str, dict[str, Any]] = {
    "safety_report": {
        "deadline_hours": 24, "is_regulatory": True,
        "policy_reference": "AE reporting within 24h per FDA 21 CFR 314.80",
        "regulatory_context": "21 CFR 314.80",
        "required_evidence": "Safety case created in safety system with confirmation ID",
        "verification_method": "Safety case ID exists and linked to obligation",
        "escalation_policy": "If not assigned within 4h escalate to safety lead; if not filed within 24h escalate to VP Safety",
        "target_system": SystemOfRecord.SAFETY,
    },
    "medical_response": {
        "deadline_hours": 72, "is_regulatory": False,
        "policy_reference": "Medical information response within 3 business days",
        "regulatory_context": "Internal SOP MED-001",
        "required_evidence": "Approved medical information response sent via MedInquiry",
        "verification_method": "MedInquiry case closed with response documented",
        "escalation_policy": "If not assigned within 24h escalate to medical affairs lead",
        "target_system": SystemOfRecord.MEDICAL,
    },
    "access_resolution": {
        "deadline_hours": 120, "is_regulatory": False,
        "policy_reference": "Access barrier resolution within 5 business days",
        "regulatory_context": "Internal SOP ACCESS-002",
        "required_evidence": "Access case resolved or escalated to payer team",
        "verification_method": "Access case status = resolved in CRM",
        "escalation_policy": "If not assigned within 48h escalate to market access director",
        "target_system": SystemOfRecord.MARKET_ACCESS,
    },
    "content_delivery": {
        "deadline_hours": 48, "is_regulatory": False,
        "policy_reference": "Requested content delivered within 2 business days",
        "regulatory_context": "Internal SOP COM-003",
        "required_evidence": "Approved content sent via Approved Email or equivalent",
        "verification_method": "Approved Email send record exists in CRM",
        "escalation_policy": "If not delivered within 48h escalate to brand lead",
        "target_system": SystemOfRecord.COMMERCIAL,
    },
    "quality_complaint": {
        "deadline_hours": 72, "is_regulatory": True,
        "policy_reference": "Product quality complaint within 72h per 21 CFR 211.198",
        "regulatory_context": "21 CFR 211.198",
        "required_evidence": "Quality case created in quality system",
        "verification_method": "Quality case ID exists and linked",
        "escalation_policy": "If not filed within 72h escalate to QA director",
        "target_system": SystemOfRecord.QUALITY,
    },
    "compliance_review": {
        "deadline_hours": 48, "is_regulatory": True,
        "policy_reference": "Compliance review within 48h",
        "regulatory_context": "Internal compliance policy COMP-001",
        "required_evidence": "Compliance review completed and documented",
        "verification_method": "Compliance review record exists",
        "escalation_policy": "If not reviewed within 48h escalate to compliance officer",
        "target_system": SystemOfRecord.COMPLIANCE,
    },
    "crm_activity": {
        "deadline_hours": 24, "is_regulatory": False,
        "policy_reference": "CRM activity logged within 24h",
        "regulatory_context": "Internal CRM policy",
        "required_evidence": "Activity record in Vault CRM",
        "verification_method": "CRM activity record exists",
        "escalation_policy": "If not logged within 24h notify manager",
        "target_system": SystemOfRecord.CRM,
    },
    "followup_commitment": {
        "deadline_hours": 48, "is_regulatory": False,
        "policy_reference": "Follow up on commitment within 2 business days",
        "regulatory_context": "Internal relationship policy",
        "required_evidence": "Follow-up action completed and documented",
        "verification_method": "Commitment status = executed or verified",
        "escalation_policy": "If overdue notify promisor and manager",
        "target_system": SystemOfRecord.CRM,
    },
}


# ─── Semantic Decomposer ───

class SemanticDecomposer:
    """Decompose 1 email into N regulated/business objects."""

    SAFETY_PATTERNS = [
        r"adverse\s+(event|reaction|effect)", r"side\s+effect",
        r"patient\s+(experienced|developed|had|reported)",
        r"experienced\s+\w+\s+(after|since|following)",
        r"started\s+(Biktarvy|Descovy|Gilead|treatment|therapy).*(?:and|then|afterwards)",
        r"rash|nausea|fatigue|headache|diarrhea|vomiting|hepatotoxicity|renal\s+impairment",
        r"product\s+quality", r"defective|damaged\s+product",
        r"wrong\s+(product|dosage|label)",
    ]
    MEDICAL_PATTERNS = [
        r"send\s+(me\s+)?(?:information|data|evidence|publication|study|details)",
        r"latest\s+(data|evidence|information)", r"drug\s+interaction",
        r"contraindication", r"dosing\s+(information|question|query)",
        r"efficacy\s+data", r"safety\s+profile",
        r"clinical\s+trial\s+(data|results)", r"mechanism\s+of\s+action",
        r"real[- ]world\s+(evidence|data)",
    ]
    ACCESS_PATTERNS = [
        r"formulary", r"access\s+(issue|problem|barrier|concern)",
        r"insurance|payer|coverage", r"prior\s+auth(orization)?",
        r"step\s+therapy", r"not\s+(covered|approved|on\s+formulary)",
        r"pharmacy\s+(director|manager)", r"hospital\s+formulary",
        r"cost|price|expensive|affordab", r"copay|out[- ]of[- ]pocket",
    ]
    SCHEDULING_PATTERNS = [
        r"meet(?:ing)?\s+(next|this|on|to)", r"schedule|scheduling",
        r"available\s+(next|this|on|Tuesday|Wednesday|Thursday|Friday|Monday)",
        r"can\s+(we|someone)\s+(meet|speak|talk|connect)",
        r"lunch\s+(and\s+learn|meeting|presentation)",
        r"speaker\s+(program|event|presentation)", r"presentation\s+(at|for|to)",
    ]
    COMMITMENT_PATTERNS = [
        r"(?:I'll|I\s+will|we'll|we\s+will)\s+(send|follow\s+up|get\s+back|check|connect|investigate|provide|share|reach\s+out|look\s+into|have\s+\w+\s+investigate)",
        r"let\s+me\s+(check|look\s+into|find\s+out|get\s+back)",
        r"send\s+me\s+(the|that)\s+(publication|data|information|study|evidence|details|brochure)",
        r"follow\s+up\s+(next|in|on|by)",
        r"get\s+back\s+to\s+you\s+(by|next|in|on|tomorrow|today)",
        r"by\s+(end\s+of\s+(?:week|day|month)|tomorrow|next\s+week|Friday|Monday)",
    ]
    FATIGUE_PATTERNS = [
        r"stop\s+(sending|emailing)", r"too\s+many\s+emails",
        r"unsubscribe|opt\s+out", r"not\s+interested",
        r"already\s+(have|received|seen)\s+(this|that|the\s+information)",
        r"please\s+(don't|do\s+not)\s+(send|email|contact)",
    ]
    ENGAGEMENT_PATTERNS = [
        r"very\s+(interested|helpful|useful|informative)",
        r"great\s+(information|data|presentation)",
        r"can\s+you\s+tell\s+me\s+more",
        r"what\s+else\s+(do|can)\s+you\s+(tell|share)",
        r"this\s+is\s+(very\s+)?(helpful|useful|interesting|relevant)",
        r"exactly\s+what\s+I\s+(needed|was\s+looking\s+for)",
    ]

    @classmethod
    def decompose(cls, mail: MailObject) -> list[DecomposedObject]:
        objects: list[DecomposedObject] = []
        text = f"{(mail.subject or '').lower()}\n{(mail.body or '').lower()}"

        def _match(patterns):
            for p in patterns:
                m = re.search(p, text, re.IGNORECASE)
                if m:
                    return m
            return None

        # Safety
        m = _match(cls.SAFETY_PATTERNS)
        if m:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.POTENTIAL_SAFETY_SIGNAL,
                priority=ObjectPriority.CRITICAL, summary="Potential adverse event or product quality signal",
                extracted_text=m.group(0), target_system=SystemOfRecord.SAFETY,
                routing_confidence=0.95, hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Medical info
        m = _match(cls.MEDICAL_PATTERNS)
        if m:
            topic = ""
            tm = re.search(r"(?:about|on|for|regarding)\s+(\w+(?:\s+\w+){0,3})", text)
            if tm:
                topic = tm.group(1)
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.MEDICAL_INFORMATION_REQUEST,
                priority=ObjectPriority.HIGH, summary=f"Medical information request: {m.group(0)}",
                detail=f"Topic: {topic}" if topic else "", extracted_text=m.group(0),
                target_system=SystemOfRecord.MEDICAL, routing_confidence=0.85,
                topic=topic, hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Access
        m = _match(cls.ACCESS_PATTERNS)
        if m:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.ACCESS_BARRIER,
                priority=ObjectPriority.HIGH, summary=f"Access/formulary barrier: {m.group(0)}",
                extracted_text=m.group(0), target_system=SystemOfRecord.MARKET_ACCESS,
                routing_confidence=0.80, hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Scheduling
        m = _match(cls.SCHEDULING_PATTERNS)
        if m:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.SCHEDULING_INTENT,
                priority=ObjectPriority.MEDIUM, summary=f"Scheduling signal: {m.group(0)}",
                extracted_text=m.group(0), target_system=SystemOfRecord.CRM,
                routing_confidence=0.75, hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Content request
        cm = re.search(r"send\s+me\s+(?:the\s+)?(?:latest\s+)?(?:data|evidence|publication|brochure|information|details|study|results)", text, re.IGNORECASE)
        if cm:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.CONTENT_REQUEST,
                priority=ObjectPriority.MEDIUM, summary=f"Content request: {cm.group(0)}",
                extracted_text=cm.group(0), target_system=SystemOfRecord.COMMERCIAL,
                routing_confidence=0.70, hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Relationship signal
        if mail.matched_hcp_id:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.HCP_RELATIONSHIP_SIGNAL,
                priority=ObjectPriority.LOW, summary="HCP communication — relationship signal",
                target_system=SystemOfRecord.CRM, routing_confidence=0.60,
                hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        # Fallback
        if not objects:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id, object_type=ObjectType.COMMERCIAL_FOLLOWUP,
                priority=ObjectPriority.LOW, summary="General communication — requires review",
                target_system=SystemOfRecord.CRM, routing_confidence=0.40,
                hcp_id=mail.matched_hcp_id, employee_id=mail.matched_employee_id,
            ))

        return objects


# ─── Obligation Compiler ───

class ObligationCompiler:
    """Compile decomposed objects into executable obligations."""

    OBJECT_TO_OBLIGATION: dict[ObjectType, str] = {
        ObjectType.POTENTIAL_SAFETY_SIGNAL: "safety_report",
        ObjectType.MEDICAL_INFORMATION_REQUEST: "medical_response",
        ObjectType.ACCESS_BARRIER: "access_resolution",
        ObjectType.CONTENT_REQUEST: "content_delivery",
        ObjectType.QUALITY_SIGNAL: "quality_complaint",
        ObjectType.COMPLIANCE_REVIEW_REQUIRED: "compliance_review",
        ObjectType.COMMERCIAL_FOLLOWUP: "crm_activity",
        ObjectType.SCHEDULING_INTENT: "crm_activity",
        ObjectType.HCP_RELATIONSHIP_SIGNAL: "crm_activity",
        ObjectType.FORMULARY_CONCERN: "access_resolution",
        ObjectType.SPEAKER_PROGRAM_REQUEST: "crm_activity",
        ObjectType.PATIENT_SUPPORT_REQUEST: "crm_activity",
    }

    @classmethod
    def compile(cls, obj: DecomposedObject) -> Obligation:
        otype = cls.OBJECT_TO_OBLIGATION.get(obj.object_type, "crm_activity")
        pol = OBLIGATION_POLICIES.get(otype, OBLIGATION_POLICIES["crm_activity"])
        now = datetime.now(timezone.utc)
        deadline = now + timedelta(hours=pol["deadline_hours"])

        obl = Obligation(
            object_id=obj.object_id, mail_id=obj.mail_id, obligation_type=otype,
            description=obj.summary, required_action=obj.summary,
            policy_reference=pol["policy_reference"], regulatory_context=pol["regulatory_context"],
            deadline=deadline.isoformat(), deadline_hours=pol["deadline_hours"],
            is_regulatory_deadline=pol["is_regulatory"], target_system=pol["target_system"],
            required_evidence=pol["required_evidence"], verification_method=pol["verification_method"],
            escalation_policy=pol["escalation_policy"], hcp_id=obj.hcp_id, employee_id=obj.employee_id,
        )
        obl.status_history.append({"status": ObligationStatus.DEFINED.value, "timestamp": now.isoformat(), "actor": "system"})
        return obl


# ─── Commitment Extractor ───

class CommitmentExtractor:
    """Extract commitments (promises) from email text."""

    @classmethod
    def extract(cls, mail: MailObject) -> list[Commitment]:
        commitments: list[Commitment] = []
        text = f"{mail.subject}\n{mail.body}"

        for pattern in SemanticDecomposer.COMMITMENT_PATTERNS:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                deadline = ""
                dm = re.search(r"(?:by|next|in|on|tomorrow|today)\s+(\w+(?:\s+\w+){0,2})", text[match.end():match.end() + 50])
                if dm:
                    deadline = dm.group(0)

                promisor_type = "hcp" if mail.from_type == "hcp" else "employee"
                commitments.append(Commitment(
                    mail_id=mail.mail_id, promisor=mail.from_name or mail.from_address,
                    promisor_type=promisor_type, recipient="recipient",
                    recipient_type="hcp" if promisor_type == "employee" else "employee",
                    requested_action=match.group(0), deadline=deadline,
                    system_owner=SystemOfRecord.CRM, hcp_id=mail.matched_hcp_id,
                    employee_id=mail.matched_employee_id if promisor_type == "employee" else "",
                ))
        return commitments


# ─── HCP Intent Extractor ───

class HCPIntentExtractor:
    """Extract intent from HCP email replies."""

    @classmethod
    def extract(cls, mail: MailObject) -> Optional[HCPIntent]:
        if mail.from_type != "hcp":
            return None
        text = f"{mail.subject}\n{mail.body}".lower()

        def _first(patterns):
            for p in patterns:
                m = re.search(p, text, re.IGNORECASE)
                if m:
                    return m
            return None

        # Content fatigue
        m = _first(SemanticDecomposer.FATIGUE_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.CONTENT_FATIGUE, confidence=0.90,
                summary="HCP is experiencing content fatigue", extracted_text=m.group(0),
                relationship_impact="negative",
                next_best_action="Pause promotional sends; route to medical if clinical question present",
                negative_action="do_not_send_campaign")

        # High engagement
        m = _first(SemanticDecomposer.ENGAGEMENT_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.HIGH_ENGAGEMENT, confidence=0.85,
                summary="HCP showing high engagement", extracted_text=m.group(0),
                relationship_impact="positive",
                next_best_action="Schedule in-person or virtual meeting; deliver deeper evidence")

        # Adverse experience
        m = _first(SemanticDecomposer.SAFETY_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.ADVERSE_EXPERIENCE, confidence=0.95,
                summary="HCP reporting potential adverse event", extracted_text=m.group(0),
                relationship_impact="critical",
                next_best_action="Route to safety immediately; do not promote",
                negative_action="route_to_safety")

        # Access problem
        m = _first(SemanticDecomposer.ACCESS_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.ACCESS_PROBLEM, confidence=0.80,
                summary="HCP reporting access/formulary problem", extracted_text=m.group(0),
                relationship_impact="negative",
                next_best_action="Route to market access team; do not send promotional content until resolved",
                negative_action="route_to_access")

        # Wants evidence
        m = _first(SemanticDecomposer.MEDICAL_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.WANTS_EVIDENCE, confidence=0.80,
                summary="HCP requesting evidence or data", extracted_text=m.group(0),
                relationship_impact="positive",
                next_best_action="Route to medical information; find approved evidence path")

        # Scheduling
        m = _first(SemanticDecomposer.SCHEDULING_PATTERNS)
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.SCHEDULING_SIGNAL, confidence=0.75,
                summary="HCP wants to meet", extracted_text=m.group(0),
                relationship_impact="positive",
                next_best_action="Propose meeting via CRM; prepare relevant content")

        # Skeptical
        m = _first([r"not\s+(sure|convinced|certain)", r"skeptical", r"concern(?:ed)?\s+about", r"what\s+about\s+(the\s+)?risk"])
        if m:
            return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
                intent_type=HCPIntentType.SKEPTICAL, confidence=0.70,
                summary="HCP expressing skepticism", extracted_text=m.group(0),
                relationship_impact="neutral",
                next_best_action="Route scientific question to medical; prepare evidence addressing specific concern")

        return HCPIntent(mail_id=mail.mail_id, hcp_id=mail.matched_hcp_id,
            intent_type=HCPIntentType.TREATMENT_QUESTION, confidence=0.50,
            summary="HCP communication — general", relationship_impact="neutral",
            next_best_action="Review and route appropriately")


# ─── Negative Action Engine ───

class NegativeActionEngine:
    """What must the rep NOT do next?"""

    _INTENT_MAP = {
        HCPIntentType.CONTENT_FATIGUE: (NegativeActionType.DO_NOT_SEND_CAMPAIGN, "HCP expressed content fatigue"),
        HCPIntentType.ADVERSE_EXPERIENCE: (NegativeActionType.ROUTE_TO_SAFETY, "Potential AE — do not promote, route to safety"),
        HCPIntentType.ACCESS_PROBLEM: (NegativeActionType.ROUTE_TO_ACCESS, "Access issue — do not promote until resolved"),
        HCPIntentType.SKEPTICAL: (NegativeActionType.ANSWER_EXISTING_QUESTION_FIRST, "Address skepticism before sending promotional content"),
        HCPIntentType.DISENGAGING: (NegativeActionType.DO_NOT_EMAIL, "HCP is disengaging — pause email sends"),
    }

    @classmethod
    def from_intent(cls, intent: HCPIntent) -> Optional[NegativeAction]:
        if intent.intent_type in cls._INTENT_MAP:
            at, reason = cls._INTENT_MAP[intent.intent_type]
            return NegativeAction(
                hcp_id=intent.hcp_id, action_type=at, reason=reason,
                duration="until resolved" if intent.intent_type in (HCPIntentType.ADVERSE_EXPERIENCE, HCPIntentType.ACCESS_PROBLEM) else "30 days",
                source_intent_id=intent.intent_id,
            )
        return None

    @classmethod
    def from_obligation(cls, obligation: Obligation) -> Optional[NegativeAction]:
        if obligation.status == ObligationStatus.OVERDUE:
            return NegativeAction(
                hcp_id=obligation.hcp_id,
                action_type=NegativeActionType.ANSWER_EXISTING_QUESTION_FIRST,
                reason=f"Unresolved obligation: {obligation.description}",
                duration="until obligation closed",
                source_obligation_id=obligation.obligation_id,
            )
        return None


# ─── Engagement Diagnostic ───

class EngagementDiagnostic:
    """Why did this HCP go silent?"""

    @classmethod
    def diagnose(cls, hcp_id: str, mails: list[MailObject],
                 obligations: list[Obligation], intents: list[HCPIntent]) -> EngagementDiagnosis:
        now = datetime.now(timezone.utc)
        hcp_mails = [m for m in mails if m.matched_hcp_id == hcp_id]
        hcp_obls = [o for o in obligations if o.hcp_id == hcp_id]
        hcp_intents = [i for i in intents if i.hcp_id == hcp_id]

        hcp_replies = [m for m in hcp_mails if m.from_type == "hcp"]
        last_reply = None
        if hcp_replies:
            sr = sorted(hcp_replies, key=lambda m: m.timestamp or m.created_at.isoformat(), reverse=True)
            last_reply = sr[0]
            t = datetime.fromisoformat(sr[0].timestamp) if sr[0].timestamp else sr[0].created_at
            days_since = (now - t).days
        else:
            days_since = 999

        emp_sends = [m for m in hcp_mails if m.from_type in ("rep", "employee", "msl")]
        consecutive_promo = 0
        for m in sorted(emp_sends, key=lambda m: m.timestamp or m.created_at.isoformat(), reverse=True):
            if any(r.timestamp and m.timestamp and r.timestamp > m.timestamp for r in hcp_replies):
                break
            consecutive_promo += 1

        unresolved = [o for o in hcp_obls if o.status not in (ObligationStatus.VERIFIED, ObligationStatus.CLOSED)]
        fatigue = [i for i in hcp_intents if i.intent_type == HCPIntentType.CONTENT_FATIGUE]
        evidence_delivered = any(o.obligation_type == "content_delivery" and o.status == ObligationStatus.VERIFIED for o in hcp_obls)

        friction: list[str] = []
        if consecutive_promo >= 3:
            friction.append(f"{consecutive_promo} consecutive promotional sends without reply")
        if not evidence_delivered:
            friction.append("no novel evidence delivered")
        if unresolved:
            friction.append(f"{len(unresolved)} unresolved question(s)/obligation(s)")
        if fatigue:
            friction.append("HCP previously expressed content fatigue")
        if days_since > 30:
            friction.append(f"last meaningful reply was {days_since} days ago")

        if days_since > 60 and consecutive_promo >= 4:
            diag = "HCP is likely disengaging due to over-saturation and unresolved needs"
            interv = "Stop all promotional sends. Resolve open obligations. Route scientific questions to medical."
            neg = ["do_not_send_campaign", "answer_existing_question_first", "route_to_medical"]
        elif days_since > 30 and unresolved:
            diag = "HCP may be waiting for resolution of open questions"
            interv = "Resolve open obligations before sending any new content"
            neg = ["answer_existing_question_first", "do_not_send_campaign"]
        elif consecutive_promo >= 3:
            diag = "HCP may be experiencing promotional fatigue"
            interv = "Pause promotional sends; deliver novel evidence or route to medical"
            neg = ["do_not_send_campaign"]
        elif fatigue:
            diag = "HCP has explicitly requested fewer emails"
            interv = "Honor opt-down; switch to medical/educational content only"
            neg = ["do_not_email", "do_not_promote"]
        else:
            diag = "Engagement appears stable"
            interv = "Continue current cadence; monitor for changes"
            neg = []

        return EngagementDiagnosis(
            hcp_id=hcp_id, last_meaningful_reply=last_reply.timestamp if last_reply else "",
            days_since_reply=days_since if days_since < 999 else -1,
            friction_factors=friction, consecutive_promotional_sends=consecutive_promo,
            novel_evidence_delivered=evidence_delivered, unresolved_questions=len(unresolved),
            diagnosis=diag, recommended_intervention=interv, recommended_negative_actions=neg,
        )


# ─── Response Debt Ledger ───

class ResponseDebtLedger:
    """Enterprise-wide graph of unanswered obligations."""

    @classmethod
    def compute(cls, obligations: list[Obligation]) -> ResponseDebt:
        total = len(obligations)
        unresolved = [o for o in obligations if o.status not in (ObligationStatus.VERIFIED, ObligationStatus.CLOSED)]
        overdue = [o for o in obligations if o.status == ObligationStatus.OVERDUE]
        escalated = [o for o in obligations if o.status == ObligationStatus.ESCALATED]
        verified = [o for o in obligations if o.status == ObligationStatus.VERIFIED]
        closed = [o for o in obligations if o.status == ObligationStatus.CLOSED]

        by_type: dict[str, int] = {}
        for o in unresolved:
            by_type[o.obligation_type] = by_type.get(o.obligation_type, 0) + 1

        by_system: dict[str, int] = {}
        for o in unresolved:
            sn = o.target_system.value
            by_system[sn] = by_system.get(sn, 0) + 1

        now = datetime.now(timezone.utc)
        scored = []
        for o in unresolved:
            reg_risk = 1.0 if o.is_regulatory_deadline else 0.3
            hrs_left = max(0, (datetime.fromisoformat(o.deadline) - now).total_seconds() / 3600) if o.deadline else 999
            time_sens = max(0, 1.0 - (hrs_left / max(1, o.deadline_hours))) if o.deadline_hours else 0.5
            rel_val = 0.7 if o.hcp_id else 0.3
            biz_impact = 0.8 if o.obligation_type in ("safety_report", "medical_response") else 0.5
            pri = reg_risk * time_sens * rel_val * biz_impact * 100
            scored.append((o, pri))

        scored.sort(key=lambda x: x[1], reverse=True)
        top = [{"obligation_id": o.obligation_id, "type": o.obligation_type, "description": o.description,
                "deadline": o.deadline, "status": o.status.value, "priority_score": round(p, 2), "hcp_id": o.hcp_id}
               for o, p in scored[:10]]

        return ResponseDebt(
            total_obligations=total, unresolved=len(unresolved), overdue=len(overdue),
            escalated=len(escalated), verified=len(verified), closed=len(closed),
            by_type=by_type, by_system=by_system, top_debts=top,
            total_priority_score=sum(p for _, p in scored),
        )


# ─── Content Demand Miner ───

class ContentDemandMiner:
    """Aggregate HCP content requests into demand signals."""

    @classmethod
    def mine(cls, intents: list[HCPIntent], objects: list[DecomposedObject],
             franchise_kg: Optional[FranchiseKnowledgeGraph] = None) -> list[ContentDemand]:
        groups: dict[str, list[DecomposedObject]] = {}
        for obj in objects:
            if obj.object_type in (ObjectType.CONTENT_REQUEST, ObjectType.MEDICAL_INFORMATION_REQUEST):
                key = obj.clinical_topic or obj.topic or "general"
                groups.setdefault(key, []).append(obj)

        demands: list[ContentDemand] = []
        for topic, objs in groups.items():
            unique_hcps = len({o.hcp_id for o in objs if o.hcp_id})
            has_content = True
            gap = False
            if franchise_kg:
                path = franchise_kg.find_evidence_path(topic, channel="email", role="rep")
                has_content = path is not None and len(path.evidence) > 0
                gap = not has_content

            demands.append(ContentDemand(
                topic=topic, clinical_topic=topic, request_count=len(objs),
                unique_hcps=unique_hcps, trend_direction="up" if len(objs) > 3 else "stable",
                trend_percentage=float(len(objs) * 20), has_approved_content=has_content,
                content_gap=gap, source_mail_ids=[o.mail_id for o in objs],
                routed_to="medical" if gap else "commercial",
                routing_rationale="No approved content — route to Medical Affairs" if gap else "Approved content available — route to Commercial",
            ))
        return demands


# ─── CRM Synchronizer ───

class CRMSynchronizer:
    """Inbox to CRM reconciliation."""

    @classmethod
    def reconcile(cls, mails: list[MailObject], obligations: list[Obligation]) -> list[dict[str, Any]]:
        discreps: list[dict[str, Any]] = []
        for mail in mails:
            if mail.matched_hcp_id and not mail.decomposed:
                discreps.append({"type": "unlogged_interaction", "mail_id": mail.mail_id,
                    "hcp_id": mail.matched_hcp_id, "description": "Email not decomposed/logged",
                    "severity": "medium", "proposed_action": "Decompose and create CRM activity"})
        for obl in obligations:
            if obl.status == ObligationStatus.DEFINED:
                discreps.append({"type": "unassigned_obligation", "obligation_id": obl.obligation_id,
                    "hcp_id": obl.hcp_id, "description": f"Obligation '{obl.description}' not assigned",
                    "severity": "high" if obl.is_regulatory_deadline else "medium",
                    "proposed_action": f"Assign to {obl.target_system.value} team"})
            if obl.status == ObligationStatus.OVERDUE:
                discreps.append({"type": "overdue_obligation", "obligation_id": obl.obligation_id,
                    "hcp_id": obl.hcp_id, "description": f"Obligation '{obl.description}' overdue",
                    "severity": "critical" if obl.is_regulatory_deadline else "high",
                    "proposed_action": "Escalate per policy"})
        return discreps


# ─── Invisible Work Attributor ───

class InvisibleWorkAttributor:
    """Build attribution chains for invisible work discovered in email."""

    @classmethod
    def build_chain(cls, signal_mail: MailObject, intervention_mails: list[MailObject],
                    resolution: str, outcome: str, hcp_id: str = "", value: float = 0.0) -> InvisibleWorkChain:
        chain: list[dict[str, str]] = [{
            "employee": signal_mail.matched_employee_id or signal_mail.from_name,
            "role": "detector", "action": "identified signal in email",
            "mail_id": signal_mail.mail_id,
            "timestamp": signal_mail.timestamp or signal_mail.created_at.isoformat(),
        }]
        coalition = set()
        for mail in intervention_mails:
            emp = mail.matched_employee_id or mail.from_name
            coalition.add(emp)
            chain.append({"employee": emp, "role": "intervener",
                "action": mail.subject or "coordinated via email", "mail_id": mail.mail_id,
                "timestamp": mail.timestamp or mail.created_at.isoformat()})

        return InvisibleWorkChain(
            originating_employee=signal_mail.matched_employee_id or signal_mail.from_name,
            signal=signal_mail.subject or "access problem identified",
            signal_mail_id=signal_mail.mail_id, intervention="Email coordination across team",
            coalition=list(coalition), resolution=resolution, commercial_outcome=outcome,
            attribution_chain=chain, hcp_id=hcp_id, value=value,
        )


# ─── Mail Event Bus ───

class MailEventBus:
    """Enterprise email event bus. Systems subscribe to events they own."""

    def __init__(self):
        self.events: list[MailEvent] = []
        self._subscribers: dict[str, list[str]] = {}

    def subscribe(self, event_type: MailEventType, system: str) -> None:
        self._subscribers.setdefault(event_type.value, []).append(system)

    def publish(self, event: MailEvent) -> None:
        self.events.append(event)
        event.processed_by = self._subscribers.get(event.event_type.value, [])

    @classmethod
    def from_decomposition(cls, mail: MailObject, objects: list[DecomposedObject],
                           intent: Optional[HCPIntent] = None,
                           commitments: Optional[list[Commitment]] = None) -> list[MailEvent]:
        events: list[MailEvent] = []
        now = datetime.now(timezone.utc).isoformat()

        events.append(MailEvent(event_type=MailEventType.MAIL_INGESTED, mail_id=mail.mail_id,
            timestamp=now, payload={"from": mail.from_address, "subject": mail.subject}, target_systems=["crm"]))

        _obj_event_map = {
            ObjectType.POTENTIAL_SAFETY_SIGNAL: MailEventType.POTENTIAL_SAFETY_SIGNAL,
            ObjectType.MEDICAL_INFORMATION_REQUEST: MailEventType.MEDICAL_REQUEST_DETECTED,
            ObjectType.ACCESS_BARRIER: MailEventType.ACCESS_BARRIER,
            ObjectType.CONTENT_REQUEST: MailEventType.CONTENT_REQUEST,
            ObjectType.SCHEDULING_INTENT: MailEventType.SCHEDULING_INTENT,
            ObjectType.QUALITY_SIGNAL: MailEventType.QUALITY_SIGNAL,
            ObjectType.COMPLIANCE_REVIEW_REQUIRED: MailEventType.COMPLIANCE_REVIEW_REQUIRED,
        }
        for obj in objects:
            et = _obj_event_map.get(obj.object_type)
            if et:
                events.append(MailEvent(event_type=et, mail_id=mail.mail_id, timestamp=now,
                    payload={"object_id": obj.object_id, "summary": obj.summary, "priority": obj.priority.value},
                    target_systems=[obj.target_system.value]))

        if intent:
            events.append(MailEvent(event_type=MailEventType.HCP_INTENT_DETECTED, mail_id=mail.mail_id,
                timestamp=now, payload={"intent_type": intent.intent_type.value, "confidence": intent.confidence,
                "hcp_id": intent.hcp_id}, target_systems=["crm", "commercial"]))
            if intent.intent_type in (HCPIntentType.CONTENT_FATIGUE, HCPIntentType.DISENGAGING):
                events.append(MailEvent(event_type=MailEventType.HCP_DISENGAGING, mail_id=mail.mail_id,
                    timestamp=now, payload={"hcp_id": intent.hcp_id, "intent": intent.intent_type.value},
                    target_systems=["crm", "commercial"]))

        if commitments:
            for c in commitments:
                events.append(MailEvent(event_type=MailEventType.FOLLOWUP_COMMITMENT, mail_id=mail.mail_id,
                    timestamp=now, payload={"commitment_id": c.commitment_id, "promisor": c.promisor,
                    "action": c.requested_action}, target_systems=["crm"]))

        return events


# ─── Verification Ledger ───

class VerificationLedger:
    """Independent verification of obligation closure."""

    @classmethod
    def verify(cls, obligation: Obligation, evidence_artifact: str, verified_by: str,
               independent_signal: str = "", independent_signal_source: str = "") -> VerificationReceipt:
        is_verified = bool(evidence_artifact)
        return VerificationReceipt(
            obligation_id=obligation.obligation_id, verification_method=obligation.verification_method,
            evidence_artifact=evidence_artifact, verified_by=verified_by,
            verified_at=datetime.now(timezone.utc).isoformat(),
            independent_signal=independent_signal, independent_signal_source=independent_signal_source,
            is_verified=is_verified,
        )


# ─── Communication Graph ───

class CommunicationGraph:
    """Email-derived enterprise/HCP relationship graph."""

    def __init__(self):
        import networkx as nx
        self.graph = nx.DiGraph()

    def add_mail(self, mail: MailObject) -> None:
        sender = mail.from_address or mail.from_name
        if not sender:
            return
        self.graph.add_node(sender, type=mail.from_type or "unknown", name=mail.from_name)
        for r in mail.to_addresses + mail.cc_addresses:
            self.graph.add_node(r, type="unknown")
            self.graph.add_edge(sender, r, mail_id=mail.mail_id, subject=mail.subject,
                                timestamp=mail.timestamp or mail.created_at.isoformat())

    def get_relationships(self, entity: str) -> dict[str, Any]:
        if entity not in self.graph:
            return {"entity": entity, "connections": []}
        conns = [{"target": t, "target_type": self.graph.nodes[t].get("type"),
                  "subject": d.get("subject"), "timestamp": d.get("timestamp")}
                 for _, t, d in self.graph.edges(entity, data=True)]
        return {"entity": entity, "type": self.graph.nodes[entity].get("type"),
                "connection_count": len(conns), "connections": conns}

    def get_influencers(self) -> list[dict[str, Any]]:
        import networkx as nx
        if len(self.graph) == 0:
            return []
        cent = nx.degree_centrality(self.graph)
        return [{"entity": n, "type": self.graph.nodes[n].get("type"),
                 "centrality": round(s, 4), "degree": self.graph.degree(n)}
                for n, s in sorted(cent.items(), key=lambda x: x[1], reverse=True)[:20]]

    def summary(self) -> dict[str, Any]:
        types = {}
        for n in self.graph.nodes:
            t = self.graph.nodes[n].get("type", "unknown")
            types[t] = types.get(t, 0) + 1
        return {"total_entities": len(self.graph.nodes), "total_communications": len(self.graph.edges), "entity_types": types}


# ─── RxMailOS — The Orchestrator ───

class RxMailOS:
    """The complete pharmaceutical communication execution layer.

    Email -> Meaning -> Obligation -> Enterprise Action -> Outcome -> Evidence
    """

    def __init__(self, franchise_kg: Optional[FranchiseKnowledgeGraph] = None, use_llm: bool = False):
        self.franchise_kg = franchise_kg or seed_biktarvy_descovy()
        self.use_llm = use_llm
        self._llm_extractor = None
        self.mails: dict[str, MailObject] = {}
        self.objects: dict[str, DecomposedObject] = {}
        self.obligations: dict[str, Obligation] = {}
        self.commitments: dict[str, Commitment] = {}
        self.intents: dict[str, HCPIntent] = {}
        self.negative_actions: dict[str, NegativeAction] = {}
        self.receipts: dict[str, VerificationReceipt] = {}
        self.event_bus = MailEventBus()
        self.comm_graph = CommunicationGraph()

    def _get_llm_extractor(self):
        if self._llm_extractor is None:
            from rxreserve.llm_extractor import LLMExtractor
            self._llm_extractor = LLMExtractor()
        return self._llm_extractor

    def ingest(self, mail: MailObject) -> dict[str, Any]:
        """Ingest an email and run the full pipeline."""
        self.mails[mail.mail_id] = mail
        self.comm_graph.add_mail(mail)

        if self.use_llm:
            extraction = self._get_llm_extractor().extract(mail)
            objects = extraction["objects"]
            intent = extraction.get("intent")
            commitments = extraction.get("commitments", [])
        else:
            objects = SemanticDecomposer.decompose(mail)
            intent = HCPIntentExtractor.extract(mail)
            commitments = CommitmentExtractor.extract(mail)

        mail.decomposed = True
        mail.decomposed_object_ids = [o.object_id for o in objects]

        result: dict[str, Any] = {
            "mail_id": mail.mail_id, "objects": [], "obligations": [],
            "commitments": [], "intent": None, "negative_actions": [], "events": [],
            "extraction_method": "llm" if self.use_llm else "regex",
        }

        for obj in objects:
            self.objects[obj.object_id] = obj
            obl = ObligationCompiler.compile(obj)
            obj.obligation_id = obl.obligation_id
            self.obligations[obl.obligation_id] = obl
            result["objects"].append(obj.to_dict())
            result["obligations"].append(obl.to_dict())

        for c in commitments:
            self.commitments[c.commitment_id] = c
            result["commitments"].append(c.to_dict())

        if intent:
            self.intents[intent.intent_id] = intent
            result["intent"] = intent.to_dict()
            neg = NegativeActionEngine.from_intent(intent)
            if neg:
                self.negative_actions[neg.action_id] = neg
                result["negative_actions"].append(neg.to_dict())

        events = MailEventBus.from_decomposition(mail, objects, intent, commitments)
        for ev in events:
            self.event_bus.publish(ev)
            result["events"].append(ev.to_dict())

        return result

    def assign_obligation(self, obligation_id: str, owner: str, team: str = "") -> Obligation:
        obl = self.obligations.get(obligation_id)
        if not obl:
            raise KeyError(f"Obligation {obligation_id} not found")
        obl.assigned_owner = owner
        obl.assigned_team = team
        obl.status = ObligationStatus.ASSIGNED
        obl.status_history.append({"status": ObligationStatus.ASSIGNED.value, "timestamp": datetime.now(timezone.utc).isoformat(), "actor": owner})
        return obl

    def execute_obligation(self, obligation_id: str, evidence_artifact: str) -> Obligation:
        obl = self.obligations.get(obligation_id)
        if not obl:
            raise KeyError(f"Obligation {obligation_id} not found")
        obl.evidence_artifact = evidence_artifact
        obl.status = ObligationStatus.EXECUTED
        obl.status_history.append({"status": ObligationStatus.EXECUTED.value, "timestamp": datetime.now(timezone.utc).isoformat(), "actor": obl.assigned_owner})
        return obl

    def verify_obligation(self, obligation_id: str, verified_by: str,
                          independent_signal: str = "", independent_signal_source: str = "") -> tuple[Obligation, VerificationReceipt]:
        obl = self.obligations.get(obligation_id)
        if not obl:
            raise KeyError(f"Obligation {obligation_id} not found")
        receipt = VerificationLedger.verify(obl, obl.evidence_artifact, verified_by, independent_signal, independent_signal_source)
        if receipt.is_verified:
            obl.status = ObligationStatus.VERIFIED
            obl.verified_by = verified_by
            obl.verified_at = receipt.verified_at
            obl.closed_at = datetime.now(timezone.utc).isoformat()
            obl.status_history.append({"status": ObligationStatus.VERIFIED.value, "timestamp": obl.verified_at, "actor": verified_by})
            self.event_bus.publish(MailEvent(event_type=MailEventType.OBLIGATION_VERIFIED, mail_id=obl.mail_id,
                timestamp=obl.verified_at, payload={"obligation_id": obligation_id, "verified_by": verified_by},
                target_systems=[obl.target_system.value]))
        self.receipts[receipt.receipt_id] = receipt
        return obl, receipt

    def check_overdue(self) -> list[Obligation]:
        now = datetime.now(timezone.utc)
        overdue: list[Obligation] = []
        for obl in self.obligations.values():
            if obl.status in (ObligationStatus.DEFINED, ObligationStatus.ASSIGNED, ObligationStatus.IN_PROGRESS):
                if obl.deadline and now > datetime.fromisoformat(obl.deadline):
                    obl.status = ObligationStatus.OVERDUE
                    obl.status_history.append({"status": ObligationStatus.OVERDUE.value, "timestamp": now.isoformat(), "actor": "system"})
                    overdue.append(obl)
                    self.event_bus.publish(MailEvent(event_type=MailEventType.OBLIGATION_OVERDUE, mail_id=obl.mail_id,
                        timestamp=now.isoformat(), payload={"obligation_id": obl.obligation_id, "type": obl.obligation_type},
                        target_systems=[obl.target_system.value]))
        return overdue

    def response_debt(self) -> ResponseDebt:
        return ResponseDebtLedger.compute(list(self.obligations.values()))

    def diagnose_hcp(self, hcp_id: str) -> EngagementDiagnosis:
        return EngagementDiagnostic.diagnose(hcp_id, list(self.mails.values()),
            list(self.obligations.values()), list(self.intents.values()))

    def content_demand(self) -> list[ContentDemand]:
        return ContentDemandMiner.mine(list(self.intents.values()), list(self.objects.values()), self.franchise_kg)

    def crm_reconciliation(self) -> list[dict[str, Any]]:
        return CRMSynchronizer.reconcile(list(self.mails.values()), list(self.obligations.values()))

    def negative_actions_for_hcp(self, hcp_id: str) -> list[NegativeAction]:
        return [a for a in self.negative_actions.values() if a.hcp_id == hcp_id]

    def communication_graph_summary(self) -> dict[str, Any]:
        return self.comm_graph.summary()

    def influencers(self) -> list[dict[str, Any]]:
        return self.comm_graph.get_influencers()

    def pending_obligations(self, system: Optional[str] = None) -> list[Obligation]:
        obls = [o for o in self.obligations.values() if o.status not in (ObligationStatus.VERIFIED, ObligationStatus.CLOSED)]
        if system:
            obls = [o for o in obls if o.target_system.value == system]
        return obls

    def summary(self) -> dict[str, Any]:
        return {
            "mails_ingested": len(self.mails), "objects_decomposed": len(self.objects),
            "obligations_compiled": len(self.obligations), "obligations_pending": len(self.pending_obligations()),
            "commitments_extracted": len(self.commitments), "intents_extracted": len(self.intents),
            "negative_actions": len(self.negative_actions), "verifications": len(self.receipts),
            "events_published": len(self.event_bus.events), "communication_graph": self.comm_graph.summary(),
        }
