"""Gilead Proprietary Systems — the 5 moat-building modules.

These are the systems from the $150M roadmap that no vendor sells:
  1. RepPersonalAgent — rep-owned, territory-aware, cross-channel portable agent
  2. MSLRouter — autonomous commercial→medical agent-to-agent bridge
  3. TerritoryAsCode — declarative, version-controlled, continuously analyzed territories
  4. DefragmentationEngine — autonomously crawls unstructured data → knowledge graph
  5. HCPTrustTrajectory — predictive per-HCP trust scoring from relationship signals

Design principles:
  - Build only what gives proprietary competitive advantage
  - Everything runs on Gilead's data, inside Gilead's firewall
  - Rep-owned model (not company-owned) for the personal agent
  - Compliance guardrails built into every routing decision
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. REP PERSONAL AGENT — rep-owned, territory-aware, cross-channel
# ═══════════════════════════════════════════════════════════════════════

class AgentChannel(Enum):
    EMAIL = "email"
    IN_PERSON = "in_person"
    VIRTUAL = "virtual"
    PHONE = "phone"
    SMS = "sms"
    APPROVED_EMAIL = "approved_email"


class AgentActionType(Enum):
    SCHEDULE = "schedule"
    SEND_CONTENT = "send_content"
    ROUTE_TO_MEDICAL = "route_to_medical"
    ROUTE_TO_SAFETY = "route_to_safety"
    ROUTE_TO_ACCESS = "route_to_access"
    LOG_ACTIVITY = "log_activity"
    FOLLOW_UP = "follow_up"
    WAIT = "wait"
    ESCALATE = "escalate"
    DO_NOT_CONTACT = "do_not_contact"


class AgentOwnership(Enum):
    """Who owns the agent — this is the key design decision."""
    REP_OWNED = "rep_owned"       # rep controls what agent does
    COMPANY_OWNED = "company_owned"
    SHARED = "shared"             # rep + company co-manage


@dataclass
class AgentAction:
    """A single action the rep agent recommends or takes."""
    action_id: str = field(default_factory=lambda: str(uuid4()))
    action_type: AgentActionType = AgentActionType.WAIT
    hcp_id: str = ""
    channel: AgentChannel = AgentChannel.EMAIL
    description: str = ""
    rationale: str = ""
    confidence: float = 0.0
    compliance_status: str = "pending"  # pending, approved, rejected
    requires_rep_approval: bool = True   # rep-owned model: agent recommends, rep approves
    approved_by_rep: bool = False
    approved_at: str = ""
    executed: bool = False
    executed_at: str = ""
    outcome: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class RepProfile:
    """The rep's profile — this is THEIR data, not the company's."""
    rep_id: str = ""
    name: str = ""
    role: str = "representative"  # representative, msl, access, medical_affairs
    territory_id: str = ""
    skills: list[str] = field(default_factory=list)
    preferences: dict[str, Any] = field(default_factory=dict)
    # Rep-owned consent: what the rep has authorized the agent to do autonomously
    autonomous_actions_allowed: list[AgentActionType] = field(default_factory=lambda: [
        AgentActionType.LOG_ACTIVITY,
        AgentActionType.FOLLOW_UP,
        AgentActionType.SCHEDULE,
    ])
    # What always requires rep approval
    actions_requiring_approval: list[AgentActionType] = field(default_factory=lambda: [
        AgentActionType.SEND_CONTENT,
        AgentActionType.ROUTE_TO_MEDICAL,
        AgentActionType.ROUTE_TO_SAFETY,
        AgentActionType.ROUTE_TO_ACCESS,
        AgentActionType.ESCALATE,
    ])


class RepPersonalAgent:
    """Rep-as-Platform: a portable AI agent that belongs to the rep, not the company.

    Key design decisions:
    1. REP-OWNED: The rep controls what the agent can do autonomously vs. what needs approval
    2. TERRITORY-AWARE: Knows the rep's HCPs, history, and territory dynamics
    3. CROSS-CHANNEL: Works across email, in-person, virtual, phone, SMS, Approved Email
    4. COMPLIANCE-FIRST: Every action is checked against compliance rules before execution
    5. PORTABLE: The agent travels with the rep, not tied to a specific CRM seat

    The agent does NOT:
    - Send promotional content without rep approval
    - Route to medical without rep approval
    - Make clinical judgments
    - Override rep decisions
    """

    def __init__(self, rep: RepProfile):
        self.rep = rep
        self.actions: list[AgentAction] = []
        self.hcp_history: dict[str, list[dict]] = {}  # hcp_id -> interaction history
        self.learned_preferences: dict[str, Any] = {}

    def ingest_signals(self, hcp_id: str, obligations: list[dict],
                       intents: list[dict], mails: list[dict]) -> list[AgentAction]:
        """Ingest signals from MailOS and generate recommended actions.

        This is the core loop: signals → agent reasoning → recommended actions.
        The rep then approves/rejects each action.
        """
        actions = []

        # Process obligations
        for obl in obligations:
            if obl.get("hcp_id") != hcp_id:
                continue
            action = self._obligation_to_action(obl, hcp_id)
            if action:
                actions.append(action)

        # Process intents
        for intent in intents:
            if intent.get("hcp_id") != hcp_id:
                continue
            action = self._intent_to_action(intent, hcp_id)
            if action:
                actions.append(action)

        # Check for HCPs that need follow-up (no contact in 30+ days)
        if hcp_id in self.hcp_history:
            last_contact = self.hcp_history[hcp_id][-1].get("timestamp", "")
            if last_contact:
                try:
                    last_dt = datetime.fromisoformat(last_contact.replace("Z", "+00:00"))
                    days_since = (datetime.now(timezone.utc) - last_dt).days
                    if days_since > 30:
                        actions.append(AgentAction(
                            action_type=AgentActionType.FOLLOW_UP,
                            hcp_id=hcp_id,
                            channel=AgentChannel.EMAIL,
                            description=f"Follow up with HCP — {days_since} days since last contact",
                            rationale=f"HCP hasn't been contacted in {days_since} days. Relationship decay risk.",
                            confidence=0.7,
                            requires_rep_approval=True,
                        ))
                except Exception:
                    pass

        # Check for negative actions (what NOT to do)
        for intent in intents:
            if intent.get("hcp_id") != hcp_id:
                continue
            neg = intent.get("negative_action", "")
            if neg and neg != "none":
                actions.append(AgentAction(
                    action_type=AgentActionType.DO_NOT_CONTACT,
                    hcp_id=hcp_id,
                    description=f"DO NOT {neg.replace('_', ' ')} — HCP intent: {intent.get('intent_type', '')}",
                    rationale=intent.get("summary", ""),
                    confidence=intent.get("confidence", 0.8),
                    requires_rep_approval=False,  # negative actions are always enforced
                ))

        self.actions.extend(actions)
        return actions

    def _obligation_to_action(self, obl: dict, hcp_id: str) -> Optional[AgentAction]:
        """Convert an obligation into a recommended agent action."""
        obl_type = obl.get("obligation_type", "")
        status = obl.get("status", "")

        if status in ("verified", "closed"):
            return None

        action_map = {
            "safety_report": (AgentActionType.ROUTE_TO_SAFETY, "Route to safety/pharmacovigilance immediately"),
            "medical_response": (AgentActionType.ROUTE_TO_MEDICAL, "Route to medical affairs for scientific response"),
            "access_resolution": (AgentActionType.ROUTE_TO_ACCESS, "Route to market access team"),
            "content_delivery": (AgentActionType.SEND_CONTENT, "Deliver requested content via Approved Email"),
            "crm_activity": (AgentActionType.LOG_ACTIVITY, "Log CRM activity and follow up"),
            "followup_commitment": (AgentActionType.FOLLOW_UP, "Follow up on commitment"),
        }

        if obl_type in action_map:
            act_type, desc = action_map[obl_type]
            requires_approval = act_type in self.rep.actions_requiring_approval
            return AgentAction(
                action_type=act_type,
                hcp_id=hcp_id,
                channel=AgentChannel.EMAIL if act_type != AgentActionType.SEND_CONTENT else AgentChannel.APPROVED_EMAIL,
                description=desc,
                rationale=f"Obligation: {obl.get('description', '')[:80]}",
                confidence=0.85,
                requires_rep_approval=requires_approval,
            )
        return None

    def _intent_to_action(self, intent: dict, hcp_id: str) -> Optional[AgentAction]:
        """Convert an HCP intent into a recommended agent action."""
        intent_type = intent.get("intent_type", "")

        intent_map = {
            "adverse_experience": (AgentActionType.ROUTE_TO_SAFETY, "HCP reported AE — route to safety, do not promote"),
            "wants_evidence": (AgentActionType.ROUTE_TO_MEDICAL, "HCP wants evidence — route to medical affairs"),
            "access_problem": (AgentActionType.ROUTE_TO_ACCESS, "HCP has access problem — route to market access"),
            "scheduling_signal": (AgentActionType.SCHEDULE, "HCP wants to meet — propose meeting via CRM"),
            "high_engagement": (AgentActionType.SCHEDULE, "HCP highly engaged — schedule deeper engagement"),
            "content_fatigue": (AgentActionType.DO_NOT_CONTACT, "HCP fatigued — pause promotional sends"),
            "disengaging": (AgentActionType.DO_NOT_CONTACT, "HCP disengaging — pause contact"),
            "skeptical": (AgentActionType.ROUTE_TO_MEDICAL, "HCP skeptical — route scientific question to medical"),
        }

        if intent_type in intent_map:
            act_type, desc = intent_map[intent_type]
            requires_approval = act_type in self.rep.actions_requiring_approval
            if act_type == AgentActionType.DO_NOT_CONTACT:
                requires_approval = False  # always enforce
            return AgentAction(
                action_type=act_type,
                hcp_id=hcp_id,
                description=desc,
                rationale=f"Intent: {intent.get('summary', '')[:80]}",
                confidence=intent.get("confidence", 0.7),
                requires_rep_approval=requires_approval,
            )
        return None

    def approve_action(self, action_id: str) -> Optional[AgentAction]:
        """Rep approves an action — this is the rep-owned control mechanism."""
        for a in self.actions:
            if a.action_id == action_id:
                a.approved_by_rep = True
                a.approved_at = datetime.now(timezone.utc).isoformat()
                a.compliance_status = "approved"
                return a
        return None

    def reject_action(self, action_id: str, reason: str = "") -> Optional[AgentAction]:
        """Rep rejects an action."""
        for a in self.actions:
            if a.action_id == action_id:
                a.compliance_status = "rejected"
                a.outcome = f"Rejected by rep: {reason}"
                return a
        return None

    def execute_action(self, action_id: str, outcome: str = "") -> Optional[AgentAction]:
        """Execute an approved action."""
        for a in self.actions:
            if a.action_id == action_id:
                if a.requires_rep_approval and not a.approved_by_rep:
                    return None
                a.executed = True
                a.executed_at = datetime.now(timezone.utc).isoformat()
                a.outcome = outcome
                return a
        return None

    def autonomous_actions(self) -> list[AgentAction]:
        """Actions the agent can take without rep approval (per rep's consent)."""
        return [a for a in self.actions
                if not a.requires_rep_approval
                and a.action_type in self.rep.autonomous_actions_allowed]

    def pending_approval(self) -> list[AgentAction]:
        """Actions waiting for rep approval."""
        return [a for a in self.actions
                if a.requires_rep_approval and not a.approved_by_rep
                and a.compliance_status == "pending"]

    def summary(self) -> dict[str, Any]:
        return {
            "rep_id": self.rep.rep_id,
            "rep_name": self.rep.name,
            "territory_id": self.rep.territory_id,
            "ownership": AgentOwnership.REP_OWNED.value,
            "total_actions": len(self.actions),
            "pending_approval": len(self.pending_approval()),
            "autonomous": len(self.autonomous_actions()),
            "executed": sum(1 for a in self.actions if a.executed),
            "rejected": sum(1 for a in self.actions if a.compliance_status == "rejected"),
            "hcps_tracked": len(self.hcp_history),
        }


# ═══════════════════════════════════════════════════════════════════════
# 2. MSL ROUTER — autonomous commercial→medical agent-to-agent bridge
# ═══════════════════════════════════════════════════════════════════════

class MSLRouteStatus(Enum):
    DETECTED = "detected"         # commercial agent detected medical need
    ROUTED = "routed"             # routed to MSL agent
    ACCEPTED = "accepted"         # MSL agent accepted the route
    RESPONDED = "responded"       # MSL agent prepared scientific response
    DELIVERED = "delivered"       # response delivered back through rep
    CLOSED = "closed"
    REJECTED = "rejected"         # MSL agent rejected (not a medical question)


@dataclass
class MSLRoute:
    """A single commercial→medical routing event.

    The key compliance property: the MSL response goes back THROUGH the rep,
    not directly to the HCP. This maintains the commercial/medical separation.
    """
    route_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    rep_id: str = ""
    msl_id: str = ""  # assigned MSL
    trigger_obligation_id: str = ""
    trigger_intent_id: str = ""

    # What was detected
    medical_question: str = ""
    detected_from: str = ""  # email, intent, obligation
    detected_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    confidence: float = 0.0

    # Routing
    status: MSLRouteStatus = MSLRouteStatus.DETECTED
    routed_at: str = ""
    accepted_at: str = ""

    # MSL response
    scientific_response: str = ""
    response_references: list[str] = field(default_factory=list)
    is_promotional: bool = False  # MUST be False — compliance check
    compliance_verified: bool = False
    responded_at: str = ""

    # Delivery
    delivered_through_rep: bool = True  # always True — response goes through rep
    delivered_at: str = ""
    hcp_feedback: str = ""

    # Audit trail
    status_history: list[dict] = field(default_factory=list)


class MSLRouter:
    """Autonomous MSL routing — the commercial→medical agent-to-agent bridge.

    When a commercial rep's agent detects a scientific/medical question from an HCP,
    this system automatically routes it to the appropriate MSL. The MSL agent
    prepares a scientific response, which goes back THROUGH the rep (not directly
    to the HCP) to maintain the commercial/medical separation.

    Compliance guardrails:
    1. MSL response is ALWAYS scientific, never promotional
    2. Response goes through the rep, never directly to HCP
    3. Every route is audited
    4. MSL can reject if the question is actually promotional, not medical
    """

    # Intent types that trigger medical routing
    MEDICAL_INTENT_TRIGGERS = {
        "wants_evidence", "skeptical", "treatment_question",
    }

    # Obligation types that trigger medical routing
    MEDICAL_OBLIGATION_TRIGGERS = {
        "medical_response",
    }

    # Keywords that indicate a medical/scientific question
    MEDICAL_KEYWORDS = [
        "efficacy", "safety profile", "mechanism", "dosing", "contraindication",
        "drug interaction", "clinical trial", "phase 3", "real-world evidence",
        "comparative", "renal", "hepatic", "pregnancy", "pediatric",
        "evidence", "data", "study", "results", "outcomes",
    ]

    def __init__(self):
        self.routes: dict[str, MSLRoute] = {}
        self.msl_assignments: dict[str, str] = {}  # hcp_id -> preferred MSL
        self.evidence_store: dict[str, list[dict]] = {}  # drug_name -> evidence entries

    def detect_medical_need(self, hcp_id: str, rep_id: str,
                            obligations: list[dict] = None,
                            intents: list[dict] = None,
                            mails: list[dict] = None) -> list[MSLRoute]:
        """Detect medical questions that need MSL routing.

        Called by the rep agent when it ingests signals.
        """
        obligations = obligations or []
        intents = intents or []
        mails = mails or []
        new_routes = []

        # Check intents
        for intent in intents:
            if intent.get("hcp_id") != hcp_id:
                continue
            if intent.get("intent_type") in self.MEDICAL_INTENT_TRIGGERS:
                route = MSLRoute(
                    hcp_id=hcp_id, rep_id=rep_id,
                    trigger_intent_id=intent.get("intent_id", ""),
                    medical_question=intent.get("summary", ""),
                    detected_from="intent",
                    confidence=intent.get("confidence", 0.7),
                )
                route.status_history.append({
                    "status": MSLRouteStatus.DETECTED.value,
                    "timestamp": route.detected_at,
                    "actor": "rep_agent",
                })
                self.routes[route.route_id] = route
                new_routes.append(route)

        # Check obligations
        for obl in obligations:
            if obl.get("hcp_id") != hcp_id:
                continue
            if obl.get("obligation_type") in self.MEDICAL_OBLIGATION_TRIGGERS:
                # Don't create duplicate if we already routed from intent
                if any(r.trigger_obligation_id == obl.get("obligation_id", "")
                       for r in new_routes):
                    continue
                route = MSLRoute(
                    hcp_id=hcp_id, rep_id=rep_id,
                    trigger_obligation_id=obl.get("obligation_id", ""),
                    medical_question=obl.get("description", ""),
                    detected_from="obligation",
                    confidence=0.85,
                )
                route.status_history.append({
                    "status": MSLRouteStatus.DETECTED.value,
                    "timestamp": route.detected_at,
                    "actor": "rep_agent",
                })
                self.routes[route.route_id] = route
                new_routes.append(route)

        # Check email content for medical keywords
        for mail in mails:
            if mail.get("matched_hcp_id") != hcp_id:
                continue
            body = (mail.get("body", "") + " " + mail.get("subject", "")).lower()
            keyword_hits = [kw for kw in self.MEDICAL_KEYWORDS if kw in body]
            if len(keyword_hits) >= 2:  # need multiple hits to avoid false positives
                # Check we haven't already routed this mail
                mail_id = mail.get("mail_id", "")
                if any(r.detected_from == f"email:{mail_id}" for r in new_routes):
                    continue
                route = MSLRoute(
                    hcp_id=hcp_id, rep_id=rep_id,
                    medical_question=f"Medical keywords detected: {', '.join(keyword_hits[:5])}",
                    detected_from=f"email:{mail_id}",
                    confidence=min(0.5 + 0.1 * len(keyword_hits), 0.9),
                )
                route.status_history.append({
                    "status": MSLRouteStatus.DETECTED.value,
                    "timestamp": route.detected_at,
                    "actor": "rep_agent",
                })
                self.routes[route.route_id] = route
                new_routes.append(route)

        return new_routes

    def route_to_msl(self, route_id: str, msl_id: str = "") -> MSLRoute:
        """Route a detected medical need to an MSL."""
        route = self.routes.get(route_id)
        if not route:
            raise KeyError(f"Route {route_id} not found")

        # Assign MSL (use preferred if available, else specified, else auto)
        if not msl_id:
            msl_id = self.msl_assignments.get(route.hcp_id, "MSL_DEFAULT")

        route.msl_id = msl_id
        route.status = MSLRouteStatus.ROUTED
        route.routed_at = datetime.now(timezone.utc).isoformat()
        route.status_history.append({
            "status": MSLRouteStatus.ROUTED.value,
            "timestamp": route.routed_at,
            "actor": "rep_agent",
            "msl_id": msl_id,
        })
        return route

    def msl_accept(self, route_id: str, msl_id: str) -> MSLRoute:
        """MSL agent accepts the route."""
        route = self.routes.get(route_id)
        if not route:
            raise KeyError(f"Route {route_id} not found")
        route.status = MSLRouteStatus.ACCEPTED
        route.accepted_at = datetime.now(timezone.utc).isoformat()
        route.status_history.append({
            "status": MSLRouteStatus.ACCEPTED.value,
            "timestamp": route.accepted_at,
            "actor": msl_id,
        })
        return route

    def msl_respond(self, route_id: str, msl_id: str, response: str,
                    references: list[str] = None) -> MSLRoute:
        """MSL agent prepares a scientific response.

        CRITICAL COMPLIANCE CHECK: The response must not be promotional.
        """
        route = self.routes.get(route_id)
        if not route:
            raise KeyError(f"Route {route_id} not found")

        # Compliance check — scan for promotional language
        promotional_terms = ["best", "superior", "leading", "#1", "market leader",
                            "breakthrough", "revolutionary", "game-changer"]
        response_lower = response.lower()
        is_promotional = any(term in response_lower for term in promotional_terms)

        route.scientific_response = response
        route.response_references = references or []
        route.is_promotional = is_promotional
        route.compliance_verified = not is_promotional
        route.status = MSLRouteStatus.RESPONDED
        route.responded_at = datetime.now(timezone.utc).isoformat()
        route.status_history.append({
            "status": MSLRouteStatus.RESPONDED.value,
            "timestamp": route.responded_at,
            "actor": msl_id,
            "compliance_verified": route.compliance_verified,
            "is_promotional": route.is_promotional,
        })
        return route

    def deliver_through_rep(self, route_id: str) -> MSLRoute:
        """Deliver the MSL response back through the rep (not directly to HCP).

        This is the compliance-critical step: the response goes to the rep,
        who then sends it to the HCP via an approved channel.
        """
        route = self.routes.get(route_id)
        if not route:
            raise KeyError(f"Route {route_id} not found")
        if not route.compliance_verified:
            raise ValueError("Cannot deliver — response failed compliance check (promotional content detected)")
        route.status = MSLRouteStatus.DELIVERED
        route.delivered_through_rep = True
        route.delivered_at = datetime.now(timezone.utc).isoformat()
        route.status_history.append({
            "status": MSLRouteStatus.DELIVERED.value,
            "timestamp": route.delivered_at,
            "actor": "system",
            "delivered_through_rep": True,
        })
        return route

    def msl_reject(self, route_id: str, msl_id: str, reason: str) -> MSLRoute:
        """MSL rejects the route — e.g., the question is promotional, not medical."""
        route = self.routes.get(route_id)
        if not route:
            raise KeyError(f"Route {route_id} not found")
        route.status = MSLRouteStatus.REJECTED
        route.status_history.append({
            "status": MSLRouteStatus.REJECTED.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actor": msl_id,
            "reason": reason,
        })
        return route

    def pending_routes(self) -> list[MSLRoute]:
        return [r for r in self.routes.values() if r.status in (MSLRouteStatus.DETECTED, MSLRouteStatus.ROUTED)]

    def summary(self) -> dict[str, Any]:
        return {
            "total_routes": len(self.routes),
            "pending": len(self.pending_routes()),
            "responded": sum(1 for r in self.routes.values() if r.status == MSLRouteStatus.RESPONDED),
            "delivered": sum(1 for r in self.routes.values() if r.status == MSLRouteStatus.DELIVERED),
            "rejected": sum(1 for r in self.routes.values() if r.status == MSLRouteStatus.REJECTED),
            "compliance_violations": sum(1 for r in self.routes.values() if r.is_promotional),
        }


# ═══════════════════════════════════════════════════════════════════════
# 3. TERRITORY-AS-CODE — declarative, version-controlled, analyzed
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class TerritoryDefinition:
    """A territory defined as code — declarative, version-controlled.

    Example YAML:
        territory_id: bay_area_north
        rep_id: E184
        version: 3
        hcps:
          - hcp_id: H001
            priority: high
            target_visits: 2
          - hcp_id: H002
            priority: medium
            target_visits: 1
        constraints:
          max_visits_per_day: 8
          min_days_between_visits: 14
          excluded_hcps: [H999]
    """
    territory_id: str = ""
    rep_id: str = ""
    version: int = 1
    parent_version: int = 0  # for version tracking
    hcp_assignments: list[dict] = field(default_factory=list)  # [{hcp_id, priority, target_visits}]
    constraints: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: str = ""
    commit_message: str = ""
    is_active: bool = True


@dataclass
class TerritoryAnalysis:
    """Result of analyzing a territory definition against real HCP data."""
    analysis_id: str = field(default_factory=lambda: str(uuid4()))
    territory_id: str = ""
    version: int = 0
    # Computed metrics from real data
    total_hcps: int = 0
    total_target_visits: int = 0
    estimated_visits_per_day: float = 0.0
    days_to_cover_all: float = 0.0
    high_priority_coverage: float = 0.0  # % of high-priority HCPs that get visited
    overload_risk: float = 0.0  # probability rep can't meet targets
    # Impact vs current
    hcp_changes: list[dict] = field(default_factory=list)  # [{hcp_id, action: "added"|"removed"|"priority_changed"}]
    estimated_impact: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # Real data metrics
    total_addressable_value: float = 0.0
    avg_engagement_score: float = 0.0
    hcps_by_journey_state: dict[str, int] = field(default_factory=dict)
    recent_interaction_count: int = 0
    analyzed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    data_source: str = ""


class TerritoryAsCode:
    """Territory-as-Code: declarative, version-controlled, continuously analyzed.

    Territories are defined as code (YAML/JSON), version-controlled (git-like),
    and analyzed before deployment. You can test "what if I move Dr. Martinez
    from Rep A to Rep B?" before committing the change.

    Features:
    1. DECLARE: Define territories as code
    2. VERSION: Every change is a new version with a commit message
    3. ANALYZE: Test the impact of changes before deploying
    4. DIFF: See what changed between versions
    5. DEPLOY: Activate a version (only one active per territory)
    """

    def __init__(self, database=None):
        self.territories: dict[str, list[TerritoryDefinition]] = {}  # territory_id -> versions
        self.analyses: list[TerritoryAnalysis] = []
        self.database = database

    def define_territory(self, territory_id: str, rep_id: str,
                         hcp_assignments: list[dict],
                         constraints: dict = None,
                         commit_message: str = "") -> TerritoryDefinition:
        """Define a new territory version."""
        versions = self.territories.setdefault(territory_id, [])
        parent_v = versions[-1].version if versions else 0

        # Deactivate previous version
        for v in versions:
            v.is_active = False

        terr = TerritoryDefinition(
            territory_id=territory_id,
            rep_id=rep_id,
            version=parent_v + 1,
            parent_version=parent_v,
            hcp_assignments=hcp_assignments,
            constraints=constraints or {
                "max_visits_per_day": 8,
                "min_days_between_visits": 14,
            },
            commit_message=commit_message or f"v{parent_v + 1}",
        )
        versions.append(terr)
        return terr

    def get_active(self, territory_id: str) -> Optional[TerritoryDefinition]:
        versions = self.territories.get(territory_id, [])
        for v in reversed(versions):
            if v.is_active:
                return v
        return None

    def get_version(self, territory_id: str, version: int) -> Optional[TerritoryDefinition]:
        for v in self.territories.get(territory_id, []):
            if v.version == version:
                return v
        return None

    def diff(self, territory_id: str, v1: int, v2: int) -> dict:
        """Diff two versions of a territory."""
        t1 = self.get_version(territory_id, v1)
        t2 = self.get_version(territory_id, v2)
        if not t1 or not t2:
            return {"error": "Version not found"}

        hcp_ids_1 = {h["hcp_id"]: h for h in t1.hcp_assignments}
        hcp_ids_2 = {h["hcp_id"]: h for h in t2.hcp_assignments}

        added = [h for h in t2.hcp_assignments if h["hcp_id"] not in hcp_ids_1]
        removed = [h for h in t1.hcp_assignments if h["hcp_id"] not in hcp_ids_2]
        changed = []
        for hcp_id in hcp_ids_1:
            if hcp_id in hcp_ids_2:
                h1, h2 = hcp_ids_1[hcp_id], hcp_ids_2[hcp_id]
                if h1.get("priority") != h2.get("priority") or h1.get("target_visits") != h2.get("target_visits"):
                    changed.append({"hcp_id": hcp_id, "from": h1, "to": h2})

        return {
            "territory_id": territory_id,
            "v1": v1, "v2": v2,
            "added": added, "removed": removed, "changed": changed,
            "rep_changed": t1.rep_id != t2.rep_id,
        }

    def analyze(self, territory_id: str, version: int,
                hcp_data: dict[str, dict] = None) -> TerritoryAnalysis:
        """Analyze a territory version against real HCP data.

        hcp_data: optional dict of hcp_id -> {name, specialty, ...} for manual override.
        If database is connected, pulls real HCP data automatically.
        """
        terr = self.get_version(territory_id, version)
        if not terr:
            raise KeyError(f"Territory {territory_id} v{version} not found")

        total_hcps = len(terr.hcp_assignments)
        total_visits = sum(h.get("target_visits", 1) for h in terr.hcp_assignments)
        max_per_day = terr.constraints.get("max_visits_per_day", 8)

        visits_per_day = total_visits / 20  # 20 working days/month
        days_to_cover = total_visits / max_per_day if max_per_day > 0 else float('inf')

        high_priority = [h for h in terr.hcp_assignments if h.get("priority") == "high"]
        high_priority_visits = sum(h.get("target_visits", 1) for h in high_priority)
        high_coverage = min(high_priority_visits / max(len(high_priority) * 2, 1), 1.0) if high_priority else 1.0

        # Overload risk
        overload = max(0, (visits_per_day / max_per_day - 0.8) / 0.2) if max_per_day > 0 else 1.0
        overload = min(overload, 1.0)

        # Compare with current active version
        active = self.get_active(territory_id)
        changes = []
        if active and active.version != version:
            d = self.diff(territory_id, active.version, version)
            for h in d.get("added", []):
                changes.append({"hcp_id": h["hcp_id"], "action": "added"})
            for h in d.get("removed", []):
                changes.append({"hcp_id": h["hcp_id"], "action": "removed"})
            for h in d.get("changed", []):
                changes.append({"hcp_id": h["hcp_id"], "action": "priority_changed"})

        # Pull real HCP data from database
        total_addressable_value = 0.0
        engagement_scores = []
        journey_states: dict[str, int] = {}
        recent_interaction_count = 0
        data_source = "manual"

        if self.database:
            data_source = "database"
            for assignment in terr.hcp_assignments:
                hcp_id = assignment.get("hcp_id", "")
                hcp = self.database.get_hcp(hcp_id)
                if hcp:
                    total_addressable_value += hcp.addressable_value
                    engagement_scores.append(hcp.engagement_score)
                    state = hcp.journey_state.value
                    journey_states[state] = journey_states.get(state, 0) + 1
                    interactions = self.database.get_interactions_for_hcp(hcp_id)
                    recent_interaction_count += len(interactions)
        elif hcp_data:
            for assignment in terr.hcp_assignments:
                hcp_id = assignment.get("hcp_id", "")
                info = hcp_data.get(hcp_id, {})
                total_addressable_value += info.get("addressable_value", 0)
                engagement_scores.append(info.get("engagement_score", 0))
                state = info.get("journey_state", "unknown")
                journey_states[state] = journey_states.get(state, 0) + 1
                recent_interaction_count += info.get("interaction_count", 0)

        avg_engagement = sum(engagement_scores) / max(len(engagement_scores), 1) if engagement_scores else 0.0

        warnings = []
        if overload > 0.7:
            warnings.append(f"High overload risk ({overload:.0%}) — rep may not meet visit targets")
        if high_coverage < 0.8:
            warnings.append(f"Low high-priority coverage ({high_coverage:.0%}) — some key HCPs may not be visited enough")
        if total_hcps > 50:
            warnings.append(f"Large territory ({total_hcps} HCPs) — consider splitting")
        if recent_interaction_count == 0 and total_hcps > 0:
            warnings.append("No interaction history found — territory has no engagement data yet")

        analysis = TerritoryAnalysis(
            territory_id=territory_id, version=version,
            total_hcps=total_hcps, total_target_visits=total_visits,
            estimated_visits_per_day=round(visits_per_day, 1),
            days_to_cover_all=round(days_to_cover, 1),
            high_priority_coverage=round(high_coverage, 2),
            overload_risk=round(overload, 2),
            hcp_changes=changes,
            estimated_impact={
                "visits_per_day": round(visits_per_day, 1),
                "coverage_days": round(days_to_cover, 1),
                "hcp_count": total_hcps,
                "total_addressable_value": round(total_addressable_value, 2),
                "recent_interactions": recent_interaction_count,
            },
            warnings=warnings,
            total_addressable_value=round(total_addressable_value, 2),
            avg_engagement_score=round(avg_engagement, 3),
            hcps_by_journey_state=journey_states,
            recent_interaction_count=recent_interaction_count,
            data_source=data_source,
        )
        self.analyses.append(analysis)
        return analysis

    def deploy(self, territory_id: str, version: int) -> TerritoryDefinition:
        """Deploy a specific version — deactivates all others."""
        terr = self.get_version(territory_id, version)
        if not terr:
            raise KeyError(f"Version {version} not found")
        for v in self.territories.get(territory_id, []):
            v.is_active = (v.version == version)
        return terr

    def history(self, territory_id: str) -> list[dict]:
        versions = self.territories.get(territory_id, [])
        return [{"version": v.version, "rep_id": v.rep_id, "commit": v.commit_message,
                 "active": v.is_active, "hcps": len(v.hcp_assignments),
                 "created_at": v.created_at} for v in versions]


# ═══════════════════════════════════════════════════════════════════════
# 4. AGENTIC DEFRAGMENTATION ENGINE — unstructured data → knowledge graph
# ═══════════════════════════════════════════════════════════════════════

class FragmentType(Enum):
    SPREADSHEET = "spreadsheet"
    EMAIL = "email"
    DOCUMENT = "document"
    CRM_NOTE = "crm_note"
    SLACK_MESSAGE = "slack_message"
    MEETING_NOTES = "meeting_notes"
    PDF = "pdf"
    UNKNOWN = "unknown"


@dataclass
class DataFragment:
    """A single unstructured data fragment found in the enterprise."""
    fragment_id: str = field(default_factory=lambda: str(uuid4()))
    source_type: FragmentType = FragmentType.UNKNOWN
    source_location: str = ""  # file path, email ID, channel, etc.
    raw_content: str = ""
    extracted_entities: list[str] = field(default_factory=list)  # HCP names, drug names, etc.
    extracted_facts: list[dict] = field(default_factory=list)  # [{subject, predicate, object, confidence}]
    hcp_references: list[str] = field(default_factory=list)  # HCP IDs or names found
    drug_references: list[str] = field(default_factory=list)
    processed: bool = False
    processed_at: str = ""
    confidence: float = 0.0


@dataclass
class KnowledgeNode:
    """A node in the consolidated knowledge graph."""
    node_id: str = field(default_factory=lambda: str(uuid4()))
    node_type: str = ""  # hcp, drug, fact, obligation, interaction
    label: str = ""
    properties: dict[str, Any] = field(default_factory=dict)
    source_fragments: list[str] = field(default_factory=list)  # fragment_ids that mention this


@dataclass
class KnowledgeEdge:
    """An edge in the knowledge graph."""
    edge_id: str = field(default_factory=lambda: str(uuid4()))
    source_id: str = ""
    target_id: str = ""
    relation: str = ""  # "prescribes", "asked_about", "has_access_issue", etc.
    weight: float = 1.0
    source_fragments: list[str] = field(default_factory=list)


class DefragmentationEngine:
    """Agentic Defragmentation Engine — autonomously crawls unstructured data
    and consolidates it into a structured knowledge graph.

    This is the "data swallowing" layer that makes everything else work.
    It crawls spreadsheets, emails, CRM notes, Slack messages, meeting notes,
    and PDFs — extracting entities, facts, and relationships.

    The output is a unified knowledge graph that the rep agent, MSL router,
    and trust trajectory model can all query.
    """

    # Drug names to look for
    DRUG_NAMES = ["biktarvy", "descovy", "truvada", "atripla", "complera",
                  "odefsey", "genvoya", "stribild", "vitekta", "tybost"]

    # HCP name patterns
    HCP_PATTERNS = [
        r"Dr\.\s+([A-Z][a-z]+\s+[A-Z][a-z]+)",
        r"Dr\s+([A-Z][a-z]+\s+[A-Z][a-z]+)",
        r"([A-Z][a-z]+\s+[A-Z][a-z]+),\s+MD",
    ]

    # Fact extraction patterns
    FACT_PATTERNS = [
        (r"(\w+)\s+(?:is|was)\s+(?:prescribed|taking|on)\s+(\w+)", "prescribed"),
        (r"(\w+)\s+(?:asked|requested|wants)\s+(?:about|information on)\s+(\w+)", "asked_about"),
        (r"(\w+)\s+(?:has|reported|experienced)\s+(?:an?\s+)?(\w+\s+\w+)", "reported"),
        (r"(\w+)\s+(?:denied|rejected|blocked)\s+(\w+)", "denied"),
        (r"(\w+)\s+(?:met with|saw|visited)\s+(\w+)", "met_with"),
        (r"(\w+)\s+(?:interested in|engaged with|wants)\s+(\w+)", "interested_in"),
    ]

    def __init__(self):
        self.fragments: dict[str, DataFragment] = {}
        self.nodes: dict[str, KnowledgeNode] = {}
        self.edges: dict[str, KnowledgeEdge] = {}
        self._entity_index: dict[str, str] = {}  # entity name -> node_id

    def ingest_fragment(self, source_type: FragmentType, source_location: str,
                        content: str) -> DataFragment:
        """Ingest a raw unstructured data fragment."""
        frag = DataFragment(
            source_type=source_type,
            source_location=source_location,
            raw_content=content[:10000],  # cap at 10K chars
        )
        self.fragments[frag.fragment_id] = frag
        return frag

    def process_fragment(self, fragment_id: str) -> DataFragment:
        """Process a fragment — extract entities, facts, and build graph."""
        frag = self.fragments.get(fragment_id)
        if not frag:
            raise KeyError(f"Fragment {fragment_id} not found")

        content = frag.raw_content
        content_lower = content.lower()

        # Extract HCP names
        hcp_refs = []
        for pattern in self.HCP_PATTERNS:
            for match in re.finditer(pattern, content):
                name = match.group(1)
                hcp_refs.append(name)
                # Create or update HCP node
                self._add_or_update_node(name, "hcp", name, {"source": frag.source_type.value})
        frag.hcp_references = list(set(hcp_refs))

        # Extract drug references
        drug_refs = [d for d in self.DRUG_NAMES if d in content_lower]
        for drug in drug_refs:
            self._add_or_update_node(drug.capitalize(), "drug", drug.capitalize(),
                                   {"source": frag.source_type.value})
        frag.drug_references = drug_refs

        # Extract facts
        facts = []
        for pattern, relation in self.FACT_PATTERNS:
            for match in re.finditer(pattern, content, re.IGNORECASE):
                subject, obj = match.group(1), match.group(2)
                fact = {"subject": subject, "predicate": relation, "object": obj,
                       "confidence": 0.7, "source": frag.source_type.value}
                facts.append(fact)

                # Add edge to knowledge graph
                subj_node = self._add_or_update_node(subject, "entity", subject)
                obj_node = self._add_or_update_node(obj, "entity", obj)
                self._add_edge(subj_node.node_id, obj_node.node_id, relation, [fragment_id])

        frag.extracted_facts = facts
        frag.extracted_entities = list(set(hcp_refs + [d.capitalize() for d in drug_refs]))
        frag.processed = True
        frag.processed_at = datetime.now(timezone.utc).isoformat()
        frag.confidence = min(0.5 + 0.1 * len(facts) + 0.05 * len(hcp_refs), 0.95)

        return frag

    def process_all(self) -> dict:
        """Process all unprocessed fragments."""
        processed = 0
        for fid in list(self.fragments.keys()):
            frag = self.fragments[fid]
            if not frag.processed:
                self.process_fragment(fid)
                processed += 1
        return {
            "total_fragments": len(self.fragments),
            "processed_now": processed,
            "total_processed": sum(1 for f in self.fragments.values() if f.processed),
            "knowledge_nodes": len(self.nodes),
            "knowledge_edges": len(self.edges),
        }

    def _add_or_update_node(self, label: str, node_type: str, display_label: str = "",
                           extra_props: dict = None) -> KnowledgeNode:
        key = f"{node_type}:{label.lower()}"
        if key in self._entity_index:
            node_id = self._entity_index[key]
            node = self.nodes[node_id]
            if extra_props:
                node.properties.update(extra_props)
            return node

        node = KnowledgeNode(
            node_type=node_type,
            label=display_label or label,
            properties=extra_props or {},
        )
        self.nodes[node.node_id] = node
        self._entity_index[key] = node.node_id
        return node

    def _add_edge(self, source_id: str, target_id: str, relation: str,
                  source_fragments: list[str]) -> KnowledgeEdge:
        edge = KnowledgeEdge(
            source_id=source_id, target_id=target_id,
            relation=relation, source_fragments=source_fragments,
        )
        self.edges[edge.edge_id] = edge
        return edge

    def query_hcp(self, hcp_name: str) -> dict:
        """Query the knowledge graph for everything known about an HCP."""
        key = f"hcp:{hcp_name.lower()}"
        node_id = self._entity_index.get(key)
        if not node_id:
            return {"hcp": hcp_name, "found": False}

        node = self.nodes[node_id]
        # Find all edges involving this HCP
        outgoing = [e for e in self.edges.values() if e.source_id == node_id]
        incoming = [e for e in self.edges.values() if e.target_id == node_id]

        return {
            "hcp": hcp_name,
            "found": True,
            "node_id": node_id,
            "properties": node.properties,
            "source_fragments": len(node.source_fragments),
            "relationships": {
                "outgoing": [{"relation": e.relation, "target": self.nodes[e.target_id].label,
                             "weight": e.weight} for e in outgoing],
                "incoming": [{"relation": e.relation, "source": self.nodes[e.source_id].label,
                             "weight": e.weight} for e in incoming],
            },
        }

    def graph_summary(self) -> dict:
        return {
            "total_fragments": len(self.fragments),
            "processed_fragments": sum(1 for f in self.fragments.values() if f.processed),
            "knowledge_nodes": len(self.nodes),
            "knowledge_edges": len(self.edges),
            "node_types": {t: sum(1 for n in self.nodes.values() if n.node_type == t)
                          for t in set(n.node_type for n in self.nodes.values())},
            "edge_types": {r: sum(1 for e in self.edges.values() if e.relation == r)
                          for r in set(e.relation for e in self.edges.values())},
        }


# ═══════════════════════════════════════════════════════════════════════
# 5. HCP TRUST TRAJECTORY MODEL — predictive per-HCP trust scoring
# ═══════════════════════════════════════════════════════════════════════

class TrustTrend(Enum):
    RISING = "rising"
    STABLE = "stable"
    DECLINING = "declining"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


@dataclass
class TrustSignal:
    """A single signal that contributes to trust scoring."""
    signal_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    signal_type: str = ""  # positive_interaction, negative_interaction, ae_report, access_issue, etc.
    signal_value: float = 0.0  # -1.0 to 1.0 (negative to positive)
    weight: float = 1.0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source: str = ""  # mailos, crm, defrag_engine, manual
    description: str = ""


@dataclass
class TrustTrajectory:
    """The predicted trust trajectory for an HCP."""
    hcp_id: str = ""
    # Current state
    current_trust: float = 0.5  # 0.0 to 1.0
    # Trajectory
    trend: TrustTrend = TrustTrend.UNKNOWN
    velocity: float = 0.0  # rate of change per month
    acceleration: float = 0.0  # change in velocity
    # Prediction
    predicted_trust_30d: float = 0.5
    predicted_trust_90d: float = 0.5
    # Risk
    decline_risk: float = 0.0  # probability of significant decline in 90 days
    intervention_urgency: str = "low"  # low, medium, high, critical
    # Signals
    signal_count: int = 0
    positive_signals: int = 0
    negative_signals: int = 0
    # Recommendations
    recommended_actions: list[str] = field(default_factory=list)
    # Meta
    computed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    confidence: float = 0.0


class HCPTrustTrajectory:
    """HCP Trust Trajectory Model — predicts per-HCP trust trajectory.

    Unlike ZS (which measures NPS retrospectively), this model PREDICTS
    future trust using Gilead's own relationship data:

    Inputs:
    - MailOS intents (adverse_experience = negative, high_engagement = positive)
    - Response debt (unresolved obligations = negative)
    - Communication frequency (too much = fatigue, too little = decay)
    - Defragmentation engine facts (access issues, AE reports)
    - CRM interaction history

    Output:
    - Current trust score (0-1)
    - Trajectory (rising, stable, declining, critical)
    - 30-day and 90-day predictions
    - Decline risk probability
    - Recommended interventions
    """

    # Signal weights — how much each signal type affects trust
    SIGNAL_WEIGHTS = {
        "adverse_experience": -0.15,
        "access_problem": -0.10,
        "content_fatigue": -0.08,
        "disengaging": -0.12,
        "skeptical": -0.05,
        "unresolved_obligation": -0.03,
        "overdue_obligation": -0.06,
        "high_engagement": 0.10,
        "wants_evidence": 0.05,
        "scheduling_signal": 0.08,
        "obligation_verified": 0.04,
        "positive_interaction": 0.06,
        "no_contact_decay": -0.02,  # per 30 days without contact
    }

    def __init__(self):
        self.signals: dict[str, list[TrustSignal]] = {}  # hcp_id -> signals
        self.trajectories: dict[str, TrustTrajectory] = {}  # hcp_id -> latest trajectory

    def add_signal(self, hcp_id: str, signal_type: str, signal_value: float = None,
                   weight: float = 1.0, source: str = "", description: str = "") -> TrustSignal:
        """Add a trust signal for an HCP."""
        # Auto-calculate value from type if not provided
        if signal_value is None:
            signal_value = self.SIGNAL_WEIGHTS.get(signal_type, 0.0)

        sig = TrustSignal(
            hcp_id=hcp_id, signal_type=signal_type,
            signal_value=signal_value, weight=weight,
            source=source, description=description,
        )
        self.signals.setdefault(hcp_id, []).append(sig)
        return sig

    def compute_trajectory(self, hcp_id: str,
                           obligations: list[dict] = None,
                           intents: list[dict] = None,
                           mails: list[dict] = None,
                           days_since_last_contact: int = 0) -> TrustTrajectory:
        """Compute the trust trajectory for an HCP.

        This is the core prediction loop.
        """
        obligations = obligations or []
        intents = intents or []
        mails = mails or []

        # Auto-generate signals from MailOS data
        auto_signals = []

        # From intents
        for intent in intents:
            if intent.get("hcp_id") != hcp_id:
                continue
            itype = intent.get("intent_type", "")
            if itype in self.SIGNAL_WEIGHTS:
                auto_signals.append(("intent", itype, intent.get("confidence", 0.7),
                                    intent.get("summary", "")))

        # From obligations
        for obl in obligations:
            if obl.get("hcp_id") != hcp_id:
                continue
            status = obl.get("status", "")
            if status == "overdue":
                auto_signals.append(("obligation", "overdue_obligation", 0.9,
                                    f"Overdue: {obl.get('obligation_type', '')}"))
            elif status == "verified":
                auto_signals.append(("obligation", "obligation_verified", 0.8,
                                    f"Verified: {obl.get('obligation_type', '')}"))
            elif status in ("defined", "assigned"):
                auto_signals.append(("obligation", "unresolved_obligation", 0.5,
                                    f"Unresolved: {obl.get('obligation_type', '')}"))

        # Contact decay
        if days_since_last_contact > 30:
            decay_periods = days_since_last_contact // 30
            auto_signals.append(("decay", "no_contact_decay", decay_periods,
                                f"No contact for {days_since_last_contact} days"))

        # Add auto signals
        for source, sig_type, confidence, desc in auto_signals:
            self.add_signal(hcp_id, sig_type, weight=confidence, source=source, description=desc)

        # Compute current trust
        hcp_signals = self.signals.get(hcp_id, [])
        if not hcp_signals:
            traj = TrustTrajectory(hcp_id=hcp_id, trend=TrustTrend.UNKNOWN, confidence=0.0)
            self.trajectories[hcp_id] = traj
            return traj

        # Base trust
        base_trust = 0.5

        # Apply signals with time decay (recent signals weigh more)
        now = datetime.now(timezone.utc)
        total_weight = 0.0
        weighted_sum = 0.0

        for sig in hcp_signals:
            try:
                sig_time = datetime.fromisoformat(sig.timestamp.replace("Z", "+00:00"))
                days_ago = (now - sig_time).days
                time_decay = max(0.1, 1.0 - days_ago / 180)  # decay over 6 months
            except Exception:
                time_decay = 1.0

            w = sig.weight * time_decay
            weighted_sum += sig.signal_value * w
            total_weight += w

        if total_weight > 0:
            current_trust = base_trust + (weighted_sum / total_weight)
        else:
            current_trust = base_trust

        current_trust = max(0.0, min(1.0, current_trust))

        # Compute velocity (rate of change)
        # Sort signals by time
        sorted_signals = sorted(hcp_signals, key=lambda s: s.timestamp)
        if len(sorted_signals) >= 2:
            recent = sorted_signals[-min(5, len(sorted_signals)):]
            older = sorted_signals[:-min(5, len(sorted_signals))] or sorted_signals[:1]

            recent_avg = sum(s.signal_value * s.weight for s in recent) / max(sum(s.weight for s in recent), 1)
            older_avg = sum(s.signal_value * s.weight for s in older) / max(sum(s.weight for s in older), 1)
            velocity = (recent_avg - older_avg) * 0.5  # scale factor
        else:
            velocity = 0.0

        # Acceleration (change in velocity across time windows)
        acceleration = 0.0
        if len(sorted_signals) >= 6:
            # Split into three windows: oldest, middle, recent
            third = len(sorted_signals) // 3
            if third >= 2:
                oldest_window = sorted_signals[:third]
                middle_window = sorted_signals[third:2*third]
                recent_window = sorted_signals[2*third:]

                oldest_avg = sum(s.signal_value * s.weight for s in oldest_window) / max(sum(s.weight for s in oldest_window), 1)
                middle_avg = sum(s.signal_value * s.weight for s in middle_window) / max(sum(s.weight for s in middle_window), 1)
                recent_avg = sum(s.signal_value * s.weight for s in recent_window) / max(sum(s.weight for s in recent_window), 1)

                v1 = (middle_avg - oldest_avg) * 0.5
                v2 = (recent_avg - middle_avg) * 0.5
                acceleration = v2 - v1

        # Predictions
        predicted_30d = max(0.0, min(1.0, current_trust + velocity * 1.0))
        predicted_90d = max(0.0, min(1.0, current_trust + velocity * 3.0 + acceleration * 4.5))

        # Trend classification
        if current_trust < 0.3 or predicted_90d < 0.25:
            trend = TrustTrend.CRITICAL
        elif velocity < -0.05:
            trend = TrustTrend.DECLINING
        elif velocity > 0.05:
            trend = TrustTrend.RISING
        else:
            trend = TrustTrend.STABLE

        # Decline risk
        decline_risk = max(0.0, min(1.0, abs(min(0, velocity)) * 3 + (1 - current_trust) * 0.3))

        # Intervention urgency
        if trend == TrustTrend.CRITICAL or decline_risk > 0.7:
            urgency = "critical"
        elif trend == TrustTrend.DECLINING or decline_risk > 0.4:
            urgency = "high"
        elif decline_risk > 0.2:
            urgency = "medium"
        else:
            urgency = "low"

        # Recommended actions
        recommendations = self._recommend_actions(trend, urgency, hcp_signals, current_trust)

        # Signal counts
        positive = sum(1 for s in hcp_signals if s.signal_value > 0)
        negative = sum(1 for s in hcp_signals if s.signal_value < 0)

        traj = TrustTrajectory(
            hcp_id=hcp_id,
            current_trust=round(current_trust, 3),
            trend=trend,
            velocity=round(velocity, 4),
            acceleration=round(acceleration, 4),
            predicted_trust_30d=round(predicted_30d, 3),
            predicted_trust_90d=round(predicted_90d, 3),
            decline_risk=round(decline_risk, 3),
            intervention_urgency=urgency,
            signal_count=len(hcp_signals),
            positive_signals=positive,
            negative_signals=negative,
            recommended_actions=recommendations,
            confidence=round(min(0.4 + 0.1 * len(hcp_signals), 0.95), 2),
        )
        self.trajectories[hcp_id] = traj
        return traj

    def _recommend_actions(self, trend: TrustTrend, urgency: str,
                          signals: list[TrustSignal], current_trust: float) -> list[str]:
        """Generate recommended actions based on trust trajectory."""
        recs = []
        signal_types = {s.signal_type for s in signals}

        if urgency == "critical":
            recs.append("URGENT: Schedule in-person meeting within 7 days to repair relationship")

        if "adverse_experience" in signal_types:
            recs.append("Ensure AE has been filed and HCP has been followed up by safety team")
            recs.append("Do NOT send promotional content until AE is resolved")

        if "access_problem" in signal_types:
            recs.append("Connect HCP with market access team for patient assistance program")
            recs.append("Do NOT promote until access barrier is resolved")

        if "content_fatigue" in signal_types or "disengaging" in signal_types:
            recs.append("Pause all promotional sends for 30 days")
            recs.append("Only contact for clinical/safety reasons")

        if "skeptical" in signal_types:
            recs.append("Route scientific question to MSL — do not have rep answer clinical questions")
            recs.append("Prepare evidence specifically addressing the HCP's concern")

        if "unresolved_obligation" in signal_types or "overdue_obligation" in signal_types:
            recs.append("Close all unresolved obligations immediately — each one damages trust")

        if trend == TrustTrend.RISING and current_trust > 0.6:
            recs.append("Capitalize on positive momentum — propose deeper engagement (speaker program, advisory board)")

        if trend == TrustTrend.STABLE and current_trust > 0.7:
            recs.append("Maintain cadence — stable high-trust HCP, don't over-contact")

        if not recs:
            recs.append("Monitor — no urgent action needed at this time")

        return recs

    def portfolio_summary(self) -> dict:
        """Summary of trust across all HCPs."""
        trajectories = list(self.trajectories.values())
        if not trajectories:
            return {"total_hcps": 0}

        return {
            "total_hcps": len(trajectories),
            "avg_trust": round(sum(t.current_trust for t in trajectories) / len(trajectories), 3),
            "rising": sum(1 for t in trajectories if t.trend == TrustTrend.RISING),
            "stable": sum(1 for t in trajectories if t.trend == TrustTrend.STABLE),
            "declining": sum(1 for t in trajectories if t.trend == TrustTrend.DECLINING),
            "critical": sum(1 for t in trajectories if t.trend == TrustTrend.CRITICAL),
            "high_urgency": sum(1 for t in trajectories if t.intervention_urgency in ("high", "critical")),
            "avg_decline_risk": round(sum(t.decline_risk for t in trajectories) / len(trajectories), 3),
        }


# ═══════════════════════════════════════════════════════════════════════
# 6. REP INBOX DEFRAG — consolidates rep's daily queue into prioritized actions
# ═══════════════════════════════════════════════════════════════════════

class InboxItemPriority(Enum):
    CRITICAL = "critical"   # safety/AE, regulatory deadline
    HIGH = "high"           # HCP waiting response, access issue
    MEDIUM = "medium"       # content request, scheduling
    LOW = "low"             # informational, FYI
    DEFER = "defer"         # can wait, batch later


@dataclass
class InboxItem:
    """A single item in the rep's defragmented inbox."""
    item_id: str = field(default_factory=lambda: str(uuid4()))
    rep_id: str = ""
    source: str = ""  # email, crm_note, slack, spreadsheet, defrag_engine
    source_id: str = ""
    hcp_id: str = ""
    title: str = ""
    description: str = ""
    priority: InboxItemPriority = InboxItemPriority.MEDIUM
    deadline: str = ""
    deadline_hours: float = 0.0  # hours until deadline
    action_type: str = ""  # respond, route, schedule, log, review
    consolidated: bool = False  # was this merged from multiple sources?
    consolidated_from: list[str] = field(default_factory=list)  # source item_ids
    estimated_minutes: float = 5.0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed: bool = False
    completed_at: str = ""


class RepInboxDefrag:
    """Rep Inbox Defrag — consolidates a rep's fragmented daily queue.

    A rep's day is fragmented across:
    - Email inbox (50-200 emails/day)
    - CRM tasks and reminders
    - Slack/Teams messages
    - Spreadsheet updates
    - Meeting notes

    This system ingests all sources, deduplicates, prioritizes, and
    consolidates related items into a single prioritized action queue.

    Output: a ranked list of InboxItems the rep works through top-to-bottom.
    """

    def __init__(self):
        self.inboxes: dict[str, list[InboxItem]] = {}  # rep_id -> items
        self.consolidation_rules = {
            # Merge items about the same HCP within 24h
            "same_hcp_window": 24,
            # Merge items about the same drug
            "same_drug": True,
            # Merge multiple emails from same HCP into one action
            "same_hcp_emails": True,
        }

    def ingest_email(self, rep_id: str, mail: dict) -> InboxItem:
        """Ingest an email as an inbox item."""
        priority = self._classify_email_priority(mail)
        item = InboxItem(
            rep_id=rep_id,
            source="email",
            source_id=mail.get("mail_id", ""),
            hcp_id=mail.get("matched_hcp_id", ""),
            title=mail.get("subject", "")[:100],
            description=mail.get("body", "")[:300],
            priority=priority,
            action_type=self._email_action_type(mail),
            estimated_minutes=self._estimate_time(mail, "email"),
        )
        self.inboxes.setdefault(rep_id, []).append(item)
        return item

    def ingest_obligation(self, rep_id: str, obl: dict) -> InboxItem:
        """Ingest an obligation as an inbox item."""
        priority = InboxItemPriority.CRITICAL if obl.get("status") == "overdue" else InboxItemPriority.HIGH
        if obl.get("obligation_type") == "safety_report":
            priority = InboxItemPriority.CRITICAL

        deadline = obl.get("deadline", "")
        hours_left = 0.0
        if deadline:
            try:
                dl = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                hours_left = max(0, (dl - datetime.now(timezone.utc)).total_seconds() / 3600)
            except Exception:
                pass

        item = InboxItem(
            rep_id=rep_id,
            source="obligation",
            source_id=obl.get("obligation_id", ""),
            hcp_id=obl.get("hcp_id", ""),
            title=f"Obligation: {obl.get('obligation_type', '')}",
            description=obl.get("description", "")[:300],
            priority=priority,
            deadline=deadline,
            deadline_hours=hours_left,
            action_type=self._obligation_action_type(obl),
            estimated_minutes=15.0,
        )
        self.inboxes.setdefault(rep_id, []).append(item)
        return item

    def ingest_intent(self, rep_id: str, intent: dict) -> InboxItem:
        """Ingest an HCP intent signal as an inbox item."""
        itype = intent.get("intent_type", "")
        priority = InboxItemPriority.HIGH
        if itype in ("adverse_experience", "access_problem"):
            priority = InboxItemPriority.CRITICAL
        elif itype in ("content_fatigue", "disengaging"):
            priority = InboxItemPriority.LOW  # don't act, just note

        item = InboxItem(
            rep_id=rep_id,
            source="intent",
            source_id=intent.get("intent_id", ""),
            hcp_id=intent.get("hcp_id", ""),
            title=f"Intent: {itype}",
            description=intent.get("summary", "")[:300],
            priority=priority,
            action_type="review",
            estimated_minutes=3.0,
        )
        self.inboxes.setdefault(rep_id, []).append(item)
        return item

    def ingest_crm_task(self, rep_id: str, task: dict) -> InboxItem:
        """Ingest a CRM task as an inbox item."""
        item = InboxItem(
            rep_id=rep_id,
            source="crm_task",
            source_id=task.get("task_id", ""),
            hcp_id=task.get("hcp_id", ""),
            title=task.get("description", "")[:100],
            description=task.get("details", "")[:300],
            priority=InboxItemPriority.MEDIUM,
            deadline=task.get("due_date", ""),
            action_type=task.get("action_type", "log"),
            estimated_minutes=task.get("estimated_minutes", 10.0),
        )
        self.inboxes.setdefault(rep_id, []).append(item)
        return item

    def consolidate(self, rep_id: str) -> list[InboxItem]:
        """Consolidate the rep's inbox — merge related items, deduplicate, rank."""
        items = self.inboxes.get(rep_id, [])
        if not items:
            return []

        # Group by HCP
        by_hcp: dict[str, list[InboxItem]] = {}
        no_hcp: list[InboxItem] = []
        for item in items:
            if item.hcp_id:
                by_hcp.setdefault(item.hcp_id, []).append(item)
            else:
                no_hcp.append(item)

        consolidated: list[InboxItem] = []

        # Consolidate per-HCP items
        for hcp_id, hcp_items in by_hcp.items():
            if len(hcp_items) <= 1:
                consolidated.extend(hcp_items)
                continue

            # Merge multiple items for same HCP into one consolidated item
            # Keep the highest priority
            highest = max(hcp_items, key=lambda x: list(InboxItemPriority).index(x.priority))
            merged_ids = [i.item_id for i in hcp_items if i.item_id != highest.item_id]

            # Build consolidated description
            descriptions = [f"[{i.source}] {i.description[:100]}" for i in hcp_items]
            highest.description = " | ".join(descriptions[:3])
            highest.consolidated = True
            highest.consolidated_from = merged_ids
            highest.estimated_minutes = sum(i.estimated_minutes for i in hcp_items)
            consolidated.append(highest)

        consolidated.extend(no_hcp)

        # Sort by priority, then deadline
        priority_order = list(InboxItemPriority)
        consolidated.sort(key=lambda x: (
            priority_order.index(x.priority),
            x.deadline_hours if x.deadline_hours > 0 else 999,
        ))

        self.inboxes[rep_id] = consolidated
        return consolidated

    def get_queue(self, rep_id: str, limit: int = 20) -> list[InboxItem]:
        """Get the rep's prioritized action queue."""
        items = self.consolidate(rep_id)
        return [i for i in items if not i.completed][:limit]

    def complete_item(self, rep_id: str, item_id: str) -> Optional[InboxItem]:
        """Mark an inbox item as completed."""
        for item in self.inboxes.get(rep_id, []):
            if item.item_id == item_id:
                item.completed = True
                item.completed_at = datetime.now(timezone.utc).isoformat()
                return item
        return None

    def _classify_email_priority(self, mail: dict) -> InboxItemPriority:
        subject = (mail.get("subject", "") + " " + mail.get("body", "")).lower()
        if any(w in subject for w in ["adverse", "safety", "ae report", "medwatch"]):
            return InboxItemPriority.CRITICAL
        if any(w in subject for w in ["urgent", "denied", "rejected", "access", "prior auth"]):
            return InboxItemPriority.HIGH
        if any(w in subject for w in ["question", "request", "information", "data"]):
            return InboxItemPriority.MEDIUM
        if any(w in subject for w in ["fwd:", "fyi", "newsletter", "update"]):
            return InboxItemPriority.LOW
        return InboxItemPriority.MEDIUM

    def _email_action_type(self, mail: dict) -> str:
        subject = (mail.get("subject", "") + " " + mail.get("body", "")).lower()
        if "adverse" in subject or "safety" in subject:
            return "route_to_safety"
        if "question" in subject or "evidence" in subject or "data" in subject:
            return "route_to_medical"
        if "denied" in subject or "access" in subject:
            return "route_to_access"
        if "meeting" in subject or "lunch" in subject or "schedule" in subject:
            return "schedule"
        return "respond"

    def _obligation_action_type(self, obl: dict) -> str:
        ot = obl.get("obligation_type", "")
        if ot == "safety_report":
            return "route_to_safety"
        if ot == "medical_response":
            return "route_to_medical"
        if ot == "access_resolution":
            return "route_to_access"
        if ot == "content_delivery":
            return "send_content"
        return "follow_up"

    def _estimate_time(self, item: dict, source: str) -> float:
        body_len = len(item.get("body", ""))
        if source == "email":
            if body_len > 1000:
                return 15.0
            elif body_len > 200:
                return 8.0
            return 3.0
        return 5.0

    def summary(self, rep_id: str) -> dict:
        items = self.inboxes.get(rep_id, [])
        return {
            "rep_id": rep_id,
            "total_items": len(items),
            "completed": sum(1 for i in items if i.completed),
            "pending": sum(1 for i in items if not i.completed),
            "critical": sum(1 for i in items if i.priority == InboxItemPriority.CRITICAL and not i.completed),
            "high": sum(1 for i in items if i.priority == InboxItemPriority.HIGH and not i.completed),
            "medium": sum(1 for i in items if i.priority == InboxItemPriority.MEDIUM and not i.completed),
            "low": sum(1 for i in items if i.priority == InboxItemPriority.LOW and not i.completed),
            "consolidated": sum(1 for i in items if i.consolidated),
            "estimated_total_minutes": sum(i.estimated_minutes for i in items if not i.completed),
        }


# ═══════════════════════════════════════════════════════════════════════
# 7. COST-PER-CALL HALVER — autonomous channel execution for low-value touches
# ═══════════════════════════════════════════════════════════════════════

class TouchValue(Enum):
    HIGH_VALUE = "high_value"       # requires in-person (complex clinical discussion)
    MEDIUM_VALUE = "medium_value"   # can be virtual (content delivery, follow-up)
    LOW_VALUE = "low_value"         # can be automated (FYI, confirmation, reminder)
    NO_VALUE = "no_value"           # don't touch at all


@dataclass
class TouchDecision:
    """A single cost-per-call optimization decision."""
    decision_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    rep_id: str = ""
    original_channel: str = "in_person"
    recommended_channel: str = "email"
    touch_value: TouchValue = TouchValue.LOW_VALUE
    rationale: str = ""
    estimated_cost_savings: float = 0.0
    estimated_time_savings: float = 0.0  # minutes
    confidence: float = 0.0
    auto_executable: bool = False
    executed: bool = False
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CostPerCallHalver:
    """Cost-per-call Halver — routes low-value touches to cheaper channels.

    Not every HCP interaction needs an in-person visit. Many can be handled
    via email, SMS, or Approved Email. This system classifies each planned
    touch by value and recommends the cheapest effective channel.

    Channel cost hierarchy (industry benchmarks):
      In-person visit: $150-300 (rep time + travel)
      Virtual meeting: $50-100 (rep time, no travel)
      Phone call: $20-40 (rep time)
      Approved Email: $2-5 (automated, compliance-checked)
      SMS: $0.10-0.50 (automated)

    The system saves cost by downgrading low-value touches to cheaper channels.
    """

    DEFAULT_CHANNEL_COSTS = {
        "in_person": 200.0,
        "virtual": 75.0,
        "phone": 30.0,
        "approved_email": 3.0,
        "email": 3.0,
        "sms": 0.25,
    }

    DEFAULT_CHANNEL_TIME = {
        "in_person": 90.0,  # including travel
        "virtual": 30.0,
        "phone": 15.0,
        "approved_email": 5.0,
        "email": 5.0,
        "sms": 1.0,
    }

    def __init__(self, channel_costs: dict[str, float] = None,
                 channel_time: dict[str, float] = None):
        self.decisions: dict[str, TouchDecision] = {}
        self.hcp_history: dict[str, list[dict]] = {}  # hcp_id -> touch history
        self.channel_costs = channel_costs or dict(self.DEFAULT_CHANNEL_COSTS)
        self.channel_time = channel_time or dict(self.DEFAULT_CHANNEL_TIME)

    def classify_touch(self, hcp_id: str, rep_id: str,
                       planned_channel: str = "in_person",
                       touch_reason: str = "",
                       hcp_intent: str = "",
                       hcp_trust: float = 0.5,
                       is_kol: bool = False) -> TouchDecision:
        """Classify a planned touch and recommend the optimal channel."""
        # KOLs and high-trust HCPs always get in-person for substantive touches
        if is_kol and hcp_trust > 0.6:
            return TouchDecision(
                hcp_id=hcp_id, rep_id=rep_id,
                original_channel=planned_channel,
                recommended_channel="in_person",
                touch_value=TouchValue.HIGH_VALUE,
                rationale="KOL with high trust — in-person required",
                confidence=0.9,
                auto_executable=False,
            )

        # Classify by intent
        value, channel, rationale, auto = self._classify_by_intent(
            hcp_intent, touch_reason, hcp_trust)

        # Calculate savings
        orig_cost = self.channel_costs.get(planned_channel, self.channel_costs.get("in_person", 200))
        new_cost = self.channel_costs.get(channel, self.channel_costs.get("approved_email", 3))
        orig_time = self.channel_time.get(planned_channel, self.channel_time.get("in_person", 90))
        new_time = self.channel_time.get(channel, self.channel_time.get("approved_email", 5))

        decision = TouchDecision(
            hcp_id=hcp_id, rep_id=rep_id,
            original_channel=planned_channel,
            recommended_channel=channel,
            touch_value=value,
            rationale=rationale,
            estimated_cost_savings=round(orig_cost - new_cost, 2),
            estimated_time_savings=round(orig_time - new_time, 1),
            confidence=0.75,
            auto_executable=auto,
        )
        self.decisions[decision.decision_id] = decision
        return decision

    def _classify_by_intent(self, intent: str, reason: str,
                            trust: float) -> tuple:
        """Returns (value, channel, rationale, auto_executable)."""
        reason_lower = (reason + " " + intent).lower()

        # High-value: requires in-person
        if any(w in reason_lower for w in ["clinical", "evidence", "safety", "ae", "complex", "objection"]):
            return (TouchValue.HIGH_VALUE, "in_person",
                   "Clinical/safety discussion requires in-person", False)

        # Medium-value: virtual is fine
        if any(w in reason_lower for w in ["follow", "content", "update", "results", "data"]):
            if trust > 0.5:
                return (TouchValue.MEDIUM_VALUE, "virtual",
                       "Content delivery can be virtual — HCP trusts rep", False)
            return (TouchValue.MEDIUM_VALUE, "phone",
                   "Content delivery via phone — build trust first", False)

        # Low-value: automate
        if any(w in reason_lower for w in ["reminder", "confirm", "fyi", "newsletter", "schedule"]):
            return (TouchValue.LOW_VALUE, "approved_email",
                   "Informational touch — Approved Email is sufficient", True)

        # No-value: don't touch
        if any(w in reason_lower for w in ["fatigue", "disengag", "stop", "opt out"]):
            return (TouchValue.NO_VALUE, "none",
                   "HCP is fatigued/disengaging — do not touch", True)

        # Default: medium
        return (TouchValue.MEDIUM_VALUE, "virtual",
               "Standard touch — virtual is cost-effective", False)

    def execute_auto(self, decision_id: str) -> Optional[TouchDecision]:
        """Auto-execute a low-value touch (email/SMS)."""
        d = self.decisions.get(decision_id)
        if not d or not d.auto_executable:
            return None
        d.executed = True
        return d

    def batch_optimize(self, touches: list[dict]) -> list[TouchDecision]:
        """Optimize a batch of planned touches."""
        results = []
        for t in touches:
            d = self.classify_touch(
                hcp_id=t.get("hcp_id", ""),
                rep_id=t.get("rep_id", ""),
                planned_channel=t.get("planned_channel", "in_person"),
                touch_reason=t.get("reason", ""),
                hcp_intent=t.get("intent", ""),
                hcp_trust=t.get("trust", 0.5),
                is_kol=t.get("is_kol", False),
            )
            results.append(d)
        return results

    def summary(self) -> dict:
        decisions = list(self.decisions.values())
        if not decisions:
            return {"total_decisions": 0}
        total_savings = sum(d.estimated_cost_savings for d in decisions)
        total_time_savings = sum(d.estimated_time_savings for d in decisions)
        return {
            "total_decisions": len(decisions),
            "executed": sum(1 for d in decisions if d.executed),
            "auto_executable": sum(1 for d in decisions if d.auto_executable),
            "total_cost_savings": round(total_savings, 2),
            "total_time_savings_minutes": round(total_time_savings, 1),
            "avg_savings_per_touch": round(total_savings / len(decisions), 2),
            "channel_distribution": {
                ch: sum(1 for d in decisions if d.recommended_channel == ch)
                for ch in set(d.recommended_channel for d in decisions)
            },
        }


# ═══════════════════════════════════════════════════════════════════════
# 8. HCP FATIGUE INTELLIGENCE — detects over-contacting, enforces cooling
# ═══════════════════════════════════════════════════════════════════════

class FatigueLevel(Enum):
    NONE = "none"
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"  # HCP has asked to stop


@dataclass
class FatigueState:
    """Fatigue state for a single HCP."""
    hcp_id: str = ""
    level: FatigueLevel = FatigueLevel.NONE
    contacts_30d: int = 0
    contacts_7d: int = 0
    last_contact: str = ""
    days_since_contact: int = 0
    cooling_period_days: int = 0  # enforced no-contact period
    cooling_until: str = ""
    fatigue_score: float = 0.0  # 0-1, higher = more fatigued
    signals: list[str] = field(default_factory=list)
    recommended_action: str = ""
    computed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class HCPFatigueIntelligence:
    """HCP Fatigue Intelligence — respects HCP time.

    Pharma's #1 trust-killer is over-contacting. ZS data: 75% of HCPs
    trust clinical data but only 25% trust pharma as a partner — largely
    because of contact fatigue.

    This system:
    1. Tracks contact frequency per HCP
    2. Detects fatigue signals (unsubscribes, ignored emails, declined meetings)
    3. Enforces cooling periods
    4. Prevents agents from contacting fatigued HCPs
    """

    # Fatigue thresholds
    CONTACT_THRESHOLDS = {
        "max_per_7d": 3,    # max 3 contacts per week
        "max_per_30d": 8,   # max 8 contacts per month
        "min_gap_days": 3,  # min 3 days between contacts
    }

    COOLING_PERIODS = {
        FatigueLevel.LOW: 7,
        FatigueLevel.MODERATE: 14,
        FatigueLevel.HIGH: 30,
        FatigueLevel.CRITICAL: 90,
    }

    def __init__(self):
        self.states: dict[str, FatigueState] = {}
        self.contact_log: dict[str, list[dict]] = {}  # hcp_id -> contact history

    def log_contact(self, hcp_id: str, channel: str = "",
                    timestamp: str = "", rep_id: str = "") -> None:
        """Log a contact attempt to an HCP."""
        ts = timestamp or datetime.now(timezone.utc).isoformat()
        self.contact_log.setdefault(hcp_id, []).append({
            "channel": channel, "timestamp": ts, "rep_id": rep_id,
        })

    def log_fatigue_signal(self, hcp_id: str, signal: str) -> None:
        """Log a fatigue signal (unsubscribe, declined meeting, etc.)."""
        state = self.states.setdefault(hcp_id, FatigueState(hcp_id=hcp_id))
        state.signals.append(signal)
        # Critical signals immediately trigger cooling
        if signal in ("unsubscribe", "opt_out", "complaint", "stop_email"):
            state.level = FatigueLevel.CRITICAL
            state.cooling_period_days = self.COOLING_PERIODS[FatigueLevel.CRITICAL]
            state.cooling_until = (datetime.now(timezone.utc) +
                                   timedelta(days=state.cooling_period_days)).isoformat()

    def compute_fatigue(self, hcp_id: str) -> FatigueState:
        """Compute current fatigue state for an HCP."""
        contacts = self.contact_log.get(hcp_id, [])
        now = datetime.now(timezone.utc)

        # Count recent contacts
        contacts_7d = 0
        contacts_30d = 0
        last_contact_ts = ""
        for c in contacts:
            try:
                ct = datetime.fromisoformat(c["timestamp"].replace("Z", "+00:00"))
                days_ago = (now - ct).days
                if days_ago <= 7:
                    contacts_7d += 1
                if days_ago <= 30:
                    contacts_30d += 1
                if not last_contact_ts or ct > datetime.fromisoformat(last_contact_ts.replace("Z", "+00:00")):
                    last_contact_ts = c["timestamp"]
            except Exception:
                continue

        days_since = 999
        if last_contact_ts:
            try:
                last_dt = datetime.fromisoformat(last_contact_ts.replace("Z", "+00:00"))
                days_since = (now - last_dt).days
            except Exception:
                pass

        # Calculate fatigue score
        score = 0.0
        if contacts_7d > self.CONTACT_THRESHOLDS["max_per_7d"]:
            score += 0.3
        if contacts_30d > self.CONTACT_THRESHOLDS["max_per_30d"]:
            score += 0.3
        if days_since < self.CONTACT_THRESHOLDS["min_gap_days"]:
            score += 0.2

        # Check for explicit fatigue signals
        state = self.states.get(hcp_id, FatigueState(hcp_id=hcp_id))
        fatigue_signals = state.signals
        if any(s in ("unsubscribe", "opt_out", "complaint") for s in fatigue_signals):
            score = 1.0
            level = FatigueLevel.CRITICAL
        elif score >= 0.6:
            level = FatigueLevel.HIGH
        elif score >= 0.3:
            level = FatigueLevel.MODERATE
        elif score > 0:
            level = FatigueLevel.LOW
        else:
            level = FatigueLevel.NONE

        # Set cooling period if needed
        cooling_days = 0
        cooling_until = ""
        if level in self.COOLING_PERIODS and level != FatigueLevel.NONE:
            cooling_days = self.COOLING_PERIODS[level]
            cooling_until = (now + timedelta(days=cooling_days)).isoformat()

        # Recommended action
        if level == FatigueLevel.CRITICAL:
            action = "DO NOT CONTACT — HCP has opted out. 90-day cooling period."
        elif level == FatigueLevel.HIGH:
            action = "Pause all contact for 30 days. Only safety-critical communication."
        elif level == FatigueLevel.MODERATE:
            action = "Reduce contact frequency. Only high-value touches for 14 days."
        elif level == FatigueLevel.LOW:
            action = "Monitor. Space out future contacts."
        else:
            action = "Normal contact cadence OK."

        state = FatigueState(
            hcp_id=hcp_id, level=level,
            contacts_30d=contacts_30d, contacts_7d=contacts_7d,
            last_contact=last_contact_ts, days_since_contact=days_since,
            cooling_period_days=cooling_days, cooling_until=cooling_until,
            fatigue_score=round(score, 2), signals=fatigue_signals,
            recommended_action=action,
        )
        self.states[hcp_id] = state
        return state

    def can_contact(self, hcp_id: str) -> tuple[bool, str]:
        """Check if an HCP can be contacted right now."""
        state = self.compute_fatigue(hcp_id)
        if state.level == FatigueLevel.CRITICAL:
            return False, "HCP has opted out — cooling period active"
        if state.cooling_until:
            try:
                cooling_dt = datetime.fromisoformat(state.cooling_until.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) < cooling_dt:
                    return False, f"Cooling period active until {state.cooling_until[:10]}"
            except Exception:
                pass
        if state.days_since_contact < self.CONTACT_THRESHOLDS["min_gap_days"]:
            return False, f"Only {state.days_since_contact} days since last contact (min gap: {self.CONTACT_THRESHOLDS['min_gap_days']})"
        return True, "OK to contact"

    def summary(self) -> dict:
        states = list(self.states.values())
        if not states:
            return {"total_hcps": 0}
        return {
            "total_hcps": len(states),
            "none": sum(1 for s in states if s.level == FatigueLevel.NONE),
            "low": sum(1 for s in states if s.level == FatigueLevel.LOW),
            "moderate": sum(1 for s in states if s.level == FatigueLevel.MODERATE),
            "high": sum(1 for s in states if s.level == FatigueLevel.HIGH),
            "critical": sum(1 for s in states if s.level == FatigueLevel.CRITICAL),
            "in_cooling": sum(1 for s in states if s.cooling_until),
            "avg_fatigue_score": round(sum(s.fatigue_score for s in states) / len(states), 2),
        }


# ═══════════════════════════════════════════════════════════════════════
# 9. HCP ACCESS REDIRECT — redirects reps from inaccessible HCPs
# ═══════════════════════════════════════════════════════════════════════

class AccessStatus(Enum):
    ACCESSIBLE = "accessible"
    RESTRICTED = "restricted"       # no access currently
    NO_SEE = "no_see"              # HCP has asked reps not to visit
    LIMITED = "limited"            # only specific channels
    UNKNOWN = "unknown"


@dataclass
class HCPAccessProfile:
    """Access profile for a single HCP."""
    hcp_id: str = ""
    access_status: AccessStatus = AccessStatus.UNKNOWN
    accessible_channels: list[str] = field(default_factory=list)
    no_see_reason: str = ""
    last_successful_contact: str = ""
    access_attempts: int = 0
    access_successes: int = 0
    access_rate: float = 0.0
    alternative_hcps: list[str] = field(default_factory=list)  # similar HCPs that are accessible
    recommended_action: str = ""


class HCPAccessRedirect:
    """HCP Access Redirect — redirects reps from inaccessible HCPs.

    Veeva HCP Access data: 11 FTE saved, $9M uplift, 9X ROI from one
    retargeting exercise. The principle: don't waste rep time on HCPs
    who can't or won't see them. Redirect to accessible alternatives.

    This system:
    1. Tracks access status per HCP (accessible, restricted, no-see, limited)
    2. Calculates access success rate
    3. Recommends alternative HCPs when access is blocked
    4. Prevents wasted visits to no-see HCPs
    """

    def __init__(self):
        self.profiles: dict[str, HCPAccessProfile] = {}
        self.hcp_similarity: dict[str, list[str]] = {}  # hcp_id -> similar hcp_ids

    def set_access_status(self, hcp_id: str, status: AccessStatus,
                          reason: str = "", channels: list[str] = None) -> HCPAccessProfile:
        """Set the access status for an HCP."""
        profile = self.profiles.get(hcp_id, HCPAccessProfile(hcp_id=hcp_id))
        profile.access_status = status
        if reason:
            profile.no_see_reason = reason
        if channels:
            profile.accessible_channels = channels
        self.profiles[hcp_id] = profile
        return profile

    def log_access_attempt(self, hcp_id: str, success: bool) -> None:
        """Log an access attempt (visit, call, email)."""
        profile = self.profiles.get(hcp_id, HCPAccessProfile(hcp_id=hcp_id))
        profile.access_attempts += 1
        if success:
            profile.access_successes += 1
            profile.last_successful_contact = datetime.now(timezone.utc).isoformat()
        profile.access_rate = profile.access_successes / max(profile.access_attempts, 1)
        self.profiles[hcp_id] = profile

    def register_similar_hcps(self, hcp_id: str, similar: list[str]) -> None:
        """Register similar HCPs for redirect recommendations."""
        self.hcp_similarity[hcp_id] = similar

    def check_access(self, hcp_id: str) -> tuple[bool, str, list[str]]:
        """Check if an HCP is accessible. Returns (accessible, reason, alternatives)."""
        profile = self.profiles.get(hcp_id)
        if not profile:
            return True, "Unknown — proceed with caution", []

        if profile.access_status == AccessStatus.NO_SEE:
            alternatives = self._find_alternatives(hcp_id)
            return False, f"No-see: {profile.no_see_reason}", alternatives

        if profile.access_status == AccessStatus.RESTRICTED:
            alternatives = self._find_alternatives(hcp_id)
            return False, "Access restricted", alternatives

        if profile.access_status == AccessStatus.LIMITED:
            return True, f"Limited access — channels: {profile.accessible_channels}", []

        if profile.access_rate < 0.3 and profile.access_attempts > 5:
            alternatives = self._find_alternatives(hcp_id)
            return False, f"Low access rate ({profile.access_rate:.0%})", alternatives

        return True, "Accessible", []

    def _find_alternatives(self, hcp_id: str) -> list[str]:
        """Find accessible alternative HCPs."""
        similar = self.hcp_similarity.get(hcp_id, [])
        accessible = []
        for alt_id in similar:
            alt_profile = self.profiles.get(alt_id)
            if alt_profile and alt_profile.access_status == AccessStatus.ACCESSIBLE:
                accessible.append(alt_id)
        return accessible

    def redirect(self, hcp_id: str) -> dict:
        """Get redirect recommendation for an inaccessible HCP."""
        accessible, reason, alternatives = self.check_access(hcp_id)
        return {
            "hcp_id": hcp_id,
            "accessible": accessible,
            "reason": reason,
            "alternatives": alternatives,
            "action": "redirect" if not accessible and alternatives else (
                "retry" if not accessible else "proceed"),
        }

    def batch_check(self, hcp_ids: list[str]) -> list[dict]:
        """Check access for a batch of HCPs."""
        return [self.redirect(hid) for hid in hcp_ids]

    def summary(self) -> dict:
        profiles = list(self.profiles.values())
        if not profiles:
            return {"total_hcps": 0}
        return {
            "total_hcps": len(profiles),
            "accessible": sum(1 for p in profiles if p.access_status == AccessStatus.ACCESSIBLE),
            "restricted": sum(1 for p in profiles if p.access_status == AccessStatus.RESTRICTED),
            "no_see": sum(1 for p in profiles if p.access_status == AccessStatus.NO_SEE),
            "limited": sum(1 for p in profiles if p.access_status == AccessStatus.LIMITED),
            "unknown": sum(1 for p in profiles if p.access_status == AccessStatus.UNKNOWN),
            "avg_access_rate": round(sum(p.access_rate for p in profiles) / len(profiles), 2),
            "redirects_available": sum(1 for p in profiles if p.access_status in (AccessStatus.NO_SEE, AccessStatus.RESTRICTED)),
        }


# ═══════════════════════════════════════════════════════════════════════
# 10. ENGAGEMENT GRAPH — Gilead's own relationship data substrate
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class EngagementNode:
    """A node in the engagement graph."""
    node_id: str = field(default_factory=lambda: str(uuid4()))
    node_type: str = ""  # hcp, rep, msl, drug, obligation, interaction, organization
    label: str = ""
    properties: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class EngagementEdge:
    """An edge in the engagement graph."""
    edge_id: str = field(default_factory=lambda: str(uuid4()))
    source_id: str = ""
    target_id: str = ""
    relation: str = ""  # interacts_with, prescribes, asked_about, trusts, etc.
    weight: float = 1.0
    properties: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EngagementGraph:
    """Engagement Graph — Gilead's own relationship data substrate.

    This is the central data structure that all other systems query.
    It captures the full relationship graph between:
    - HCPs and reps (who talks to whom)
    - HCPs and drugs (who prescribes what)
    - HCPs and obligations (what's pending)
    - Reps and MSLs (routing relationships)
    - Organizations and HCPs (affiliation)

    The graph is Gilead's proprietary data — no competitor can buy it.
    """

    def __init__(self):
        self.nodes: dict[str, EngagementNode] = {}
        self.edges: dict[str, EngagementEdge] = {}
        self._type_index: dict[str, set[str]] = {}  # type -> {node_ids}
        self._adjacency: dict[str, list[str]] = {}  # node_id -> [edge_ids]

    def add_node(self, node_type: str, label: str, **props) -> EngagementNode:
        """Add a node to the engagement graph."""
        node = EngagementNode(node_type=node_type, label=label, properties=props)
        self.nodes[node.node_id] = node
        self._type_index.setdefault(node_type, set()).add(node.node_id)
        return node

    def add_edge(self, source_id: str, target_id: str, relation: str,
                 weight: float = 1.0, **props) -> EngagementEdge:
        """Add an edge to the engagement graph."""
        edge = EngagementEdge(
            source_id=source_id, target_id=target_id,
            relation=relation, weight=weight, properties=props,
        )
        self.edges[edge.edge_id] = edge
        self._adjacency.setdefault(source_id, []).append(edge.edge_id)
        self._adjacency.setdefault(target_id, []).append(edge.edge_id)
        return edge

    def get_node(self, node_id: str) -> Optional[EngagementNode]:
        return self.nodes.get(node_id)

    def get_nodes_by_type(self, node_type: str) -> list[EngagementNode]:
        ids = self._type_index.get(node_type, set())
        return [self.nodes[nid] for nid in ids]

    def get_neighbors(self, node_id: str, relation: str = "") -> list[EngagementNode]:
        """Get neighboring nodes, optionally filtered by relation."""
        edge_ids = self._adjacency.get(node_id, [])
        neighbors = []
        for eid in edge_ids:
            edge = self.edges[eid]
            if relation and edge.relation != relation:
                continue
            other_id = edge.target_id if edge.source_id == node_id else edge.source_id
            node = self.nodes.get(other_id)
            if node:
                neighbors.append(node)
        return neighbors

    def get_edges(self, node_id: str, relation: str = "") -> list[EngagementEdge]:
        """Get edges involving a node, optionally filtered by relation."""
        edge_ids = self._adjacency.get(node_id, [])
        edges = [self.edges[eid] for eid in edge_ids]
        if relation:
            edges = [e for e in edges if e.relation == relation]
        return edges

    def query_hcp(self, hcp_id: str) -> dict:
        """Query everything about an HCP from the graph."""
        node = self.nodes.get(hcp_id)
        if not node:
            return {"found": False}

        edges = self.get_edges(hcp_id)
        relationships = {}
        for e in edges:
            other_id = e.target_id if e.source_id == hcp_id else e.source_id
            other = self.nodes.get(other_id)
            if other:
                relationships.setdefault(e.relation, []).append({
                    "node_id": other_id,
                    "node_type": other.node_type,
                    "label": other.label,
                    "weight": e.weight,
                })

        return {
            "found": True,
            "node_id": hcp_id,
            "label": node.label,
            "properties": node.properties,
            "relationship_count": len(edges),
            "relationships": relationships,
        }

    def find_path(self, source_id: str, target_id: str, max_depth: int = 4) -> list[str]:
        """Find shortest path between two nodes (BFS)."""
        if source_id == target_id:
            return [source_id]
        visited = {source_id}
        queue = [[source_id]]
        while queue:
            path = queue.pop(0)
            if len(path) > max_depth:
                continue
            node_id = path[-1]
            for eid in self._adjacency.get(node_id, []):
                edge = self.edges[eid]
                other = edge.target_id if edge.source_id == node_id else edge.source_id
                if other == target_id:
                    return path + [other]
                if other not in visited:
                    visited.add(other)
                    queue.append(path + [other])
        return []

    def subgraph(self, node_id: str, depth: int = 2) -> dict:
        """Extract a subgraph around a node."""
        visited = set()
        nodes = []
        edges = []
        self._subgraph_recursive(node_id, depth, visited, nodes, edges)
        return {
            "center": node_id,
            "nodes": [{"node_id": n.node_id, "type": n.node_type, "label": n.label} for n in nodes],
            "edges": [{"source": e.source_id, "target": e.target_id, "relation": e.relation, "weight": e.weight} for e in edges],
        }

    def _subgraph_recursive(self, node_id: str, depth: int,
                            visited: set, nodes: list, edges: list) -> None:
        if node_id in visited or depth < 0:
            return
        visited.add(node_id)
        node = self.nodes.get(node_id)
        if node:
            nodes.append(node)
        for eid in self._adjacency.get(node_id, []):
            edge = self.edges[eid]
            edges.append(edge)
            other = edge.target_id if edge.source_id == node_id else edge.source_id
            if other not in visited:
                self._subgraph_recursive(other, depth - 1, visited, nodes, edges)

    def summary(self) -> dict:
        return {
            "total_nodes": len(self.nodes),
            "total_edges": len(self.edges),
            "node_types": {t: len(ids) for t, ids in self._type_index.items()},
            "edge_types": {r: sum(1 for e in self.edges.values() if e.relation == r)
                          for r in set(e.relation for e in self.edges.values())},
        }


# ═══════════════════════════════════════════════════════════════════════
# 11. AGENT POPULATION GOVERNANCE — prevents agents from colliding
# ═══════════════════════════════════════════════════════════════════════

class GovernanceRuleType(Enum):
    NO_DUPLICATE_TOUCH = "no_duplicate_touch"       # two agents can't touch same HCP same day
    CHANNEL_EXCLUSIVITY = "channel_exclusivity"     # only one channel per HCP per day
    MEDICAL_COMMERCIAL_SEPARATION = "medical_commercial_separation"  # MSL + rep can't both contact
    COOLDOWN_ENFORCEMENT = "cooldown_enforcement"   # respect fatigue cooling periods
    PRIORITY_OVERRIDE = "priority_override"         # safety overrides everything


@dataclass
class GovernanceRule:
    """A governance rule for the agent population."""
    rule_id: str = field(default_factory=lambda: str(uuid4()))
    rule_type: GovernanceRuleType = GovernanceRuleType.NO_DUPLICATE_TOUCH
    description: str = ""
    enabled: bool = True
    priority: int = 1  # higher = overrides lower


@dataclass
class AgentActionRequest:
    """An action an agent wants to take — must be approved by governance."""
    request_id: str = field(default_factory=lambda: str(uuid4()))
    agent_id: str = ""
    agent_type: str = ""  # rep_agent, msl_agent, content_agent, access_agent
    hcp_id: str = ""
    channel: str = ""
    action_type: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    approved: bool = False
    rejected_reason: str = ""


@dataclass
class GovernanceViolation:
    """A governance violation when an agent tries to do something not allowed."""
    violation_id: str = field(default_factory=lambda: str(uuid4()))
    request_id: str = ""
    rule_type: GovernanceRuleType = GovernanceRuleType.NO_DUPLICATE_TOUCH
    agent_id: str = ""
    hcp_id: str = ""
    reason: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AgentPopulationGovernance:
    """Agent Population Governance — prevents agents from colliding.

    When you have multiple agents (rep agents, MSL agents, content agents,
    access agents) all acting on the same HCP population, they can collide:
    - Two agents contact the same HCP on the same day
    - MSL and rep both contact HCP (violates medical/commercial separation)
    - Agent contacts HCP during cooling period
    - Multiple channels fire simultaneously

    This system intercepts every agent action request and checks it against
    governance rules before allowing execution.
    """

    def __init__(self):
        self.rules: dict[str, GovernanceRule] = {}
        self.action_log: dict[str, list[AgentActionRequest]] = {}  # hcp_id -> requests
        self.violations: list[GovernanceViolation] = []
        self._init_default_rules()

        # Optimistic concurrency control for agent file edits
        from rxreserve.agent_merge import MergeOrchestrator
        self.merge_orchestrator = MergeOrchestrator()

    def _init_default_rules(self):
        """Initialize default governance rules."""
        defaults = [
            (GovernanceRuleType.NO_DUPLICATE_TOUCH,
             "No two agents can touch the same HCP on the same day", 3),
            (GovernanceRuleType.CHANNEL_EXCLUSIVITY,
             "Only one channel per HCP per day", 2),
            (GovernanceRuleType.MEDICAL_COMMERCIAL_SEPARATION,
             "MSL and rep cannot both contact HCP within 24h", 4),
            (GovernanceRuleType.COOLDOWN_ENFORCEMENT,
             "Respect HCP fatigue cooling periods", 5),
            (GovernanceRuleType.PRIORITY_OVERRIDE,
             "Safety actions override all other rules", 10),
        ]
        for rtype, desc, pri in defaults:
            rule = GovernanceRule(rule_type=rtype, description=desc, priority=pri)
            self.rules[rule.rule_id] = rule

    def check_action(self, request: AgentActionRequest) -> tuple[bool, str]:
        """Check if an agent action is allowed by governance rules.

        Returns (approved, reason_if_rejected).
        """
        hcp_actions = self.action_log.get(request.hcp_id, [])
        today = request.timestamp[:10]

        # Rule: Safety overrides everything
        if request.action_type in ("route_to_safety", "safety_report"):
            return True, "Safety action — overrides all rules"

        # Rule: Cooldown enforcement
        # (Would check fatigue intelligence — simplified here)
        recent = [a for a in hcp_actions if a.timestamp[:10] == today and a.approved]

        # Rule: No duplicate touch
        if any(a.agent_id != request.agent_id for a in recent):
            # Check if it's a different agent type
            other_types = {a.agent_type for a in recent if a.agent_id != request.agent_id}
            if request.agent_type in other_types:
                violation = GovernanceViolation(
                    request_id=request.request_id,
                    rule_type=GovernanceRuleType.NO_DUPLICATE_TOUCH,
                    agent_id=request.agent_id, hcp_id=request.hcp_id,
                    reason=f"Duplicate touch: {request.agent_type} already contacted HCP today",
                )
                self.violations.append(violation)
                return False, violation.reason

        # Rule: Medical/commercial separation
        if request.agent_type == "msl_agent" and any(a.agent_type == "rep_agent" for a in recent):
            violation = GovernanceViolation(
                request_id=request.request_id,
                rule_type=GovernanceRuleType.MEDICAL_COMMERCIAL_SEPARATION,
                agent_id=request.agent_id, hcp_id=request.hcp_id,
                reason="MSL cannot contact within 24h of rep contact",
            )
            self.violations.append(violation)
            return False, violation.reason

        if request.agent_type == "rep_agent" and any(a.agent_type == "msl_agent" for a in recent):
            violation = GovernanceViolation(
                request_id=request.request_id,
                rule_type=GovernanceRuleType.MEDICAL_COMMERCIAL_SEPARATION,
                agent_id=request.agent_id, hcp_id=request.hcp_id,
                reason="Rep cannot contact within 24h of MSL contact",
            )
            self.violations.append(violation)
            return False, violation.reason

        # Rule: Channel exclusivity
        if any(a.channel == request.channel for a in recent):
            violation = GovernanceViolation(
                request_id=request.request_id,
                rule_type=GovernanceRuleType.CHANNEL_EXCLUSIVITY,
                agent_id=request.agent_id, hcp_id=request.hcp_id,
                reason=f"Channel {request.channel} already used today",
            )
            self.violations.append(violation)
            return False, violation.reason

        # All rules passed
        request.approved = True
        self.action_log.setdefault(request.hcp_id, []).append(request)
        return True, "Approved"

    def add_rule(self, rule_type: GovernanceRuleType, description: str,
                 priority: int = 1) -> GovernanceRule:
        """Add a custom governance rule."""
        rule = GovernanceRule(rule_type=rule_type, description=description, priority=priority)
        self.rules[rule.rule_id] = rule
        return rule

    def get_rules(self) -> list[dict]:
        return [{"rule_id": r.rule_id, "type": r.rule_type.value,
                 "description": r.description, "priority": r.priority,
                 "enabled": r.enabled} for r in sorted(self.rules.values(),
                 key=lambda x: -x.priority)]

    def get_hcp_actions(self, hcp_id: str) -> list[dict]:
        """Get all agent actions for an HCP."""
        return [{"request_id": a.request_id, "agent_id": a.agent_id,
                 "agent_type": a.agent_type, "channel": a.channel,
                 "action_type": a.action_type, "approved": a.approved,
                 "timestamp": a.timestamp} for a in self.action_log.get(hcp_id, [])]

    def summary(self) -> dict:
        return {
            "total_rules": len(self.rules),
            "enabled_rules": sum(1 for r in self.rules.values() if r.enabled),
            "total_actions_checked": sum(len(actions) for actions in self.action_log.values()),
            "total_approved": sum(sum(1 for a in actions if a.approved) for actions in self.action_log.values()),
            "total_violations": len(self.violations),
            "violation_types": {v.rule_type.value: sum(1 for x in self.violations if x.rule_type == v.rule_type)
                               for v in self.violations} if self.violations else {},
            "merge_orchestrator": self.merge_orchestrator.summary(),
        }

    # ─── Merge Protocol: Optimistic Concurrency Control ───

    def begin_file_edit(self, file_path: str, agent_id: str,
                        agent_type: str = "general") -> dict:
        """An agent begins editing a file.

        Records the current canonical revision as the agent's BASE.
        The agent must call propose_file_edit() with its changes,
        then commit_file_edit() if the merge is clean.
        """
        session = self.merge_orchestrator.begin_edit(file_path, agent_id, agent_type)
        return {
            "session_id": session.session_id,
            "file_path": session.file_path,
            "base_revision": session.base_revision,
            "status": session.status.value,
        }

    def propose_file_edit(self, session_id: str, proposed_content: str,
                          reasoning: str = "") -> dict:
        """An agent proposes a change. Runs three-way merge and constitution validation."""
        result = self.merge_orchestrator.propose(session_id, proposed_content, reasoning)
        return {
            "status": result.status.value,
            "merged_content": result.merged_content if result.status.value == "clean" else "",
            "conflicts": result.conflicts,
            "intervening_revisions": len(result.intervening_revisions),
            "reasoning": result.reasoning,
        }

    def commit_file_edit(self, session_id: str) -> dict:
        """Commit a proposed change after successful merge."""
        ok, msg, rev = self.merge_orchestrator.commit(session_id)
        return {
            "success": ok,
            "message": msg,
            "new_revision": rev.revision if rev else None,
        }

    def rebase_file_edit(self, session_id: str, new_proposed: str) -> dict:
        """Rebase a stale proposal after intervening changes."""
        result = self.merge_orchestrator.rebase_and_retry(session_id, new_proposed)
        return {
            "status": result.status.value,
            "merged_content": result.merged_content if result.status.value == "clean" else "",
            "reasoning": result.reasoning,
        }

    def abort_file_edit(self, session_id: str) -> bool:
        """Abort an edit session."""
        return self.merge_orchestrator.abort(session_id)

    def get_edit_session(self, session_id: str) -> Optional[dict]:
        """Get details of an edit session."""
        session = self.merge_orchestrator.get_session(session_id)
        if session is None:
            return None
        return {
            "session_id": session.session_id,
            "agent_id": session.agent_id,
            "agent_type": session.agent_type,
            "file_path": session.file_path,
            "base_revision": session.base_revision,
            "status": session.status.value,
            "merge_result": session.merge_result.status.value if session.merge_result else None,
            "constitution_violations": session.constitution_violations,
            "reasoning": session.reasoning,
        }

    def active_edit_sessions(self) -> list[dict]:
        """Get all active edit sessions."""
        return [
            {
                "session_id": s.session_id,
                "agent_id": s.agent_id,
                "agent_type": s.agent_type,
                "file_path": s.file_path,
                "base_revision": s.base_revision,
            }
            for s in self.merge_orchestrator.active_sessions()
        ]


# ═══════════════════════════════════════════════════════════════════════
# 12. ATTRIBUTION-TO-SETTLEMENT CLOSED LOOP — the core moat
# ═══════════════════════════════════════════════════════════════════════

class LoopStage(Enum):
    DETECT = "detect"           # signal detected (email, intent, obligation)
    PROPOSE = "propose"         # agent proposes an action
    EXECUTE = "execute"         # action executed
    MEASURE = "measure"         # outcome measured
    ATTRIBUTE = "attribute"     # value attributed to human + AI
    SETTLE = "settle"           # economic settlement to employee


@dataclass
class LoopEvent:
    """A single event in the attribution-to-settlement closed loop."""
    event_id: str = field(default_factory=lambda: str(uuid4()))
    loop_id: str = ""  # groups events in the same loop instance
    stage: LoopStage = LoopStage.DETECT
    hcp_id: str = ""
    rep_id: str = ""
    agent_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    data: dict[str, Any] = field(default_factory=dict)
    description: str = ""


@dataclass
class AttributionSettlement:
    """The final settlement for a closed loop — who gets credit."""
    settlement_id: str = field(default_factory=lambda: str(uuid4()))
    loop_id: str = ""
    hcp_id: str = ""
    rep_id: str = ""
    # Attribution
    human_contribution: float = 0.0  # 0-1
    ai_contribution: float = 0.0    # 0-1
    # Value
    verified_value: float = 0.0
    value_type: str = ""  # trust_improvement, access_resolution, safety_compliance, revenue
    # Settlement
    employee_credit: float = 0.0  # career capital
    economic_settlement: float = 0.0  # $ amount
    settled: bool = False
    settled_at: str = ""


class AttributionSettlementLoop:
    """Attribution-to-Settlement Closed Loop — the core moat.

    This is the system that no competitor has. The full loop:

    1. DETECT: MailOS detects a signal (email, intent, obligation)
    2. PROPOSE: Rep Agent proposes an action
    3. EXECUTE: Action is executed (via governance approval)
    4. MEASURE: Outcome is measured (HCP trust changed, access resolved, etc.)
    5. ATTRIBUTE: Value is attributed between human and AI
    6. SETTLE: Economic settlement flows to the employee

    The moat: once a pharma company adopts this attribution framework and
    employees accumulate career capital in the system, switching means
    losing the attribution history. That's the switching cost.
    """

    def __init__(self):
        self.loops: dict[str, list[LoopEvent]] = {}  # loop_id -> events
        self.settlements: dict[str, AttributionSettlement] = {}

    def start_loop(self, hcp_id: str, rep_id: str = "",
                   agent_id: str = "", description: str = "") -> str:
        """Start a new closed loop instance. Returns loop_id."""
        loop_id = str(uuid4())
        event = LoopEvent(
            loop_id=loop_id, stage=LoopStage.DETECT,
            hcp_id=hcp_id, rep_id=rep_id, agent_id=agent_id,
            description=description or "Signal detected",
        )
        self.loops[loop_id] = [event]
        return loop_id

    def add_event(self, loop_id: str, stage: LoopStage,
                  data: dict = None, description: str = "") -> LoopEvent:
        """Add an event to a loop."""
        if loop_id not in self.loops:
            raise KeyError(f"Loop {loop_id} not found")
        event = LoopEvent(
            loop_id=loop_id, stage=stage,
            data=data or {}, description=description,
        )
        self.loops[loop_id].append(event)
        return event

    def attribute(self, loop_id: str, human_contrib: float,
                  ai_contrib: float, verified_value: float,
                  value_type: str = "") -> AttributionSettlement:
        """Attribute value between human and AI."""
        total = human_contrib + ai_contrib
        if total > 0:
            human_frac = human_contrib / total
            ai_frac = ai_contrib / total
        else:
            human_frac = ai_frac = 0.5

        settlement = AttributionSettlement(
            loop_id=loop_id,
            human_contribution=round(human_frac, 3),
            ai_contribution=round(ai_frac, 3),
            verified_value=verified_value,
            value_type=value_type,
        )
        self.settlements[loop_id] = settlement
        self.add_event(loop_id, LoopStage.ATTRIBUTE, {
            "human_contribution": human_frac,
            "ai_contribution": ai_frac,
            "verified_value": verified_value,
        }, f"Attributed: {human_frac:.0%} human, {ai_frac:.0%} AI")
        return settlement

    def settle(self, loop_id: str, employee_credit: float,
               economic_settlement: float = 0.0) -> AttributionSettlement:
        """Settle the loop — flow economic value to the employee."""
        settlement = self.settlements.get(loop_id)
        if not settlement:
            raise KeyError(f"No attribution for loop {loop_id}")
        settlement.employee_credit = employee_credit
        settlement.economic_settlement = economic_settlement
        settlement.settled = True
        settlement.settled_at = datetime.now(timezone.utc).isoformat()
        self.add_event(loop_id, LoopStage.SETTLE, {
            "employee_credit": employee_credit,
            "economic_settlement": economic_settlement,
        }, f"Settled: {employee_credit} credit, ${economic_settlement:,.2f}")
        return settlement

    def get_loop(self, loop_id: str) -> dict:
        """Get the full loop trace."""
        events = self.loops.get(loop_id, [])
        settlement = self.settlements.get(loop_id)
        return {
            "loop_id": loop_id,
            "stages": [e.stage.value for e in events],
            "events": [{"stage": e.stage.value, "description": e.description,
                       "timestamp": e.timestamp, "data": e.data} for e in events],
            "settlement": settlement.__dict__ if settlement else None,
            "complete": settlement.settled if settlement else False,
        }

    def complete_loops(self) -> list[dict]:
        """Get all completed loops (detect → settle)."""
        return [self.get_loop(lid) for lid, s in self.settlements.items() if s.settled]

    def employee_career_capital(self, rep_id: str) -> dict:
        """Get career capital accumulated by an employee."""
        total_credit = 0.0
        total_economic = 0.0
        loops = []
        for lid, settlement in self.settlements.items():
            if not settlement.settled or settlement.rep_id != rep_id:
                continue
            total_credit += settlement.employee_credit
            total_economic += settlement.economic_settlement
            loops.append({
                "loop_id": lid,
                "value_type": settlement.value_type,
                "verified_value": settlement.verified_value,
                "human_contribution": settlement.human_contribution,
                "employee_credit": settlement.employee_credit,
            })
        return {
            "rep_id": rep_id,
            "total_loops": len(loops),
            "total_career_credit": round(total_credit, 2),
            "total_economic_settlement": round(total_economic, 2),
            "loops": loops,
        }

    def summary(self) -> dict:
        all_loops = list(self.loops.keys())
        settled = [s for s in self.settlements.values() if s.settled]
        return {
            "total_loops": len(all_loops),
            "settled": len(settled),
            "in_progress": len(all_loops) - len(settled),
            "total_verified_value": round(sum(s.verified_value for s in settled), 2),
            "total_economic_settlement": round(sum(s.economic_settlement for s in settled), 2),
            "avg_human_contribution": round(sum(s.human_contribution for s in settled) / max(len(settled), 1), 3),
            "avg_ai_contribution": round(sum(s.ai_contribution for s in settled) / max(len(settled), 1), 3),
        }


# ═══════════════════════════════════════════════════════════════════════
# 13. COMPETITIVE INTELLIGENCE AGENT — monitors competitor activity
# ═══════════════════════════════════════════════════════════════════════

class CompetitorSignalType(Enum):
    DRUG_APPROVAL = "drug_approval"
    LABEL_CHANGE = "label_change"
    CONGRESS_PRESENTATION = "congress_presentation"
    KOL_PUBLICATION = "kol_publication"
    CLINICAL_TRIAL_READOUT = "clinical_trial_readout"
    PRICING_CHANGE = "pricing_change"
    LAUNCH_ANNOUNCEMENT = "launch_announcement"
    MSL_HIRING = "msl_hiring"
    REP_EXPANSION = "rep_expansion"
    ACQUISITION = "acquisition"


class ThreatLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class CompetitorSignal:
    """A single competitive intelligence signal."""
    signal_id: str = field(default_factory=lambda: str(uuid4()))
    competitor: str = ""
    signal_type: CompetitorSignalType = CompetitorSignalType.KOL_PUBLICATION
    description: str = ""
    source: str = ""
    source_url: str = ""
    detected_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    threat_level: ThreatLevel = ThreatLevel.LOW
    affected_drugs: list[str] = field(default_factory=list)  # Gilead drugs affected
    affected_hcps: list[str] = field(default_factory=list)  # Gilead HCPs likely targeted
    recommended_actions: list[str] = field(default_factory=list)
    time_to_impact_days: int = 0  # estimated days until competitor action hits Gilead's HCPs
    acknowledged: bool = False
    acknowledged_by: str = ""
    acknowledged_at: str = ""


class CompetitiveIntelligenceAgent:
    """Competitive Intelligence Agent — monitors competitor activity.

    Continuously monitors competitor activity across:
    - FDA approvals and label changes (OpenFDA)
    - Congress presentations (ASCO, AASLD, IDWeek, CROI, ICAAC)
    - KOL publications (PubMed)
    - Clinical trial readouts (ClinicalTrials.gov)
    - Pricing changes (CMS, Medicaid)
    - MSL/rep expansion (LinkedIn job postings, press releases)
    - Acquisitions and partnerships (press releases)

    Correlates each signal with Gilead's engagement graph to predict
    which HCPs will be targeted by competitor reps and recommends
    proactive counter-engagement.

    This is pure Gilead moat — no vendor sells a competitor-aware
    HCP engagement optimizer.
    """

    # Gilead's primary competitors by therapeutic area
    COMPETITORS = {
        "HIV": ["ViiV Healthcare", "Merck"],
        "Oncology": ["BMS", "Merck", "Roche", "AstraZeneca", "Pfizer"],
        "Liver": ["AbbVie", "Merck"],
        "Inflammation": ["AbbVie", "Pfizer", "BMS", "J&J"],
    }

    # Congress calendar (approximate)
    CONGRESS_CALENDAR = {
        "ASCO": "June",
        "AASLD": "November",
        "IDWeek": "October",
        "CROI": "March",
        "ICAAC": "September",
        "EASL": "June",
        "ESMO": "October",
    }

    def __init__(self):
        self.signals: dict[str, CompetitorSignal] = {}
        self.hcp_engagement_graph: dict[str, set[str]] = {}  # hcp_id -> {drug_names}
        self.hcp_specialties: dict[str, str] = {}  # hcp_id -> specialty

    def register_hcp(self, hcp_id: str, specialty: str = "",
                     prescribed_drugs: list[str] = None) -> None:
        """Register an HCP in the CI agent's awareness."""
        self.hcp_specialties[hcp_id] = specialty
        if prescribed_drugs:
            self.hcp_engagement_graph.setdefault(hcp_id, set()).update(prescribed_drugs)

    def ingest_signal(self, competitor: str, signal_type: CompetitorSignalType,
                      description: str, source: str = "", source_url: str = "",
                      affected_drugs: list[str] = None) -> CompetitorSignal:
        """Ingest a competitive intelligence signal."""
        signal = CompetitorSignal(
            competitor=competitor,
            signal_type=signal_type,
            description=description,
            source=source,
            source_url=source_url,
            affected_drugs=affected_drugs or [],
        )
        # Assess threat level
        signal.threat_level = self._assess_threat(signal)
        # Predict affected HCPs
        signal.affected_hcps = self._predict_affected_hcps(signal)
        # Generate recommendations
        signal.recommended_actions = self._generate_recommendations(signal)
        # Estimate time to impact
        signal.time_to_impact_days = self._estimate_time_to_impact(signal)

        self.signals[signal.signal_id] = signal
        return signal

    def _assess_threat(self, signal: CompetitorSignal) -> ThreatLevel:
        """Assess the threat level of a competitive signal."""
        # Drug approval in same therapeutic area = critical
        if signal.signal_type == CompetitorSignalType.DRUG_APPROVAL:
            return ThreatLevel.CRITICAL
        # Label change (new indication) = high
        if signal.signal_type == CompetitorSignalType.LABEL_CHANGE:
            return ThreatLevel.HIGH
        # Clinical trial readout (positive Phase 3) = high
        if signal.signal_type == CompetitorSignalType.CLINICAL_TRIAL_READOUT:
            if "positive" in signal.description.lower() or "met primary" in signal.description.lower():
                return ThreatLevel.HIGH
            return ThreatLevel.MEDIUM
        # Congress presentation = medium
        if signal.signal_type == CompetitorSignalType.CONGRESS_PRESENTATION:
            return ThreatLevel.MEDIUM
        # KOL publication = medium
        if signal.signal_type == CompetitorSignalType.KOL_PUBLICATION:
            return ThreatLevel.MEDIUM
        # Rep expansion = high (they'll contact Gilead's HCPs)
        if signal.signal_type == CompetitorSignalType.REP_EXPANSION:
            return ThreatLevel.HIGH
        # Pricing change = medium
        if signal.signal_type == CompetitorSignalType.PRICING_CHANGE:
            return ThreatLevel.MEDIUM
        # MSL hiring = low-medium
        if signal.signal_type == CompetitorSignalType.MSL_HIRING:
            return ThreatLevel.LOW
        # Acquisition = high (could change competitive landscape)
        if signal.signal_type == CompetitorSignalType.ACQUISITION:
            return ThreatLevel.HIGH
        return ThreatLevel.LOW

    def _predict_affected_hcps(self, signal: CompetitorSignal) -> list[str]:
        """Predict which Gilead HCPs will be targeted by the competitor."""
        affected = []
        for hcp_id, drugs in self.hcp_engagement_graph.items():
            # If HCP prescribes a Gilead drug in the affected area
            if signal.affected_drugs:
                if any(d in drugs for d in signal.affected_drugs):
                    affected.append(hcp_id)
            else:
                # If no specific drugs, match by specialty
                specialty = self.hcp_specialties.get(hcp_id, "").lower()
                competitor = signal.competitor.lower()
                for ta, comps in self.COMPETITORS.items():
                    if competitor in [c.lower() for c in comps]:
                        if ta.lower() in specialty:
                            affected.append(hcp_id)
                            break
        return affected

    def _generate_recommendations(self, signal: CompetitorSignal) -> list[str]:
        """Generate recommended counter-engagement actions."""
        recs = []
        st = signal.signal_type

        if st == CompetitorSignalType.DRUG_APPROVAL:
            recs.append(f"Prepare objection handling for {signal.competitor}'s new approval")
            recs.append(f"Alert top 50 HCPs in affected therapeutic area with Gilead comparative data")
            recs.append("Route to MSL for scientific response preparation")
        elif st == CompetitorSignalType.LABEL_CHANGE:
            recs.append(f"Update rep talking points re: {signal.competitor} label expansion")
            recs.append("Identify HCPs who may switch based on new indication")
        elif st == CompetitorSignalType.CLINICAL_TRIAL_READOUT:
            recs.append("Prepare scientific analysis of competitor data vs Gilead data")
            recs.append("Route to MSL for medical-to-medical response")
            recs.append("Brief KOLs on Gilead's comparative advantages")
        elif st == CompetitorSignalType.CONGRESS_PRESENTATION:
            recs.append("Monitor congress coverage for competitor data presentations")
            recs.append("Prepare post-congress HCP outreach plan")
        elif st == CompetitorSignalType.REP_EXPANSION:
            recs.append("Fortify relationships with HCPs in competitor's new territories")
            recs.append("Increase touch frequency for at-risk HCPs")
            recs.append("Check trust trajectory for affected HCPs — intervene if declining")
        elif st == CompetitorSignalType.KOL_PUBLICATION:
            recs.append("Analyze KOL publication for mentions of Gilead products")
            recs.append("If KOL is in Gilead's network, schedule MSL follow-up")
        elif st == CompetitorSignalType.ACQUISITION:
            recs.append("Assess impact on competitive landscape")
            recs.append("Re-evaluate territory assignments if acquired company overlaps")

        if signal.affected_hcps:
            recs.append(f"Proactively contact {len(signal.affected_hcps)} at-risk HCPs within {signal.time_to_impact_days} days")

        return recs

    def _estimate_time_to_impact(self, signal: CompetitorSignal) -> int:
        """Estimate days until competitor action affects Gilead's HCPs."""
        estimates = {
            CompetitorSignalType.DRUG_APPROVAL: 14,      # reps will detail within 2 weeks
            CompetitorSignalType.LABEL_CHANGE: 21,       # label update → rep detailing
            CompetitorSignalType.CONGRESS_PRESENTATION: 7,  # immediate post-congress outreach
            CompetitorSignalType.KOL_PUBLICATION: 14,    # KOL influence spreads in ~2 weeks
            CompetitorSignalType.CLINICAL_TRIAL_READOUT: 7,  # press release → immediate
            CompetitorSignalType.PRICING_CHANGE: 30,     # formulary changes take time
            CompetitorSignalType.LAUNCH_ANNOUNCEMENT: 30,
            CompetitorSignalType.MSL_HIRING: 60,         # new MSLs take time to ramp
            CompetitorSignalType.REP_EXPANSION: 14,      # new reps start detailing quickly
            CompetitorSignalType.ACQUISITION: 90,        # integration takes time
        }
        return estimates.get(signal.signal_type, 30)

    def acknowledge(self, signal_id: str, acknowledged_by: str = "") -> Optional[CompetitorSignal]:
        """Acknowledge a competitive signal."""
        signal = self.signals.get(signal_id)
        if not signal:
            return None
        signal.acknowledged = True
        signal.acknowledged_by = acknowledged_by
        signal.acknowledged_at = datetime.now(timezone.utc).isoformat()
        return signal

    def get_signals(self, competitor: str = "", threat_level: str = "",
                    signal_type: str = "", unacknowledged_only: bool = False) -> list[CompetitorSignal]:
        """Filter signals by criteria."""
        signals = list(self.signals.values())
        if competitor:
            signals = [s for s in signals if s.competitor.lower() == competitor.lower()]
        if threat_level:
            signals = [s for s in signals if s.threat_level.value == threat_level]
        if signal_type:
            signals = [s for s in signals if s.signal_type.value == signal_type]
        if unacknowledged_only:
            signals = [s for s in signals if not s.acknowledged]
        return sorted(signals, key=lambda x: x.detected_at, reverse=True)

    def get_critical_threats(self) -> list[CompetitorSignal]:
        """Get all critical and high threat signals."""
        return [s for s in self.signals.values()
                if s.threat_level in (ThreatLevel.CRITICAL, ThreatLevel.HIGH)
                and not s.acknowledged]

    def competitor_summary(self, competitor: str) -> dict:
        """Summary of all signals for a specific competitor."""
        signals = [s for s in self.signals.values() if s.competitor == competitor]
        if not signals:
            return {"competitor": competitor, "total_signals": 0}
        return {
            "competitor": competitor,
            "total_signals": len(signals),
            "critical": sum(1 for s in signals if s.threat_level == ThreatLevel.CRITICAL),
            "high": sum(1 for s in signals if s.threat_level == ThreatLevel.HIGH),
            "medium": sum(1 for s in signals if s.threat_level == ThreatLevel.MEDIUM),
            "low": sum(1 for s in signals if s.threat_level == ThreatLevel.LOW),
            "unacknowledged": sum(1 for s in signals if not s.acknowledged),
            "affected_hcps_total": len(set(h for s in signals for h in s.affected_hcps)),
            "signal_types": {st.value: sum(1 for s in signals if s.signal_type == st)
                            for st in CompetitorSignalType if any(s.signal_type == st for s in signals)},
        }

    def hcp_threat_exposure(self, hcp_id: str) -> dict:
        """Get competitive threat exposure for a specific HCP."""
        signals = [s for s in self.signals.values() if hcp_id in s.affected_hcps]
        return {
            "hcp_id": hcp_id,
            "total_threats": len(signals),
            "critical": sum(1 for s in signals if s.threat_level == ThreatLevel.CRITICAL),
            "high": sum(1 for s in signals if s.threat_level == ThreatLevel.HIGH),
            "competitors_targeting": list(set(s.competitor for s in signals)),
            "nearest_impact_days": min((s.time_to_impact_days for s in signals), default=0),
            "signals": [{"signal_id": s.signal_id, "competitor": s.competitor,
                        "type": s.signal_type.value, "threat": s.threat_level.value,
                        "description": s.description[:100]} for s in signals],
        }

    def summary(self) -> dict:
        signals = list(self.signals.values())
        if not signals:
            return {"total_signals": 0, "competitors_tracked": 0}
        return {
            "total_signals": len(signals),
            "acknowledged": sum(1 for s in signals if s.acknowledged),
            "unacknowledged": sum(1 for s in signals if not s.acknowledged),
            "critical": sum(1 for s in signals if s.threat_level == ThreatLevel.CRITICAL),
            "high": sum(1 for s in signals if s.threat_level == ThreatLevel.HIGH),
            "medium": sum(1 for s in signals if s.threat_level == ThreatLevel.MEDIUM),
            "low": sum(1 for s in signals if s.threat_level == ThreatLevel.LOW),
            "competitors_tracked": len(set(s.competitor for s in signals)),
            "total_affected_hcps": len(set(h for s in signals for h in s.affected_hcps)),
            "avg_time_to_impact": round(sum(s.time_to_impact_days for s in signals) / len(signals), 1),
        }


# ═══════════════════════════════════════════════════════════════════════
# 14. LAUNCH READINESS ANALYZER — evaluate engagement strategies against real HCP data
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class SimulationStrategy:
    """A single engagement strategy to analyze."""
    strategy_id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    description: str = ""
    # Strategy parameters
    target_hcp_count: int = 100
    channel_mix: dict[str, float] = field(default_factory=dict)  # channel -> proportion
    touch_frequency_per_month: int = 2
    content_type: str = "clinical"  # clinical, promotional, mixed
    msl_involvement: float = 0.3  # proportion of touches involving MSL
    territory_optimization: bool = False
    fatigue_awareness: bool = True
    trust_threshold: float = 0.5  # only target HCPs above this trust


@dataclass
class StrategyAnalysisResult:
    """Result of analyzing a strategy against real HCP data."""
    result_id: str = field(default_factory=lambda: str(uuid4()))
    strategy_id: str = ""
    # Projected outcomes from real data
    projected_nps: float = 0.0
    projected_rx_lift: float = 0.0  # % Rx lift
    projected_access_rate: float = 0.0  # % of HCPs accessible
    projected_fatigue_rate: float = 0.0  # % of HCPs at fatigue risk
    projected_trust_change: float = 0.0  # avg trust delta
    projected_cost_per_call: float = 0.0
    projected_total_cost: float = 0.0
    projected_roi: float = 0.0
    # Breakdown
    hcp_reached: int = 0
    hcp_engaged: int = 0
    hcp_fatigued: int = 0
    hcp_disengaged: int = 0
    # Scoring
    composite_score: float = 0.0  # weighted score for ranking
    rank: int = 0
    # Metadata
    analyzed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    analysis_notes: str = ""
    data_source: str = ""  # "database" or "manual"


class LaunchReadinessAnalyzer:
    """Launch Readiness Analyzer — evaluate engagement strategies against real HCP data.

    Uses real HCP opportunity objects from the database + actual interaction
    history + trust trajectory model to project strategy outcomes before
    deployment.

    Analyze engagement strategies against real HCP data.
    Pick the strategy with best projected NPS + Rx lift. Deploy to real HCPs.

    The analysis harness uses real HCP relationship history, actual channel
    preferences, real interaction frequency, and actual trust signals.
    """

    # Weights for composite score
    SCORE_WEIGHTS = {
        "nps": 0.30,
        "rx_lift": 0.30,
        "access_rate": 0.15,
        "fatigue_penalty": 0.10,
        "trust_change": 0.10,
        "roi": 0.05,
    }

    def __init__(self, database=None):
        self.strategies: dict[str, SimulationStrategy] = {}
        self.results: dict[str, list[StrategyAnalysisResult]] = {}  # strategy_id -> results
        self.best_strategies: dict[str, StrategyAnalysisResult] = {}  # scenario -> best result
        self.database = database
        self.hcp_panel: list[dict] = []  # real HCP data
        self.trust_baseline: dict[str, float] = {}  # hcp_id -> baseline trust from real data
        self.interaction_history: dict[str, list[dict]] = {}  # hcp_id -> interactions

    def load_from_database(self, territory: str = "") -> int:
        """Load real HCP data from the database."""
        if not self.database:
            raise ValueError("No database connected")

        hcps = self.database.get_all_hcps()
        if territory:
            hcps = [h for h in hcps if h.territory == territory]

        self.hcp_panel = []
        for hcp in hcps:
            interactions = self.database.get_interactions_for_hcp(hcp.hcp_id)
            self.interaction_history[hcp.hcp_id] = interactions

            # Compute trust baseline from real interaction outcomes
            trust = self._compute_trust_from_history(hcp, interactions)
            self.trust_baseline[hcp.hcp_id] = trust

            self.hcp_panel.append({
                "hcp_id": hcp.hcp_id,
                "name": hcp.name,
                "specialty": hcp.specialty,
                "territory": hcp.territory,
                "preferred_channel": hcp.preferred_channel.value if hcp.preferred_channel else "in_person",
                "journey_state": hcp.journey_state.value,
                "engagement_score": hcp.engagement_score,
                "conversion_probability": hcp.conversion_probability,
                "addressable_value": hcp.addressable_value,
                "patient_panel_size": hcp.patient_panel_size,
                "kol_status": hcp.kol_status,
                "interaction_count": len(interactions),
                "baseline_trust": trust,
            })

        return len(self.hcp_panel)

    def load_hcp_panel(self, hcps: list[dict]) -> int:
        """Load HCP data directly (for testing or manual data)."""
        self.hcp_panel = hcps
        for hcp in hcps:
            hcp_id = hcp.get("hcp_id", "")
            self.trust_baseline[hcp_id] = hcp.get("baseline_trust", 0.5)
        return len(self.hcp_panel)

    def _compute_trust_from_history(self, hcp, interactions: list[dict]) -> float:
        """Compute trust baseline from real interaction outcomes."""
        if not interactions:
            return 0.5

        positive_outcomes = 0
        negative_outcomes = 0
        for interaction in interactions:
            outcome = interaction.get("outcome", "").lower()
            if any(word in outcome for word in ("positive", "engaged", "agreed", "interested", "scheduled")):
                positive_outcomes += 1
            elif any(word in outcome for word in ("negative", "declined", "objection", "no interest", "do not contact")):
                negative_outcomes += 1

        total = len(interactions)
        trust = 0.5 + (positive_outcomes - negative_outcomes) / max(total * 2, 1)
        return max(0.0, min(1.0, trust))

    def create_strategy(self, name: str, **params) -> SimulationStrategy:
        """Create an engagement strategy."""
        strategy = SimulationStrategy(name=name, **params)
        self.strategies[strategy.strategy_id] = strategy
        return strategy

    def analyze_strategy(self, strategy_id: str, scenario: str = "default") -> StrategyAnalysisResult:
        """Analyze a single strategy against real HCP data."""
        strategy = self.strategies.get(strategy_id)
        if not strategy:
            raise KeyError(f"Strategy {strategy_id} not found")
        if not self.hcp_panel:
            raise ValueError("No HCP panel loaded — call load_from_database() or load_hcp_panel() first")

        nps_scores = []
        rx_lifts = []
        access_count = 0
        fatigue_count = 0
        disengage_count = 0
        trust_deltas = []
        costs = []

        for hcp in self.hcp_panel:
            hcp_id = hcp.get("hcp_id", "")
            baseline_trust = self.trust_baseline.get(hcp_id, 0.5)
            access_pref = hcp.get("preferred_channel", "in_person")
            conversion_prob = hcp.get("conversion_probability", 0.0)
            addressable_value = hcp.get("addressable_value", 0.0)
            interaction_count = hcp.get("interaction_count", 0)

            # Filter by trust threshold
            if baseline_trust < strategy.trust_threshold:
                continue

            # Channel effectiveness from real preferred channel
            channel_effectiveness = self._compute_channel_effectiveness(
                strategy.channel_mix, access_pref, baseline_trust)

            # Touch frequency: compute fatigue from real interaction history
            if strategy.fatigue_awareness:
                effective_frequency = min(strategy.touch_frequency_per_month, 3)
            else:
                effective_frequency = strategy.touch_frequency_per_month

            # Fatigue from real interaction count — HCPs with more recent touches fatigue faster
            fatigue_sensitivity = min(1.0, interaction_count / 20.0)  # 20+ interactions = max sensitivity
            fatigue_threshold = 8 / max(fatigue_sensitivity, 0.1)
            if effective_frequency > fatigue_threshold / 4:
                fatigue_count += 1
                trust_delta = -0.05 * fatigue_sensitivity
            else:
                trust_delta = 0.02 * channel_effectiveness

            # MSL involvement boosts trust for clinical content
            if strategy.content_type == "clinical" and strategy.msl_involvement > 0.3:
                trust_delta += 0.03 * strategy.msl_involvement

            trust_deltas.append(trust_delta)

            # Access projection from real trust + channel fit
            if channel_effectiveness > 0.5 and baseline_trust > 0.4:
                access_count += 1

            # Disengagement
            if trust_delta < -0.1:
                disengage_count += 1

            # NPS from trust change + channel fit + fatigue sensitivity
            nps = (trust_delta * 100) + (channel_effectiveness * 20) - (fatigue_sensitivity * 10)
            nps_scores.append(nps)

            # Rx lift from real conversion probability and addressable value
            rx_lift = trust_delta * conversion_prob * 100
            rx_lifts.append(rx_lift)

            # Cost from real channel mix
            touch_cost = self._calculate_touch_cost(strategy.channel_mix, effective_frequency)
            costs.append(touch_cost)

        # Aggregate results
        total_hcps = len(self.hcp_panel)
        reached = len(trust_deltas)
        avg_nps = sum(nps_scores) / max(len(nps_scores), 1)
        avg_rx_lift = sum(rx_lifts) / max(len(rx_lifts), 1)
        avg_trust_change = sum(trust_deltas) / max(len(trust_deltas), 1)
        avg_cost = sum(costs) / max(len(costs), 1)
        total_cost = sum(costs)
        access_rate = access_count / max(reached, 1)
        fatigue_rate = fatigue_count / max(reached, 1)

        # ROI from real addressable value
        total_addressable_value = sum(h.get("addressable_value", 0) for h in self.hcp_panel)
        revenue = avg_rx_lift / 100 * total_addressable_value / max(total_hcps, 1) * reached
        roi = (revenue - total_cost) / max(total_cost, 1)

        # Composite score
        composite = (
            self.SCORE_WEIGHTS["nps"] * (avg_nps + 100) / 200 +
            self.SCORE_WEIGHTS["rx_lift"] * min(avg_rx_lift / 20, 1) +
            self.SCORE_WEIGHTS["access_rate"] * access_rate +
            self.SCORE_WEIGHTS["fatigue_penalty"] * (1 - fatigue_rate) +
            self.SCORE_WEIGHTS["trust_change"] * min(max(avg_trust_change, 0), 1) +
            self.SCORE_WEIGHTS["roi"] * min(max(roi, 0), 1)
        )

        result = StrategyAnalysisResult(
            strategy_id=strategy_id,
            projected_nps=round(avg_nps, 1),
            projected_rx_lift=round(avg_rx_lift, 2),
            projected_access_rate=round(access_rate, 3),
            projected_fatigue_rate=round(fatigue_rate, 3),
            projected_trust_change=round(avg_trust_change, 4),
            projected_cost_per_call=round(avg_cost, 2),
            projected_total_cost=round(total_cost, 2),
            projected_roi=round(roi, 2),
            hcp_reached=reached,
            hcp_engaged=reached - disengage_count,
            hcp_fatigued=fatigue_count,
            hcp_disengaged=disengage_count,
            composite_score=round(composite, 4),
            analysis_notes=f"Scenario: {scenario}, Panel size: {total_hcps}, Real HCP data",
            data_source="database" if self.database else "manual",
        )

        self.results.setdefault(strategy_id, []).append(result)
        self.best_strategies[scenario] = result
        return result

    def _compute_channel_effectiveness(self, channel_mix: dict,
                                       access_pref: str, trust: float) -> float:
        """Compute channel effectiveness from real HCP preferred channel."""
        if not channel_mix:
            return 0.5
        effectiveness = 0.0
        for channel, proportion in channel_mix.items():
            if channel == access_pref:
                effectiveness += proportion * (0.7 + trust * 0.3)
            elif channel in ("approved_email", "email"):
                effectiveness += proportion * 0.4
            elif channel == "virtual":
                effectiveness += proportion * 0.5
            elif channel == "phone":
                effectiveness += proportion * 0.45
            else:
                effectiveness += proportion * 0.3
        return min(effectiveness, 1.0)

    def _calculate_touch_cost(self, channel_mix: dict, frequency: int) -> float:
        """Calculate the cost of touches for a single HCP per month."""
        costs = {
            "in_person": 200, "virtual": 75, "phone": 30,
            "approved_email": 3, "email": 3, "sms": 0.25,
        }
        if not channel_mix:
            return 200 * frequency
        avg_cost_per_touch = sum(costs.get(ch, 100) * prop for ch, prop in channel_mix.items())
        return avg_cost_per_touch * frequency

    def batch_analyze(self, strategies: list[SimulationStrategy],
                      scenario: str = "default") -> list[StrategyAnalysisResult]:
        """Analyze multiple strategies and rank them."""
        results = []
        for strategy in strategies:
            self.strategies[strategy.strategy_id] = strategy
            result = self.analyze_strategy(strategy.strategy_id, scenario)
            results.append(result)

        # Rank by composite score
        results.sort(key=lambda x: -x.composite_score)
        for i, r in enumerate(results):
            r.rank = i + 1

        # Store best
        if results:
            self.best_strategies[scenario] = results[0]

        return results

    def auto_generate_strategies(self, count: int = 100) -> list[SimulationStrategy]:
        """Auto-generate strategy variations for batch analysis."""
        import random
        strategies = []
        channel_options = [
            {"in_person": 0.6, "virtual": 0.2, "approved_email": 0.2},
            {"in_person": 0.3, "virtual": 0.4, "approved_email": 0.3},
            {"in_person": 0.2, "virtual": 0.3, "phone": 0.2, "approved_email": 0.3},
            {"virtual": 0.5, "approved_email": 0.5},
            {"in_person": 0.4, "virtual": 0.3, "phone": 0.3},
        ]
        content_types = ["clinical", "promotional", "mixed"]

        for i in range(count):
            strategy = SimulationStrategy(
                name=f"Auto-strategy-{i+1}",
                description=f"Auto-generated variation {i+1}",
                target_hcp_count=random.choice([50, 100, 200, 500]),
                channel_mix=random.choice(channel_options),
                touch_frequency_per_month=random.choice([1, 2, 3, 4]),
                content_type=random.choice(content_types),
                msl_involvement=round(random.uniform(0.1, 0.6), 2),
                territory_optimization=random.choice([True, False]),
                fatigue_awareness=random.choice([True, False]),
                trust_threshold=round(random.uniform(0.3, 0.7), 2),
            )
            strategies.append(strategy)
            self.strategies[strategy.strategy_id] = strategy
        return strategies

    def get_best_strategy(self, scenario: str = "default") -> Optional[StrategyAnalysisResult]:
        """Get the best strategy for a scenario."""
        return self.best_strategies.get(scenario)

    def get_results(self, strategy_id: str = "") -> list[StrategyAnalysisResult]:
        """Get analysis results."""
        if strategy_id:
            return self.results.get(strategy_id, [])
        all_results = []
        for results in self.results.values():
            all_results.extend(results)
        return sorted(all_results, key=lambda x: -x.composite_score)

    def summary(self) -> dict:
        all_results = self.get_results()
        if not all_results:
            return {"total_analyses": 0}
        return {
            "total_strategies": len(self.strategies),
            "total_analyses": len(all_results),
            "best_composite_score": max(r.composite_score for r in all_results),
            "best_nps": max(r.projected_nps for r in all_results),
            "best_rx_lift": max(r.projected_rx_lift for r in all_results),
            "avg_nps": round(sum(r.projected_nps for r in all_results) / len(all_results), 1),
            "avg_rx_lift": round(sum(r.projected_rx_lift for r in all_results) / len(all_results), 2),
            "avg_fatigue_rate": round(sum(r.projected_fatigue_rate for r in all_results) / len(all_results), 3),
            "hcp_panel_size": len(self.hcp_panel),
            "data_source": "database" if self.database else "manual",
            "scenarios_run": len(self.best_strategies),
        }


# ═══════════════════════════════════════════════════════════════════════
# 15. MEASUREMENT FRAMEWORK + ROI ENGINE — Gilead's 4 KPIs, real-time
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class KPIMeasurement:
    """A single KPI measurement at a point in time."""
    measurement_id: str = field(default_factory=lambda: str(uuid4()))
    kpi_name: str = ""
    value: float = 0.0
    unit: str = ""
    target: float = 0.0
    baseline: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    trend: str = ""  # improving, declining, stable
    notes: str = ""


@dataclass
class ROIReport:
    """An ROI report for a specific system or initiative."""
    report_id: str = field(default_factory=lambda: str(uuid4()))
    system_name: str = ""
    period: str = ""  # e.g., "Q1 2026"
    # Costs
    implementation_cost: float = 0.0
    operating_cost: float = 0.0
    total_cost: float = 0.0
    # Benefits
    labor_savings: float = 0.0
    cost_per_call_reduction: float = 0.0
    revenue_uplift: float = 0.0
    compliance_savings: float = 0.0
    total_benefits: float = 0.0
    # ROI
    net_benefit: float = 0.0
    roi_percentage: float = 0.0
    payback_months: float = 0.0
    # Metadata
    generated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MeasurementFramework:
    """Measurement Framework + ROI Engine — Gilead's 4 KPIs, real-time.

    ZS found most pharma can't measure AI ROI. Gilead's measurement
    framework IS a competitive advantage — you can't improve what you
    can't measure.

    Gilead's 4 KPIs:
    1. Labor per employee (hours saved per rep/MSL per week)
    2. Defragmentation completeness (% of data in Vault vs. spreadsheets)
    3. Cost per call/visit (dollars per effective HCP touch)
    4. Doctor cooperation quality (NPS + trust trajectory)

    This system measures all 4 continuously and generates ROI reports
    for each proprietary system.
    """

    # Gilead's 4 KPIs
    KPIS = {
        "labor_per_employee": {
            "name": "Labor per Employee",
            "unit": "hours/week",
            "target": 8.0,  # target: 8 hours saved per week per employee
            "baseline": 0.0,
        },
        "defragmentation_completeness": {
            "name": "Defragmentation Completeness",
            "unit": "%",
            "target": 90.0,  # target: 90% of data in Vault
            "baseline": 20.0,  # starting point: ~20% in Vault
        },
        "cost_per_call": {
            "name": "Cost per Call/Visit",
            "unit": "$/call",
            "target": 100.0,  # target: halved from ~$200 to ~$100
            "baseline": 200.0,
        },
        "doctor_cooperation_quality": {
            "name": "Doctor Cooperation Quality",
            "unit": "NPS",
            "target": 20.0,  # target: +20 NPS (from -10 baseline)
            "baseline": -10.0,
        },
    }

    def __init__(self):
        self.measurements: dict[str, list[KPIMeasurement]] = {}  # kpi_name -> history
        self.roi_reports: dict[str, ROIReport] = {}
        self.system_costs: dict[str, dict] = {}  # system_name -> {implementation, operating}
        self.employee_count: int = 1000  # default

    def record_measurement(self, kpi_name: str, value: float,
                           notes: str = "") -> KPIMeasurement:
        """Record a KPI measurement."""
        if kpi_name not in self.KPIS:
            raise ValueError(f"Unknown KPI: {kpi_name}")

        kpi_config = self.KPIS[kpi_name]
        history = self.measurements.get(kpi_name, [])

        # Determine trend
        trend = "stable"
        if history:
            last_value = history[-1].value
            if kpi_name == "cost_per_call":
                # Lower is better
                if value < last_value:
                    trend = "improving"
                elif value > last_value:
                    trend = "declining"
            else:
                # Higher is better (except cost_per_call)
                if value > last_value:
                    trend = "improving"
                elif value < last_value:
                    trend = "declining"

        measurement = KPIMeasurement(
            kpi_name=kpi_name,
            value=value,
            unit=kpi_config["unit"],
            target=kpi_config["target"],
            baseline=kpi_config["baseline"],
            trend=trend,
            notes=notes,
        )
        self.measurements.setdefault(kpi_name, []).append(measurement)
        return measurement

    def get_kpi_history(self, kpi_name: str, limit: int = 30) -> list[KPIMeasurement]:
        """Get the history of a KPI."""
        history = self.measurements.get(kpi_name, [])
        return history[-limit:]

    def get_kpi_current(self, kpi_name: str) -> Optional[KPIMeasurement]:
        """Get the most recent measurement for a KPI."""
        history = self.measurements.get(kpi_name, [])
        return history[-1] if history else None

    def get_all_kpis(self) -> list[dict]:
        """Get current status of all 4 KPIs."""
        results = []
        for kpi_name, config in self.KPIS.items():
            current = self.get_kpi_current(kpi_name)
            history = self.measurements.get(kpi_name, [])

            # Calculate progress toward target
            if current:
                if kpi_name == "cost_per_call":
                    # Lower is better: progress = (baseline - current) / (baseline - target)
                    progress = (config["baseline"] - current.value) / max(config["baseline"] - config["target"], 1)
                else:
                    # Higher is better: progress = (current - baseline) / (target - baseline)
                    progress = (current.value - config["baseline"]) / max(config["target"] - config["baseline"], 1)
                progress = max(0, min(1, progress))
            else:
                progress = 0.0

            results.append({
                "kpi_name": kpi_name,
                "display_name": config["name"],
                "unit": config["unit"],
                "current_value": current.value if current else None,
                "target": config["target"],
                "baseline": config["baseline"],
                "trend": current.trend if current else "no_data",
                "progress": round(progress, 3),
                "measurements_count": len(history),
                "on_track": progress >= 0.5 if current else False,
            })
        return results

    def set_system_cost(self, system_name: str, implementation_cost: float,
                        operating_cost_monthly: float) -> None:
        """Set the cost for a system."""
        self.system_costs[system_name] = {
            "implementation": implementation_cost,
            "operating_monthly": operating_cost_monthly,
        }

    def generate_roi_report(self, system_name: str, period: str = "",
                            months_operating: int = 12) -> ROIReport:
        """Generate an ROI report for a specific system."""
        costs = self.system_costs.get(system_name, {})
        impl_cost = costs.get("implementation", 0)
        op_cost = costs.get("operating_monthly", 0) * months_operating
        total_cost = impl_cost + op_cost

        # Compute benefits from actual KPI measurements
        labor_savings = self._estimate_labor_savings(system_name, months_operating)
        cpc_reduction = self._estimate_cpc_reduction(system_name, months_operating)
        revenue_uplift = self._estimate_revenue_uplift(system_name, months_operating)
        compliance_savings = self._estimate_compliance_savings(system_name, months_operating)
        total_benefits = labor_savings + cpc_reduction + revenue_uplift + compliance_savings

        net_benefit = total_benefits - total_cost
        roi_pct = (net_benefit / max(total_cost, 1)) * 100
        payback = (impl_cost / max(total_benefits / months_operating, 1)) if total_benefits > 0 else 0

        report = ROIReport(
            system_name=system_name,
            period=period,
            implementation_cost=impl_cost,
            operating_cost=op_cost,
            total_cost=total_cost,
            labor_savings=labor_savings,
            cost_per_call_reduction=cpc_reduction,
            revenue_uplift=revenue_uplift,
            compliance_savings=compliance_savings,
            total_benefits=total_benefits,
            net_benefit=net_benefit,
            roi_percentage=round(roi_pct, 1),
            payback_months=round(payback, 1),
        )
        self.roi_reports[report.report_id] = report
        return report

    def _estimate_labor_savings(self, system_name: str, months: int) -> float:
        """Compute labor savings from actual KPI measurements."""
        labor_history = self.measurements.get("labor_per_employee", [])
        if not labor_history:
            return 0.0
        # Use most recent measurement as current hours saved per week per employee
        latest = labor_history[-1]
        hours_saved_per_week = max(0, latest.value - latest.baseline)
        hourly_cost = 75  # fully loaded rep cost
        return hours_saved_per_week * hourly_cost * 4 * months * self.employee_count

    def _estimate_cpc_reduction(self, system_name: str, months: int) -> float:
        """Compute cost-per-call reduction from actual KPI measurements."""
        cpc_history = self.measurements.get("cost_per_call", [])
        if not cpc_history:
            return 0.0
        latest = cpc_history[-1]
        baseline = self.KPIS["cost_per_call"]["baseline"]
        current_cpc = latest.value
        cpc_reduction = max(0, baseline - current_cpc)
        # Estimate total calls from employee count (avg 20 calls/rep/month)
        calls_per_month = self.employee_count * 20
        return cpc_reduction * calls_per_month * months

    def _estimate_revenue_uplift(self, system_name: str, months: int) -> float:
        """Compute revenue uplift from actual doctor cooperation KPI measurements."""
        nps_history = self.measurements.get("doctor_cooperation_quality", [])
        if not nps_history:
            return 0.0
        latest = nps_history[-1]
        baseline = self.KPIS["doctor_cooperation_quality"]["baseline"]
        nps_improvement = max(0, latest.value - baseline)
        # Revenue uplift: each NPS point improvement → $5000/employee/year
        return nps_improvement * 5000 * self.employee_count * months / 12

    def _estimate_compliance_savings(self, system_name: str, months: int) -> float:
        """Compute compliance savings from actual defragmentation KPI measurements."""
        defrag_history = self.measurements.get("defragmentation_completeness", [])
        if not defrag_history:
            return 0.0
        latest = defrag_history[-1]
        baseline = self.KPIS["defragmentation_completeness"]["baseline"]
        completeness_improvement = max(0, latest.value - baseline) / 100.0  # fraction
        # Compliance savings scale with data completeness improvement
        # Base: $20000/month at 100% improvement, scaled by actual improvement
        return completeness_improvement * 20000 * months

    def get_dashboard(self) -> dict:
        """Get the full measurement dashboard."""
        kpis = self.get_all_kpis()
        total_investment = sum(c.get("implementation", 0) for c in self.system_costs.values())
        total_monthly_op = sum(c.get("operating_monthly", 0) for c in self.system_costs.values())

        # Overall progress
        avg_progress = sum(k["progress"] for k in kpis) / max(len(kpis), 1)

        return {
            "kpis": kpis,
            "overall_progress": round(avg_progress, 3),
            "total_systems_measured": len(self.system_costs),
            "total_investment": total_investment,
            "total_monthly_operating_cost": total_monthly_op,
            "roi_reports_generated": len(self.roi_reports),
            "employee_count": self.employee_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_roi_reports(self) -> list[dict]:
        """Get all ROI reports."""
        return [r.__dict__ for r in self.roi_reports.values()]

    def summary(self) -> dict:
        return {
            "total_kpis": len(self.KPIS),
            "total_measurements": sum(len(h) for h in self.measurements.values()),
            "total_roi_reports": len(self.roi_reports),
            "systems_tracked": len(self.system_costs),
            "kpis_on_track": sum(1 for k in self.get_all_kpis() if k["on_track"]),
        }

