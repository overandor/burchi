"""LLM-powered semantic extraction for pharmaceutical emails.

Replaces the regex-based SemanticDecomposer with actual language understanding
via an Ollama-hosted LLM (phi3:mini, llama3.2, etc.).

Pipeline:
  Email → LLM extraction (structured JSON) → DecomposedObjects + HCPIntent + Commitments
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import requests

from rxreserve.mailos import (
    MailObject, DecomposedObject, ObligationStatus,
    Commitment, HCPIntent, HCPIntentType,
    NegativeAction, NegativeActionType,
    ObjectType, ObjectPriority, SystemOfRecord,
)

logger = logging.getLogger(__name__)

# ─── Configuration ───

OLLAMA_URL = "https://prism-ollama.fly.dev"
OLLAMA_MODEL = "phi3:mini"
REQUEST_TIMEOUT = 120

# ─── Extraction prompt ───

SYSTEM_PROMPT = """You are a pharmaceutical communication analyzer working inside a regulated environment.
You analyze emails between pharmaceutical company employees and healthcare providers (HCPs).
You extract structured information and return ONLY valid JSON — no markdown, no explanation.

Categories map to obligation types:
- safety_signal: adverse events, product quality, side effects, patient harm
- medical_information: requests for clinical data, efficacy, mechanism, dosing, trials
- access_barrier: formulary, insurance, prior auth, coverage, cost, copay, affordability
- scheduling: meeting requests, lunch and learn, speaker programs
- content_request: requests for specific materials, brochures, publications
- compliance_review: off-label, regulatory, compliance concerns
- quality_complaint: product defects, packaging, wrong product
- general: anything else

Intent types (for HCP senders):
- adverse_experience: reporting a patient adverse event
- wants_evidence: requesting clinical data or evidence
- access_problem: reporting access/coverage barrier
- scheduling_signal: wants to meet
- skeptical: expressing doubt about efficacy/safety
- content_fatigue: too many emails, wants to unsubscribe
- high_engagement: very interested, wants more info
- disengaging: pulling away, not interested
- treatment_question: general clinical question

Priority:
- critical: safety signals, regulatory deadlines
- high: medical information, access barriers
- medium: content requests, scheduling
- low: general communication, relationship signals
"""

EXTRACTION_PROMPT_TEMPLATE = """Analyze this email and return JSON with exactly these fields:

{{
  "objects": [
    {{
      "category": "safety_signal|medical_information|access_barrier|scheduling|content_request|compliance_review|quality_complaint|general",
      "priority": "critical|high|medium|low",
      "summary": "one sentence describing what this is",
      "extracted_text": "the key phrase from the email that triggered this",
      "target_system": "safety|medical|market_access|crm|commercial|quality|compliance",
      "topic": "specific topic if applicable, empty string otherwise",
      "confidence": 0.0 to 1.0
    }}
  ],
  "intent": {{
    "intent_type": "adverse_experience|wants_evidence|access_problem|scheduling_signal|skeptical|content_fatigue|high_engagement|disengaging|treatment_question",
    "confidence": 0.0 to 1.0,
    "summary": "one sentence describing the sender's intent",
    "next_best_action": "what the recipient should do next",
    "relationship_impact": "positive|negative|neutral|critical",
    "negative_action": "do_not_send_campaign|route_to_safety|route_to_access|answer_existing_question_first|do_not_email|none"
  }},
  "commitments": [
    {{
      "promised_action": "what was promised",
      "deadline_text": "deadline mentioned in the email, empty if none"
    }}
  ]
}}

Analyze multiple aspects — an email can contain both a safety signal AND a medical information request.

