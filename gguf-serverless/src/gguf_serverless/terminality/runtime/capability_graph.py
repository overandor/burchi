"""
Capability Graph — portable authority.

Every node knows what it IS ALLOWED to execute,
not merely what it CAN execute.

Authority becomes portable separately from state.

  State says: "the file is here, the process is running"
  Capability says: "this node is permitted to write to /etc,
                    execute shell commands, and call external APIs"

Capabilities are:
  - Content-addressed (a capability has an identity)
  - Delegatable (a node can grant sub-capabilities)
  - Revocable (capabilities can be withdrawn)
  - Verifiable (any node can check any other's capabilities)
  - Portable (capabilities travel with the execution object)

This separation matters for the computation market:
  - A peer can only continue computation it has capabilities for
  - Capabilities determine what actions the deterministic layer allows
  - The C++ runtime enforces capabilities, not the LLM
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_graph_v2 import GraphNode, NodeKind, ExecutionGraphV2


class CapabilityLevel(Enum):
    """Hierarchy of capability levels."""
    ROOT = "root"             # unrestricted (dangerous, rare)
    ADMIN = "admin"           # system-level operations
    EXECUTE = "execute"       # run commands, start processes
    WRITE = "write"           # modify files
    READ = "read"             # read files, query state
    INFERENCE = "inference"   # call LLM models
    NETWORK = "network"       # make network requests
    DELEGATE = "delegate"     # grant capabilities to others
    OBSERVE = "observe"       # view execution graph, no mutations


@dataclass
class Capability:
    """A capability grant — what a node is allowed to do.

    Content-addressed: the capability itself has an identity.
    Portable: travels with execution objects, not tied to a machine.
    Delegatable: holder can grant sub-capabilities (if they have DELEGATE).
    Revocable: issuer can revoke at any time.
    """
    capability_id: str
    issuer: str                    # who granted this capability
    holder: str                    # who holds this capability (node/peer ID)
    level: CapabilityLevel
    scope: dict[str, Any] = field(default_factory=dict)  # constraints
    delegated_from: Optional[str] = None  # parent capability ID
    issued_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None
    revoked: bool = False
    revoked_at: Optional[float] = None
    revoked_by: Optional[str] = None
    signature: Optional[str] = None  # cryptographic signature (future)

    @property
    def hash(self) -> str:
        payload = {
            "id": self.capability_id,
            "issuer": self.issuer,
            "holder": self.holder,
            "level": self.level.value,
            "scope": self.scope,
            "delegated_from": self.delegated_from,
        }
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()

    @property
    def is_valid(self) -> bool:
        """Check if this capability is currently valid."""
        if self.revoked:
            return False
        if self.expires_at and time.time() > self.expires_at:
            return False
        return True

    def to_dict(self) -> dict:
        d = asdict(self)
        d["level"] = self.level.value
        d["hash"] = self.hash
        d["is_valid"] = self.is_valid
        return d


class CapabilityGraph:
    """Graph of capabilities — who can do what, delegated from whom.

    The capability graph is separate from the execution graph.
    Authority travels separately from state.

    When a peer picks up computation from the market:
    1. Check if they have the required capabilities
    2. If not, request delegation from the issuer
    3. The deterministic layer enforces capabilities on every action
    4. The LLM never decides what's allowed — the runtime does
    """

    def __init__(self):
        self.capabilities: dict[str, Capability] = {}  # id → capability
        self._by_holder: dict[str, list[str]] = {}  # holder → [capability_ids]
        self._by_issuer: dict[str, list[str]] = {}  # issuer → [capability_ids]

    def grant(self, issuer: str, holder: str,
              level: CapabilityLevel,
              scope: Optional[dict] = None,
              expires_at: Optional[float] = None,
              delegated_from: Optional[str] = None) -> Capability:
        """Grant a capability to a holder."""
        # Check if issuer has DELEGATE capability (unless they're ROOT)
        if issuer != "root":
            issuer_caps = self.get_capabilities(issuer)
            can_delegate = any(
                c.level in (CapabilityLevel.DELEGATE, CapabilityLevel.ADMIN, CapabilityLevel.ROOT)
                and c.is_valid
                for c in issuer_caps
            )
            if not can_delegate and level != CapabilityLevel.OBSERVE:
                raise PermissionError(
                    f"Issuer {issuer} cannot delegate — no DELEGATE capability"
                )

        cap_id = hashlib.sha256(
            f"{issuer}:{holder}:{level.value}:{time.time()}".encode()
        ).hexdigest()[:16]

        cap = Capability(
            capability_id=cap_id,
            issuer=issuer,
            holder=holder,
            level=level,
            scope=scope or {},
            delegated_from=delegated_from,
            expires_at=expires_at,
        )
        self.capabilities[cap_id] = cap

        if holder not in self._by_holder:
            self._by_holder[holder] = []
        self._by_holder[holder].append(cap_id)

        if issuer not in self._by_issuer:
            self._by_issuer[issuer] = []
        self._by_issuer[issuer].append(cap_id)

        return cap

    def revoke(self, capability_id: str,
               revoked_by: str) -> bool:
        """Revoke a capability."""
        cap = self.capabilities.get(capability_id)
        if not cap:
            return False
        if cap.issuer != revoked_by and revoked_by != "root":
            return False
        cap.revoked = True
        cap.revoked_at = time.time()
        cap.revoked_by = revoked_by

        # Cascade: revoke all delegated capabilities
        for other in self.capabilities.values():
            if other.delegated_from == capability_id and other.is_valid:
                self.revoke(other.capability_id, revoked_by)
        return True

    def get_capabilities(self, holder: str) -> list[Capability]:
        """Get all valid capabilities for a holder."""
        cap_ids = self._by_holder.get(holder, [])
        return [self.capabilities[cid] for cid in cap_ids
                if self.capabilities[cid].is_valid]

    def can(self, holder: str, level: CapabilityLevel,
            scope_check: Optional[dict] = None) -> bool:
        """Check if a holder can perform an action at a level.

        The runtime calls this before every action.
        The LLM never decides what's allowed.
        """
        caps = self.get_capabilities(holder)

        # ROOT can do anything
        if any(c.level == CapabilityLevel.ROOT for c in caps):
            return True

        # Check for exact level match
        for cap in caps:
            if cap.level == level:
                if scope_check:
                    # Check all scope constraints are satisfied
                    for key, value in scope_check.items():
                        if key in cap.scope and cap.scope[key] != value:
                            continue  # scope mismatch, try next
                return True

            # Level hierarchy: ADMIN > EXECUTE > WRITE > READ
            level_order = {
                CapabilityLevel.ROOT: 100,
                CapabilityLevel.ADMIN: 90,
                CapabilityLevel.EXECUTE: 70,
                CapabilityLevel.WRITE: 50,
                CapabilityLevel.READ: 30,
                CapabilityLevel.INFERENCE: 40,
                CapabilityLevel.NETWORK: 60,
                CapabilityLevel.DELEGATE: 80,
                CapabilityLevel.OBSERVE: 10,
            }
            if level_order.get(cap.level, 0) >= level_order.get(level, 0):
                return True

        return False

    def check_action(self, holder: str, action: str,
                     action_scope: Optional[dict] = None) -> tuple[bool, str]:
        """Check if a holder can perform a specific action.

        Returns (allowed, reason).
        Called by the deterministic layer before every execution.
        """
        action_map = {
            "execute": CapabilityLevel.EXECUTE,
            "write": CapabilityLevel.WRITE,
            "read": CapabilityLevel.READ,
            "inference": CapabilityLevel.INFERENCE,
            "network": CapabilityLevel.NETWORK,
            "delegate": CapabilityLevel.DELEGATE,
            "admin": CapabilityLevel.ADMIN,
            "observe": CapabilityLevel.OBSERVE,
        }

        # Determine required level from action
        required_level = None
        for prefix, cap_level in action_map.items():
            if action.startswith(prefix):
                required_level = cap_level
                break

        if not required_level:
            return True, "No capability required for this action"

        if self.can(holder, required_level, action_scope):
            return True, f"Authorized: {required_level.value}"
        return False, f"Denied: requires {required_level.value} capability"

    def delegate(self, delegator: str, delegatee: str,
                 level: CapabilityLevel,
                 scope: Optional[dict] = None,
                 expires_at: Optional[float] = None) -> Capability:
        """Delegate a capability from one node to another."""
        # Verify delegator can delegate
        if not self.can(delegator, CapabilityLevel.DELEGATE):
            raise PermissionError(f"{delegator} cannot delegate")

        # Find the capability being delegated
        delegator_caps = self.get_capabilities(delegator)
        parent_cap = None
        for cap in delegator_caps:
            if cap.level == level or cap.level == CapabilityLevel.ROOT:
                parent_cap = cap
                break

        return self.grant(
            issuer=delegator,
            holder=delegatee,
            level=level,
            scope=scope or (parent_cap.scope if parent_cap else {}),
            expires_at=expires_at,
            delegated_from=parent_cap.capability_id if parent_cap else None,
        )

    def export_for_holder(self, holder: str) -> list[dict]:
        """Export capabilities for a holder — portable authority.

        This travels with the execution object when computation
        moves to a different node.
        """
        return [cap.to_dict() for cap in self.get_capabilities(holder)]

    def stats(self) -> dict:
        return {
            "total_capabilities": len(self.capabilities),
            "valid": sum(1 for c in self.capabilities.values() if c.is_valid),
            "revoked": sum(1 for c in self.capabilities.values() if c.revoked),
            "by_level": {
                level.value: sum(1 for c in self.capabilities.values()
                                if c.level == level)
                for level in CapabilityLevel
            },
            "holders": len(self._by_holder),
            "issuers": len(self._by_issuer),
        }
