"""
Four Execution Layers — the runtime that owns continuity.

Models are replaceable compute engines. The runtime owns continuity.

Layer 1 — Objective:     understands goals, decomposes into steps
Layer 2 — Causal:        retrieves minimum causal evidence needed to continue
Layer 3 — Routing:       learns routing, scheduling, resource allocation
Layer 4 — Deterministic: executes, verifies, persists state

The key insight: these are not four models talking to each other.
They are four execution layers. The runtime owns the computation;
models are plugged in as replaceable inference engines at each layer.
"""

from __future__ import annotations
import json
import time
import hashlib
import urllib.request
from dataclasses import dataclass, field, asdict
from typing import Optional, Any, Callable

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink, Objective,
    Provenance, ExecutionGraph, ExecutionContext, ExecutionStatus,
)
from .causal_frontier import CausalFrontier, CausalReconstructor


@dataclass
class LayerResult:
    """Result from any execution layer."""
    layer: str
    ok: bool
    state_update: dict[str, Any] = field(default_factory=dict)
    reasoning: str = ""
    facts: list[str] = field(default_factory=list)
    cost: float = 0.0
    tokens: int = 0
    error: Optional[str] = None
    model_used: Optional[str] = None
    elapsed_ms: int = 0


class ObjectiveLayer:
    """Layer 1 — Objective understanding.

    Takes a raw objective and decomposes it into executable steps.
    Understands WHAT to do, not HOW.

    Model-agnostic: any LLM can be plugged in here. The runtime
    owns the decomposition, the model just interprets the goal.
    """

    def __init__(self, infer_fn: Optional[Callable] = None):
        self.infer_fn = infer_fn or self._default_infer

    async def decompose(self, objective: Objective,
                        current_state: ExecutionState) -> LayerResult:
        """Decompose an objective into steps."""
        prompt = (
            f"Objective: {objective.description}\n"
            f"Success criteria: {objective.success_criteria}\n"
            f"Current state variables: {json.dumps(current_state.variables, default=str)}\n"
            f"Verified facts: {current_state.verified_facts}\n\n"
            f"Decompose this objective into 1-5 concrete executable steps. "
            f"Return as JSON: {{\"steps\": [{{\"action\": \"...\", \"reason\": \"...\"}}]}}"
        )

        try:
            result = await self.infer_fn(prompt, model_hint="objective")
            steps = self._parse_steps(result.get("response", ""))
            return LayerResult(
                layer="objective",
                ok=True,
                state_update={"decomposed_steps": steps},
                reasoning=result.get("response", ""),
                tokens=result.get("usage", {}).get("total_tokens", 0),
                cost=result.get("usage", {}).get("cost", 0.0),
                model_used=result.get("model", "default"),
                elapsed_ms=result.get("elapsed_ms", 0),
            )
        except Exception as e:
            return LayerResult(layer="objective", ok=False, error=str(e))

    def _parse_steps(self, response: str) -> list[dict]:
        try:
            data = json.loads(response)
            return data.get("steps", [])
        except json.JSONDecodeError:
            # Fallback: split by newlines
            return [{"action": line.strip(), "reason": ""}
                    for line in response.split("\n") if line.strip()]

    async def _default_infer(self, prompt: str, model_hint: str = "") -> dict:
        """Default inference via OpenAI-compatible endpoint."""
        endpoint = "https://api.llm7.io/v1/chat/completions"
        body = json.dumps({
            "model": "gpt-oss:20b",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1024,
            "temperature": 0.2,
        }).encode()
        req = urllib.request.Request(
            endpoint, data=body,
            headers={"Content-Type": "application/json", "User-Agent": "terminality/0.1"},
        )
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        elapsed = int((time.time() - t0) * 1000)
        return {
            "response": data.get("choices", [{}])[0].get("message", {}).get("content", ""),
            "usage": data.get("usage", {}),
            "model": "gpt-oss:20b",
            "elapsed_ms": elapsed,
        }