Email subject: {subject}
Email body: {body}
Sender type: {sender_type}
"""


def _call_ollama(messages: list[dict], temperature: float = 0.0) -> Optional[str]:
    """Call the Ollama chat API and return the raw text response."""
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature},
            },
            headers={"Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["message"]["content"]
    except Exception as e:
        logger.error(f"Ollama call failed: {e}")
        return None


def _extract_json(text: str) -> Optional[dict]:
    """Extract JSON from LLM response (handles markdown code fences)."""
    # Strip markdown code fences
    text = text.strip()
    if text.startswith("```"):
        # Remove opening fence
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    logger.error(f"Failed to extract JSON from LLM response: {text[:200]}")
    return None


# ─── Category mapping ───

_CATEGORY_MAP = {
    "safety_signal": (ObjectType.POTENTIAL_SAFETY_SIGNAL, ObjectPriority.CRITICAL, SystemOfRecord.SAFETY),
    "medical_information": (ObjectType.MEDICAL_INFORMATION_REQUEST, ObjectPriority.HIGH, SystemOfRecord.MEDICAL),
    "access_barrier": (ObjectType.ACCESS_BARRIER, ObjectPriority.HIGH, SystemOfRecord.MARKET_ACCESS),
    "scheduling": (ObjectType.SCHEDULING_INTENT, ObjectPriority.MEDIUM, SystemOfRecord.CRM),
    "content_request": (ObjectType.CONTENT_REQUEST, ObjectPriority.MEDIUM, SystemOfRecord.COMMERCIAL),
    "compliance_review": (ObjectType.COMPLIANCE_REVIEW_REQUIRED, ObjectPriority.CRITICAL, SystemOfRecord.COMPLIANCE),
    "quality_complaint": (ObjectType.QUALITY_SIGNAL, ObjectPriority.HIGH, SystemOfRecord.QUALITY),
    "general": (ObjectType.COMMERCIAL_FOLLOWUP, ObjectPriority.LOW, SystemOfRecord.CRM),
}

_INTENT_MAP = {
    "adverse_experience": HCPIntentType.ADVERSE_EXPERIENCE,
    "wants_evidence": HCPIntentType.WANTS_EVIDENCE,
    "access_problem": HCPIntentType.ACCESS_PROBLEM,
    "scheduling_signal": HCPIntentType.SCHEDULING_SIGNAL,
    "skeptical": HCPIntentType.SKEPTICAL,
    "content_fatigue": HCPIntentType.CONTENT_FATIGUE,
    "high_engagement": HCPIntentType.HIGH_ENGAGEMENT,
    "disengaging": HCPIntentType.DISENGAGING,
    "treatment_question": HCPIntentType.TREATMENT_QUESTION,
}

_NEG_ACTION_MAP = {
    "do_not_send_campaign": NegativeActionType.DO_NOT_SEND_CAMPAIGN,
    "route_to_safety": NegativeActionType.ROUTE_TO_SAFETY,
    "route_to_access": NegativeActionType.ROUTE_TO_ACCESS,
    "answer_existing_question_first": NegativeActionType.ANSWER_EXISTING_QUESTION_FIRST,
    "do_not_email": NegativeActionType.DO_NOT_EMAIL,
    "none": None,
}


# ─── Main extractor ───

class LLMExtractor:
    """LLM-powered email extraction. Replaces regex SemanticDecomposer."""

    def __init__(self, ollama_url: str = OLLAMA_URL, model: str = OLLAMA_MODEL):
        self.ollama_url = ollama_url
        self.model = model

    def extract(self, mail: MailObject) -> dict[str, Any]:
        """Extract structured data from an email using the LLM.

        Returns a dict with keys: 'objects', 'intent', 'commitments',
        each converted to proper mailos dataclasses.
        """
        prompt = EXTRACTION_PROMPT_TEMPLATE.format(
            subject=mail.subject or "(no subject)",
            body=mail.body or "(no body)",
            sender_type=mail.from_type or "unknown",
        )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        raw = _call_ollama(messages, temperature=0.0)
        if not raw:
            logger.warning("LLM returned nothing, falling back to regex")
            return self._fallback_regex(mail)

        parsed = _extract_json(raw)
        if not parsed:
            logger.warning("LLM returned unparseable JSON, falling back to regex")
            return self._fallback_regex(mail)

        # Convert to mailos dataclasses
        objects = self._parse_objects(parsed.get("objects", []), mail)
        intent = self._parse_intent(parsed.get("intent"), mail)
        commitments = self._parse_commitments(parsed.get("commitments", []), mail)

        return {
            "objects": objects,
            "intent": intent,
            "commitments": commitments,
            "raw_llm_response": raw,
            "parsed": parsed,
        }

    def _parse_objects(self, raw_objects: list[dict], mail: MailObject) -> list[DecomposedObject]:
        objects = []
        for obj in raw_objects:
            cat = obj.get("category", "general").lower().strip()
            if cat not in _CATEGORY_MAP:
                cat = "general"
            obj_type, default_pri, target_sys = _CATEGORY_MAP[cat]

            pri_str = obj.get("priority", "").lower().strip()
            pri_map = {
                "critical": ObjectPriority.CRITICAL,
                "high": ObjectPriority.HIGH,
                "medium": ObjectPriority.MEDIUM,
                "low": ObjectPriority.LOW,
            }
            priority = pri_map.get(pri_str, default_pri)

            sys_str = obj.get("target_system", "").lower().strip()
            sys_map = {s.value: s for s in SystemOfRecord}
            target = sys_map.get(sys_str, target_sys)

            confidence = obj.get("confidence", 0.8)
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                confidence = 0.8

            objects.append(DecomposedObject(
                mail_id=mail.mail_id,
                object_type=obj_type,
                priority=priority,
                summary=obj.get("summary", cat),
                detail=obj.get("topic", ""),
                extracted_text=obj.get("extracted_text", ""),
                target_system=target,
                routing_confidence=confidence,
                topic=obj.get("topic", ""),
                hcp_id=mail.matched_hcp_id,
                employee_id=mail.matched_employee_id,
            ))

        # Always add relationship signal if HCP
        if mail.matched_hcp_id and not any(
            o.object_type == ObjectType.HCP_RELATIONSHIP_SIGNAL for o in objects
        ):
            objects.append(DecomposedObject(
                mail_id=mail.mail_id,
                object_type=ObjectType.HCP_RELATIONSHIP_SIGNAL,
                priority=ObjectPriority.LOW,
                summary="HCP communication — relationship signal",
                target_system=SystemOfRecord.CRM,
                routing_confidence=0.60,
                hcp_id=mail.matched_hcp_id,
                employee_id=mail.matched_employee_id,
            ))

        if not objects:
            objects.append(DecomposedObject(
                mail_id=mail.mail_id,
                object_type=ObjectType.COMMERCIAL_FOLLOWUP,
                priority=ObjectPriority.LOW,
                summary="General communication — requires review",
                target_system=SystemOfRecord.CRM,
                routing_confidence=0.40,
                hcp_id=mail.matched_hcp_id,
                employee_id=mail.matched_employee_id,
            ))

        return objects

    def _parse_intent(self, raw_intent: Optional[dict], mail: MailObject) -> Optional[HCPIntent]:
        if not raw_intent or mail.from_type != "hcp":
            return None

        intent_str = raw_intent.get("intent_type", "").lower().strip()
        intent_type = _INTENT_MAP.get(intent_str, HCPIntentType.TREATMENT_QUESTION)

        confidence = raw_intent.get("confidence", 0.7)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.7

        neg_str = raw_intent.get("negative_action", "none").lower().strip()
        neg_action = _NEG_ACTION_MAP.get(neg_str)

        intent = HCPIntent(
            mail_id=mail.mail_id,
            hcp_id=mail.matched_hcp_id,
            intent_type=intent_type,
            confidence=confidence,
            summary=raw_intent.get("summary", ""),
            extracted_text=raw_intent.get("summary", ""),
            relationship_impact=raw_intent.get("relationship_impact", "neutral"),
            next_best_action=raw_intent.get("next_best_action", ""),
            negative_action=neg_str if neg_str != "none" else None,
        )
        return intent

    def _parse_commitments(self, raw_comms: list[dict], mail: MailObject) -> list[Commitment]:
        commitments = []
        for c in raw_comms:
            promisor_type = "hcp" if mail.from_type == "hcp" else "employee"
            commitments.append(Commitment(
                mail_id=mail.mail_id,
                promisor=mail.from_name or mail.from_address,
                promisor_type=promisor_type,
                recipient="recipient",
                recipient_type="hcp" if promisor_type == "employee" else "employee",
                requested_action=c.get("promised_action", ""),
                deadline=c.get("deadline_text", ""),
                system_owner=SystemOfRecord.CRM,
                hcp_id=mail.matched_hcp_id,
                employee_id=mail.matched_employee_id if promisor_type == "employee" else "",
            ))
        return commitments

    def _fallback_regex(self, mail: MailObject) -> dict[str, Any]:
        """Fall back to regex extraction if LLM fails."""
        from rxreserve.mailos_engine import SemanticDecomposer, HCPIntentExtractor, CommitmentExtractor
        objects = SemanticDecomposer.decompose(mail)
        intent = HCPIntentExtractor.extract(mail)
        commitments = CommitmentExtractor.extract(mail)
        return {
            "objects": objects,
            "intent": intent,
            "commitments": commitments,
            "raw_llm_response": None,
            "parsed": None,
        }
