"""
Ledger System — append-only content-addressed ledgers.

The runtime is a set of interoperable append-only ledgers:

  Execution Ledger    — every command, process, mutation
  Inference Ledger    — every model call, reasoning step
  Filesystem Ledger   — every file change
  Tool Ledger         — every tool invocation
  Artifact Ledger     — every produced output
  Knowledge Ledger    — every verified fact
  Verification Ledger — every verification receipt
  Reward Ledger       — every reward/penalty
  Authority Ledger    — every capability grant/revoke
  Identity Ledger     — every peer identity
  Network Ledger      — every peer connection/disconnection

Each ledger is content-addressed and independently replicable.
A working state is reconstructed by composing compatible ledger roots.
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum


class LedgerType(Enum):
    EXECUTION = "execution"
    INFERENCE = "inference"
    FILESYSTEM = "filesystem"
    TOOL = "tool"
    ARTIFACT = "artifact"
    KNOWLEDGE = "knowledge"
    VERIFICATION = "verification"
    REWARD = "reward"
    AUTHORITY = "authority"
    IDENTITY = "identity"
    NETWORK = "network"


@dataclass
class LedgerEntry:
    """A single entry in a ledger.

    Every entry is content-addressed, append-only, and independently
    verifiable. Entries form a chain through parent_hash.
    """
    ledger_type: LedgerType
    entry_id: str
    hash: str                          # content-addressed identity
    parent_hash: str                   # previous entry in this ledger
    data: dict[str, Any]               # type-specific payload
    timestamp: float = field(default_factory=time.time)
    signer: str = ""                   # who created this entry
    signature: str = ""                # cryptographic signature (future)

    @classmethod
    def create(cls, ledger_type: LedgerType,
               parent_hash: str,
               data: dict[str, Any],
               signer: str = "") -> "LedgerEntry":
        ts = time.time()
        entry_id = hashlib.sha256(
            f"{ledger_type.value}:{ts}".encode()
        ).hexdigest()[:16]
        payload = {
            "type": ledger_type.value,
            "id": entry_id,
            "parent": parent_hash,
            "data": data,
            "timestamp": ts,
            "signer": signer,
        }
        h = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()
        return cls(
            ledger_type=ledger_type,
            entry_id=entry_id,
            hash=h,
            parent_hash=parent_hash,
            data=data,
            signer=signer,
            timestamp=ts,
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["ledger_type"] = self.ledger_type.value
        return d


class Ledger:
    """A single append-only content-addressed ledger.

    Properties:
    - Append-only: entries can never be deleted or modified
    - Content-addressed: each entry has a hash
    - Chained: each entry references its parent
    - Verifiable: anyone can check the chain integrity
    - Independently replicable: ledgers can be replicated separately
    """

    def __init__(self, ledger_type: LedgerType):
        self.ledger_type = ledger_type
        self.entries: list[LedgerEntry] = []
        self.head_hash: str = ""       # hash of most recent entry
        self.root_hash: str = ""       # hash of first entry (genesis)
        self._by_hash: dict[str, LedgerEntry] = {}

    def append(self, data: dict[str, Any],
               signer: str = "") -> LedgerEntry:
        """Append a new entry to the ledger."""
        entry = LedgerEntry.create(
            ledger_type=self.ledger_type,
            parent_hash=self.head_hash,
            data=data,
            signer=signer,
        )
        self.entries.append(entry)
        self._by_hash[entry.hash] = entry
        if not self.root_hash:
            self.root_hash = entry.hash
        self.head_hash = entry.hash
        return entry

    def get(self, entry_hash: str) -> Optional[LedgerEntry]:
        return self._by_hash.get(entry_hash)

    def verify_chain(self) -> bool:
        """Verify the integrity of the entire chain."""
        for i, entry in enumerate(self.entries):
            if i == 0:
                if entry.parent_hash != "":
                    return False
            else:
                if entry.parent_hash != self.entries[i-1].hash:
                    return False
            # Verify content hash
            payload = {
                "type": entry.ledger_type.value,
                "id": entry.entry_id,
                "parent": entry.parent_hash,
                "data": entry.data,
                "timestamp": entry.timestamp,
                "signer": entry.signer,
            }
            expected = hashlib.sha256(
                json.dumps(payload, sort_keys=True, default=str).encode()
            ).hexdigest()
            if expected != entry.hash:
                return False
        return True

    def query(self, key: str = "", value: Any = None,
              limit: int = 100) -> list[LedgerEntry]:
        """Query entries by data field."""
        results = []
        for entry in reversed(self.entries):  # most recent first
            if key and key in entry.data:
                if value is None or entry.data[key] == value:
                    results.append(entry)
            elif not key:
                results.append(entry)
            if len(results) >= limit:
                break
        return results

    def stats(self) -> dict:
        return {
            "type": self.ledger_type.value,
            "entries": len(self.entries),
            "root": self.root_hash[:12] if self.root_hash else "",
            "head": self.head_hash[:12] if self.head_hash else "",
            "verified": self.verify_chain(),
        }

    def to_dict(self) -> dict:
        return {
            **self.stats(),
            "entries": [e.to_dict() for e in self.entries[-20:]],  # last 20
        }


class LedgerSystem:
    """The complete set of interoperable ledgers.

    A working state is reconstructed by composing compatible ledger roots.
    Each ledger is independently replicable — peers can choose which
    ledgers to replicate based on their needs.

    For example:
    - A verification peer replicates only the Verification and Knowledge ledgers
    - A storage peer replicates the Filesystem and Artifact ledgers
    - An inference peer replicates the Inference and Tool ledgers
    - A scheduler replicates the Reward and Network ledgers
    """

    def __init__(self):
        self.ledgers: dict[LedgerType, Ledger] = {}
        for lt in LedgerType:
            self.ledgers[lt] = Ledger(lt)

    def get(self, ledger_type: LedgerType) -> Ledger:
        return self.ledgers[ledger_type]

    def append(self, ledger_type: LedgerType,
               data: dict[str, Any],
               signer: str = "") -> LedgerEntry:
        """Append to a specific ledger."""
        return self.ledgers[ledger_type].append(data, signer)

    def get_state_root(self) -> dict[str, str]:
        """Get the root hashes of all ledgers.

        This is the 'state root' — like a Merkle root of the entire
        runtime state. Two peers with the same state root have
        identical ledger states.
        """
        return {
            lt.value: ledger.head_hash
            for lt, ledger in self.ledgers.items()
        }

    def get_state_root_hash(self) -> str:
        """A single hash representing the entire runtime state."""
        roots = self.get_state_root()
        return hashlib.sha256(
            json.dumps(roots, sort_keys=True).encode()
        ).hexdigest()

    def verify_all(self) -> bool:
        """Verify all ledger chains."""
        return all(ledger.verify_chain() for ledger in self.ledgers.values())

    def stats(self) -> dict:
        return {
            "state_root": self.get_state_root_hash()[:12],
            "ledgers": {
                lt.value: ledger.stats()
                for lt, ledger in self.ledgers.items()
            },
            "total_entries": sum(len(l.entries) for l in self.ledgers.values()),
            "all_verified": self.verify_all(),
        }

    def replicate_subset(self, ledger_types: list[LedgerType]) -> dict:
        """Export a subset of ledgers for replication.

        A peer that only needs verification data can replicate
        just the Verification and Knowledge ledgers.
        """
        return {
            lt.value: self.ledgers[lt].to_dict()
            for lt in ledger_types
        }