class CausalRetrievalLayer:
    """Layer 2 — Causal evidence retrieval.

    Retrieves only the minimum causal evidence needed to continue.
    Not "what happened" — "what must be true to proceed."

    This is the layer that makes infinite history tractable.
    Instead of feeding the full history to the model, this layer
    extracts the causal frontier: the minimal set of facts, state,
    and evidence that the next step depends on.
    """

    def __init__(self, infer_fn: Optional[Callable] = None):
        self.infer_fn = infer_fn or ObjectiveLayer()._default_infer

    async def retrieve(self, objective: Objective,
                       graph: ExecutionGraph,
                       head_hash: str) -> LayerResult:
        """Retrieve minimal causal evidence for the next step."""
        reconstructor = CausalReconstructor(graph)
        frontier = reconstructor.compute_frontier(head_hash)

        # Build minimal context from frontier
        context_parts = []
        for obj_hash in frontier.required_objects:
            obj = graph.get(obj_hash)
            if obj:
                # Only include causally relevant state
                relevant_vars = {
                    k: v for k, v in obj.state.variables.items()
                    if k in frontier.required_state or k.startswith("decomposed_steps")
                }
                if relevant_vars:
                    context_parts.append({
                        "object": obj_hash[:12],
                        "state": relevant_vars,
                        "facts": [f for f in obj.state.verified_facts
                                 if f in frontier.required_facts],
                    })

        causal_context = json.dumps(context_parts, default=str)

        prompt = (
            f"Objective: {objective.description}\n"
            f"Causal evidence (minimal frontier):\n{causal_context}\n\n"
            f"What is the minimum additional evidence needed to take the next step? "
            f"Return as JSON: {{\"needed_facts\": [...], \"needed_state\": [...], "
            f"\"next_action\": \"...\"}}"
        )

        try:
            result = await self.infer_fn(prompt, model_hint="causal")
            parsed = self._parse_causal(result.get("response", ""))
            return LayerResult(
                layer="causal",
                ok=True,
                state_update={
                    "causal_frontier": frontier.to_json(),
                    "next_action": parsed.get("next_action", ""),
                    "needed_facts": parsed.get("needed_facts", []),
                    "needed_state": parsed.get("needed_state", []),
                },
                facts=parsed.get("needed_facts", []),
                reasoning=result.get("response", ""),
                tokens=result.get("usage", {}).get("total_tokens", 0),
                model_used=result.get("model", "default"),
                elapsed_ms=result.get("elapsed_ms", 0),
            )
        except Exception as e:
            return LayerResult(layer="causal", ok=False, error=str(e))

    def _parse_causal(self, response: str) -> dict:
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"needed_facts": [], "needed_state": [], "next_action": response[:200]}


class RoutingLayer:
    """Layer 3 — Routing, scheduling, and resource allocation.

    Learns which models, endpoints, and strategies work best for
    different types of computation. Not backprop — contextual bandit
    and preference learning on every execution.

    Over time, this layer learns:
    - Which model is best for code generation vs analysis
    - Which endpoint has lowest latency for specific prompt types
    - When to use quantized (qllm) vs raw (llm) inference
    - When to distribute vs execute locally
    """

    def __init__(self):
        self.routing_weights: dict[str, dict[str, float]] = {}
        # routing_weights[prompt_type][model_id] = weight
        self.execution_history: list[dict] = []
        self.learning_rate = 0.1

    async def route(self, prompt_type: str,
                    available_models: list[str]) -> LayerResult:
        """Route a computation to the best model."""
        weights = self.routing_weights.get(prompt_type, {})
        if not weights:
            # Initialize uniform
            for m in available_models:
                weights[m] = 1.0 / len(available_models)
            self.routing_weights[prompt_type] = weights

        # Softmax selection
        import math
        scores = {m: w for m, w in weights.items() if m in available_models}
        if not scores:
            selected = available_models[0]
        else:
            total = sum(math.exp(s) for s in scores.values())
            probs = {m: math.exp(s) / total for m, s in scores.items()}
            # Pick highest probability
            selected = max(probs, key=probs.get)

        return LayerResult(
            layer="routing",
            ok=True,
            state_update={
                "selected_model": selected,
                "prompt_type": prompt_type,
                "routing_weights": weights,
            },
            reasoning=f"Routed {prompt_type} to {selected}",
            elapsed_ms=0,
        )

    def update(self, prompt_type: str, model_id: str,
               reward: float, elapsed_ms: int):
        """Update routing weights based on execution outcome.

        reward: 1.0 = success, 0.0 = failure, 0.5 = partial
        Uses contextual bandit update: w ← w + η(r - r̂)
        """
        if prompt_type not in self.routing_weights:
            self.routing_weights[prompt_type] = {}

        weights = self.routing_weights[prompt_type]
        current = weights.get(model_id, 0.5)
        predicted = current  # simple: predict current weight

        # Bandit update
        weights[model_id] = current + self.learning_rate * (reward - predicted)

        # Normalize
        total = sum(weights.values())
        if total > 0:
            for m in weights:
                weights[m] /= total

        self.execution_history.append({
            "prompt_type": prompt_type,
            "model": model_id,
            "reward": reward,
            "elapsed_ms": elapsed_ms,
            "timestamp": time.time(),
        })

    def get_stats(self) -> dict:
        """Routing statistics."""
        return {
            "prompt_types": list(self.routing_weights.keys()),
            "total_routes": len(self.execution_history),
            "avg_reward": (
                sum(h["reward"] for h in self.execution_history) /
                max(1, len(self.execution_history))
            ),
            "weights": self.routing_weights,
        }


