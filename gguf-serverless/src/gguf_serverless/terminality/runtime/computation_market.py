"""
Computation Market — peers seed unfinished computation, not files.

The network becomes a market for computation instead of storage.

  BitTorrent:  peers seed files → downloaders get bytes
  Terminality: peers seed computation → requesters get execution

A peer that already generated part of a reasoning tree can seed it.
Another peer continues it. Another verifies it. Another compresses
it into a reusable execution artifact.

Flow:
  1. Peer A starts computation → produces partial ExecutionObject
  2. Peer A seeds it (announces to market)
  3. Peer B picks it up → continues → produces new ExecutionObject
  4. Peer C verifies the causal chain → signs it
  5. Peer D compresses it → reusable artifact
  6. Reward flows to contributors based on causal contribution

The market prices computation by:
  - causal depth (how much work was done)
  - verification status (verified = higher value)
  - novelty (new state vs duplicate)
  - demand (how many peers want to continue this)
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink, ExecutionGraph,
    Objective, Provenance, ExecutionStatus, ExecutionContext,
)
from .causal_frontier import CausalFrontier, CausalReconstructor


class BidStatus(Enum):
    OPEN = "open"           # available for any peer to pick up
    CLAIMED = "claimed"     # a peer is working on it
    COMPLETED = "completed" # finished and verified
    EXPIRED = "expired"     # nobody picked it up


@dataclass
class ComputationBid:
    """A bid in the computation market — unfinished work available for peers.

    Like a BitTorrent announce, but for computation.
    Instead of "I have these chunks", it's "I have this partial computation,
    who can continue it?"
    """
    bid_id: str                          # unique bid ID
    execution_hash: str                  # hash of the ExecutionObject being seeded
    objective_hash: str                  # what we're trying to achieve
    frontier_hash: str                   # hash of the causal frontier
    causal_depth: int                    # how deep is the causal chain
    estimated_work_remaining: float      # 0.0-1.0, how much work left
    reward_pool: float                   # total reward available
    contributors: list[str]              # peer IDs that contributed so far
    verification_count: int              # how many peers verified this
    status: BidStatus = BidStatus.OPEN
    created_at: float = field(default_factory=time.time)
    claimed_by: Optional[str] = None     # peer that claimed it
    claimed_at: Optional[float] = None
    expires_at: Optional[float] = None   # when the bid expires

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps({
                "execution_hash": self.execution_hash,
                "objective_hash": self.objective_hash,
                "frontier_hash": self.frontier_hash,
            }, sort_keys=True).encode()
        ).hexdigest()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d


@dataclass
class ComputationSeed:
    """A seeded computation — what a peer offers to the market.

    Like seeding a torrent, but instead of file chunks,
    the peer seeds execution objects + causal frontiers.
    """
    peer_id: str
    execution_objects: list[str]     # hashes of objects being seeded
    frontiers: list[str]             # hashes of causal frontiers
    objectives: list[str]            # hashes of objectives
    bandwidth_score: float = 1.0     # how fast this peer computes
    reliability_score: float = 1.0   # historical success rate
    verified_count: int = 0          # how many verifications this peer has done
    contributions: int = 0           # how many computations this peer has advanced

    def to_dict(self) -> dict:
        return asdict(self)


class ComputationMarket:
    """Market for unfinished computation.

    Peers seed computation. Requesters bid for continuation.
    Verifiers check causal integrity. Contributors get rewarded.

    This is the economic layer that makes distributed computation work:
    - Without rewards, peers have no incentive to continue others' work
    - Without verification, peers could submit garbage
    - Without the market, there's no discovery mechanism

    The market ensures:
    1. Computation flows to the peer best suited for it
    2. Contributors are rewarded proportional to causal contribution
    3. Verified computation is worth more than unverified
    4. Novel computation is worth more than duplicate
    """

    def __init__(self, peer_id: str):
        self.peer_id = peer_id
        self.bids: dict[str, ComputationBid] = {}       # bid_id → bid
        self.seeds: dict[str, ComputationSeed] = {}     # peer_id → seed
        self.graph = ExecutionGraph()
        self.verifications: list[dict] = []
        self.reward_ledger: list[dict] = []

    def announce_bid(self, obj: ExecutionObject,
                     frontier: CausalFrontier,
                     reward_pool: float = 1.0,
                     ttl: float = 3600) -> ComputationBid:
        """Announce unfinished computation to the market.

        Like creating a torrent: "I have this partial work,
        who can continue it?"
        """
        # Estimate work remaining based on objective vs state
        work_remaining = self._estimate_work_remaining(obj)

        bid = ComputationBid(
            bid_id=hashlib.sha256(
                f"{obj.hash}:{time.time()}".encode()
            ).hexdigest()[:16],
            execution_hash=obj.hash,
            objective_hash=obj.objective.hash(),
            frontier_hash=frontier.hash(),
            causal_depth=frontier.causal_depth,
            estimated_work_remaining=work_remaining,
            reward_pool=reward_pool,
            contributors=[self.peer_id],
            verification_count=0,
            expires_at=time.time() + ttl,
        )
        self.bids[bid.bid_id] = bid
        self.graph.add(obj)
        return bid

    def claim_bid(self, bid_id: str) -> Optional[ComputationBid]:
        """Claim a bid — this peer will continue the computation."""
        bid = self.bids.get(bid_id)
        if not bid or bid.status != BidStatus.OPEN:
            return None
        if bid.expires_at and time.time() > bid.expires_at:
            bid.status = BidStatus.EXPIRED
            return None

        bid.status = BidStatus.CLAIMED
        bid.claimed_by = self.peer_id
        bid.claimed_at = time.time()
        return bid

    def complete_bid(self, bid_id: str,
                     result_obj: ExecutionObject,
                     verified: bool = True) -> dict:
        """Complete a bid — submit the continued computation.

        The result is verified against the causal chain.
        If verified, rewards are distributed to contributors.
        """
        bid = self.bids.get(bid_id)
        if not bid:
            return {"ok": False, "error": "Bid not found"}

        # Add result to graph
        self.graph.add(result_obj)

        # Verify causal chain
        chain_valid = self._verify_causal_chain(bid.execution_hash, result_obj.hash)

        if verified and chain_valid:
            bid.status = BidStatus.COMPLETED
            bid.verification_count += 1

            # Distribute rewards
            rewards = self._distribute_rewards(bid, result_obj)
            self.reward_ledger.extend(rewards)

            return {
                "ok": True,
                "verified": True,
                "rewards": rewards,
                "result_hash": result_obj.hash,
            }
        else:
            return {
                "ok": False,
                "verified": False,
                "error": "Causal chain verification failed",
            }

    def verify_computation(self, execution_hash: str,
                           verifier_id: Optional[str] = None) -> dict:
        """Verify a computation's causal integrity.

        Any peer can verify any computation. Verifications increase
        the computation's value in the market.
        """
        vid = verifier_id or self.peer_id
        obj = self.graph.get(execution_hash)
        if not obj:
            return {"ok": False, "error": "Object not found"}

        # Check causal chain
        chain = self.graph.get_causal_chain(execution_hash)
        all_verified = True
        for o in chain:
            if not o.verify():
                all_verified = False
                break

        verification = {
            "verifier": vid,
            "execution_hash": execution_hash,
            "verified": all_verified,
            "chain_depth": len(chain),
            "timestamp": time.time(),
        }
        self.verifications.append(verification)

        # Update seed reliability
        if vid in self.seeds:
            self.seeds[vid].verified_count += 1

        return verification

    def register_seed(self, seed: ComputationSeed):
        """Register a peer's seeded computation."""
        self.seeds[seed.peer_id] = seed

    def find_bids(self, objective_hash: Optional[str] = None,
                  max_work: float = 1.0) -> list[ComputationBid]:
        """Find open bids matching criteria.

        A peer looking for work can query the market for bids
        that match their capabilities.
        """
        results = []
        for bid in self.bids.values():
            if bid.status != BidStatus.OPEN:
                continue
            if bid.estimated_work_remaining > max_work:
                continue
            if objective_hash and bid.objective_hash != objective_hash:
                continue
            if bid.expires_at and time.time() > bid.expires_at:
                bid.status = BidStatus.EXPIRED
                continue
            results.append(bid)
        return results

    def _estimate_work_remaining(self, obj: ExecutionObject) -> float:
        """Estimate how much work remains (0.0 = done, 1.0 = just started)."""
        if obj.status == ExecutionStatus.COMPLETED:
            return 0.0
        if obj.status == ExecutionStatus.FAILED:
            return 0.5  # might be recoverable

        # Heuristic: more verified facts = closer to done
        facts = len(obj.state.verified_facts)
        steps = len(obj.state.reasoning_chain)
        if steps == 0:
            return 1.0
        # Diminishing returns — each fact/step brings closer
        return max(0.0, 1.0 - (facts * 0.1 + steps * 0.05))

    def _verify_causal_chain(self, from_hash: str, to_hash: str) -> bool:
        """Verify that to_hash is causally descended from from_hash."""
        chain = self.graph.get_causal_chain(to_hash, depth=100)
        for obj in chain:
            if obj.hash == from_hash:
                return True
        return False

    def _distribute_rewards(self, bid: ComputationBid,
                            result: ExecutionObject) -> list[dict]:
        """Distribute rewards to contributors based on causal contribution.

        Contributors earlier in the chain get less than those who
        completed more work. Verified contributors get a bonus.
        """
        chain = self.graph.get_causal_chain(result.hash)
        if not chain:
            return []

        # Weight by position: later contributors (more work) get more
        n = len(chain)
        rewards = []
        total_weight = sum(range(1, n + 1))

        for i, obj in enumerate(reversed(chain)):
            weight = (n - i) / total_weight
            reward = bid.reward_pool * weight
            contributor = obj.provenance.creator

            # Verification bonus
            verifications = [v for v in self.verifications
                           if v["execution_hash"] == obj.hash and v["verified"]]
            if verifications:
                reward *= 1.1  # 10% bonus for verified work

            rewards.append({
                "contributor": contributor,
                "execution_hash": obj.hash,
                "reward": round(reward, 6),
                "weight": round(weight, 4),
                "verified": len(verifications) > 0,
                "timestamp": time.time(),
            })

        return rewards

    def stats(self) -> dict:
        return {
            "total_bids": len(self.bids),
            "open_bids": sum(1 for b in self.bids.values() if b.status == BidStatus.OPEN),
            "completed_bids": sum(1 for b in self.bids.values() if b.status == BidStatus.COMPLETED),
            "total_seeds": len(self.seeds),
            "total_verifications": len(self.verifications),
            "total_rewards_distributed": sum(r["reward"] for r in self.reward_ledger),
            "graph": self.graph.stats(),
        }