class DeterministicLayer:
    """Layer 4 — Deterministic execution, verification, and persistence.

    This layer is NOT model-based. It is deterministic:
    - Executes commands (shell, file ops, API calls)
    - Verifies results against expected outcomes
    - Persists state as content-addressed execution objects
    - Creates causal links

    This is the layer that makes computation reproducible.
    Regardless of which model produced the plan, this layer
    executes it deterministically and records the causal evidence.
    """

    def __init__(self, graph: ExecutionGraph):
        self.graph = graph

    async def execute(self, obj: ExecutionObject,
                      action: str,
                      executor: Optional[Callable] = None) -> tuple[LayerResult, ExecutionObject]:
        """Execute an action deterministically and persist the result.

        Returns (result, new_execution_object)
        """
        t0 = time.time()

        try:
            # Execute the action
            if executor:
                output = await executor(action, obj.state)
            else:
                output = await self._default_executor(action, obj.state)

            elapsed = int((time.time() - t0) * 1000)

            # Build new state
            new_state = ExecutionState(
                variables={**obj.state.variables, **output.get("state_update", {})},
                files_modified={**obj.state.files_modified, **output.get("files_modified", {})},
                reasoning_chain=obj.state.reasoning_chain + [{
                    "action": action,
                    "result": output.get("result", ""),
                    "timestamp": time.time(),
                }],
                verified_facts=obj.state.verified_facts + output.get("new_facts", []),
                failed_attempts=obj.state.failed_attempts + (
                    [output.get("error")] if output.get("error") else []
                ),
                terminal_output=output.get("output"),
                terminal_cwd=output.get("cwd", obj.state.terminal_cwd),
                tokens_consumed=obj.state.tokens_consumed + output.get("tokens", 0),
                compute_seconds=obj.state.compute_seconds + elapsed / 1000.0,
                cost_estimate=obj.state.cost_estimate + output.get("cost", 0.0),
            )

            # Create new execution object with causal link
            new_obj = ExecutionObject(
                state=new_state,
                objective=obj.objective,
                provenance=Provenance(
                    creator="deterministic:layer4",
                    layer="deterministic",
                    tool=action[:100],
                    timestamp=time.time(),
                ),
                causal_links=[CausalLink(
                    parent_hash=obj.hash,
                    cause=f"execute:{action[:100]}",
                    evidence_hash=new_state.hash(),
                )],
                context=obj.context,
                status=ExecutionStatus.COMPLETED if output.get("ok") else ExecutionStatus.FAILED,
            )

            # Add to graph
            self.graph.add(new_obj)

            return LayerResult(
                layer="deterministic",
                ok=output.get("ok", True),
                state_update=output.get("state_update", {}),
                reasoning=output.get("result", ""),
                facts=output.get("new_facts", []),
                elapsed_ms=elapsed,
                error=output.get("error"),
            ), new_obj

        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            return LayerResult(
                layer="deterministic",
                ok=False,
                error=str(e),
                elapsed_ms=elapsed,
            ), obj

    async def _default_executor(self, action: str,
                                state: ExecutionState) -> dict:
        """Default executor — shell command execution."""
        import subprocess

        try:
            result = subprocess.run(
                action, shell=True, capture_output=True, text=True,
                timeout=30, cwd=state.terminal_cwd or None,
            )
            ok = result.returncode == 0
            output = result.stdout + result.stderr
            new_facts = []
            if ok and result.stdout.strip():
                new_facts.append(f"command:{action[:50]} → success")

            return {
                "ok": ok,
                "output": output,
                "result": output[:500],
                "error": result.stderr if not ok else None,
                "new_facts": new_facts,
                "cwd": state.terminal_cwd,
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Command timed out", "output": ""}
        except Exception as e:
            return {"ok": False, "error": str(e), "output": ""}

    def verify_chain(self, head_hash: str) -> bool:
        """Verify the causal chain from root to head."""
        return self.graph.verify()


class RuntimeStack:
    """The complete runtime — all four layers wired together.

    This IS the product. Not a terminal, not a multiplexer, not a log.
    The runtime owns computational continuity. Models are plugged in.

    Usage:
        runtime = RuntimeStack()
        obj = runtime.create_objective("Build a REST API")
        result = await runtime.run(obj)
    """

    def __init__(self,
                 objective_infer: Optional[Callable] = None,
                 causal_infer: Optional[Callable] = None):
        self.graph = ExecutionGraph()
        self.objective_layer = ObjectiveLayer(objective_infer)
        self.causal_layer = CausalRetrievalLayer(causal_infer)
        self.routing_layer = RoutingLayer()
        self.deterministic_layer = DeterministicLayer(self.graph)

    def create_objective(self, description: str,
                         success_criteria: str = "",
                         creator: str = "human") -> ExecutionObject:
        """Create a new execution object from an objective."""
        objective = Objective(
            description=description,
            success_criteria=success_criteria or f"Objective completed: {description}",
        )
        state = ExecutionState()
        obj = ExecutionObject(
            state=state,
            objective=objective,
            provenance=Provenance(creator=creator, layer="init"),
            context=ExecutionContext(required_objective=objective.hash()),
        )
        self.graph.add(obj)
        return obj

    async def run(self, obj: ExecutionObject, max_steps: int = 10) -> ExecutionObject:
        """Run the full runtime stack on an execution object.

        For each step:
        1. Objective layer decomposes the goal
        2. Causal layer retrieves minimal evidence
        3. Routing layer selects the best model
        4. Deterministic layer executes and persists

        The runtime owns continuity. Models are replaceable.
        """
        current = obj

        for step in range(max_steps):
            if current.status in (ExecutionStatus.COMPLETED, ExecutionStatus.FAILED):
                break

            # Layer 1: Objective — decompose
            obj_result = await self.objective_layer.decompose(
                current.objective, current.state
            )
            if not obj_result.ok:
                break

            # Layer 2: Causal — retrieve minimal evidence
            causal_result = await self.causal_layer.retrieve(
                current.objective, self.graph, current.hash
            )
            if not causal_result.ok:
                break

            # Layer 3: Routing — select model
            route_result = await self.routing_layer.route(
                prompt_type="execution",
                available_models=["gpt-oss:20b", "qwen2:0.5b", "local:gguf"],
            )

            # Layer 4: Deterministic — execute
            next_action = causal_result.state_update.get("next_action", "")
            if not next_action:
                # Try steps from objective decomposition
                steps = obj_result.state_update.get("decomposed_steps", [])
                if step < len(steps):
                    next_action = steps[step].get("action", "")
                else:
                    break

            if not next_action:
                break

            det_result, new_obj = await self.deterministic_layer.execute(
                current, next_action
            )

            # Update routing based on outcome
            self.routing_layer.update(
                prompt_type="execution",
                model_id=route_result.state_update.get("selected_model", "default"),
                reward=1.0 if det_result.ok else 0.0,
                elapsed_ms=det_result.elapsed_ms,
            )

            current = new_obj

        return current

    def stats(self) -> dict:
        return {
            "graph": self.graph.stats(),
            "routing": self.routing_layer.get_stats(),
        }
