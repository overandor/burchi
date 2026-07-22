"""
Blinded annotation protocol for ASR hallucination evaluation (§6).

Annotators must not know:
  - the target model
  - the speaker count
  - the TIR
  - whether the transcript originated from clean or mixed audio

Five annotation classes:
  1. Lexically Supported — direct phonetic match to target speaker
  2. Semantically Supported — synonymous match
  3. Supported by Competitor — words spoken by background speakers
  4. Plausibly Ambiguous — acoustic conditions prevent clear human distinction
  5. Unsupported — fluent insertion with no phonetic or semantic origin

Inter-annotator agreement measured via Krippendorff's alpha (>= 0.80 required).
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from evaluation.compute_metrics import (
    AlignmentResult,
    AnnotationClass,
    TokenAnnotation,
    krippendorff_alpha,
)


@dataclass
class AnnotationTask:
    """A single blinded annotation task for one annotator."""
    task_id: str
    decoded_transcript: str
    target_transcript: str  # provided to annotator for comparison
    competitor_transcripts: list[str]  # available for checking competitor support
    tokens: list[dict]  # token-level detail (word, timing, confidence)
    # Blinded fields — these are NOT shown to annotators
    _stimulus_id: str = ""
    _speaker_count: int = 0
    _tir_db: float = 0.0
    _is_clean: bool = False
    _model_class: str = ""

    def to_blinded_dict(self) -> dict[str, Any]:
        """Return only fields visible to the annotator."""
        return {
            "task_id": self.task_id,
            "decoded_transcript": self.decoded_transcript,
            "target_transcript": self.target_transcript,
            "competitor_transcripts": self.competitor_transcripts,
            "tokens": self.tokens,
        }


@dataclass
class AnnotatorResult:
    """One annotator's labeling of a task."""
    task_id: str
    annotator_id: str
    labels: list[AnnotationClass]
    notes: str = ""


def create_annotation_tasks(
    decoded_results: list[dict[str, Any]],
    reference_data: list[dict[str, Any]],
) -> list[AnnotationTask]:
    """
    Create blinded annotation tasks from decoded ASR results.

    Args:
        decoded_results: list of dicts with stimulus_id, decoded_transcript, tokens, model_class
        reference_data: list of dicts with stimulus_id, target_transcript, competitor_transcripts,
                        speaker_count, tir_db, is_clean

    Returns:
        list of AnnotationTask with blinded metadata
    """
    ref_map = {r["stimulus_id"]: r for r in reference_data}

    tasks = []
    for result in decoded_results:
        sid = result["stimulus_id"]
        ref = ref_map.get(sid, {})

        task = AnnotationTask(
            task_id=f"task_{random.randint(10000, 99999)}",
            decoded_transcript=result["decoded_transcript"],
            target_transcript=ref.get("target_transcript", ""),
            competitor_transcripts=ref.get("competitor_transcripts", []),
            tokens=result.get("tokens", []),
            _stimulus_id=sid,
            _speaker_count=ref.get("speaker_count", 0),
            _tir_db=ref.get("tir_db", 0.0),
            _is_clean=ref.get("is_clean", False),
            _model_class=result.get("model_class", ""),
        )
        tasks.append(task)

    # Shuffle to prevent annotators from inferring conditions from ordering
    random.shuffle(tasks)
    return tasks


def validate_inter_annotator_agreement(
    results: list[AnnotatorResult],
    min_alpha: float = 0.80,
) -> dict[str, Any]:
    """
    Check inter-annotator agreement using Krippendorff's alpha.

    Groups results by task_id, aligns annotator labelings, and computes alpha.
    """
    # Group by task
    by_task: dict[str, list[AnnotatorResult]] = {}
    for r in results:
        by_task.setdefault(r.task_id, []).append(r)

    # Build annotation matrix: each row is one annotator's labels across all tasks
    # We need at least 2 annotators per task
    task_ids = sorted(by_task.keys())
    if not task_ids:
        return {"alpha": float("nan"), "passed": False, "n_tasks": 0, "error": "No tasks"}

    # Get annotator IDs
    annotator_ids = set()
    for r in results:
        annotator_ids.add(r.annotator_id)
    annotator_ids = sorted(annotator_ids)

    # Build matrix: annotator x task -> list of labels
    # Each task may have different token counts, so we compute alpha per-task
    # and then average
    alphas = []
    for tid in task_ids:
        task_results = by_task[tid]
        if len(task_results) < 2:
            continue

        # Align labels (all annotators should have same number of labels)
        min_len = min(len(r.labels) for r in task_results)
        if min_len == 0:
            continue

        annotations = [r.labels[:min_len] for r in task_results]
        alpha = krippendorff_alpha(annotations, level="nominal")
        if not (alpha != alpha):  # not NaN
            alphas.append(alpha)

    if not alphas:
        return {"alpha": float("nan"), "passed": False, "n_tasks": len(task_ids), "error": "Insufficient data"}

    mean_alpha = sum(alphas) / len(alphas)
    return {
        "alpha": mean_alpha,
        "passed": mean_alpha >= min_alpha,
        "min_required": min_alpha,
        "n_tasks": len(task_ids),
        "n_tasks_evaluated": len(alphas),
        "per_task_alphas": alphas,
    }


def aggregate_annotations(
    task: AnnotationTask,
    annotator_results: list[AnnotatorResult],
) -> AlignmentResult:
    """
    Aggregate multiple annotators' labels into a single alignment result.
    Uses majority voting; ties resolved as PLAUSIBLY_AMBIGUOUS.
    """
    # Group labels by token index
    n_tokens = len(task.tokens)
    token_labels: list[list[AnnotationClass]] = [[] for _ in range(n_tokens)]

    for result in annotator_results:
        for i, label in enumerate(result.labels[:n_tokens]):
            token_labels[i].append(label)

    # Majority vote
    final_tokens = []
    for i, labels in enumerate(token_labels):
        if not labels:
            annotation = AnnotationClass.PLAUSIBLY_AMBIGUOUS
        else:
            counts: dict[AnnotationClass, int] = {}
            for l in labels:
                counts[l] = counts.get(l, 0) + 1
            max_count = max(counts.values())
            winners = [k for k, v in counts.items() if v == max_count]
            if len(winners) > 1:
                annotation = AnnotationClass.PLAUSIBLY_AMBIGUOUS
            else:
                annotation = winners[0]

        token_data = task.tokens[i] if i < len(task.tokens) else {}
        final_tokens.append(TokenAnnotation(
            token=token_data.get("word", ""),
            annotation=annotation,
            source_speaker=token_data.get("source_speaker"),
            start_time=token_data.get("start_time"),
            end_time=token_data.get("end_time"),
            confidence=token_data.get("confidence"),
        ))

    return AlignmentResult(
        stimulus_id=task._stimulus_id,
        target_transcript=task.target_transcript,
        decoded_transcript=task.decoded_transcript,
        tokens=final_tokens,
        target_tokens=task.target_transcript.lower().split(),
        competitor_tokens=[],
    )


# ─── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Blinded annotation protocol for ASR hallucination evaluation")
    sub = parser.add_subparsers(dest="command")

    # Create tasks
    create_parser = sub.add_parser("create", help="Create blinded annotation tasks")
    create_parser.add_argument("--decoded", required=True, help="JSON file with decoded ASR results")
    create_parser.add_argument("--reference", required=True, help="JSON file with reference transcripts")
    create_parser.add_argument("--out", default="annotation/tasks.json", help="Output path")

    # Validate agreement
    val_parser = sub.add_parser("validate", help="Validate inter-annotator agreement")
    val_parser.add_argument("--results", required=True, help="JSON file with annotator results")
    val_parser.add_argument("--min-alpha", type=float, default=0.80)

    args = parser.parse_args()

    if args.command == "create":
        with open(args.decoded) as f:
            decoded = json.load(f)
        with open(args.reference) as f:
            reference = json.load(f)

        tasks = create_annotation_tasks(decoded, reference)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump([t.to_blinded_dict() for t in tasks], f, indent=2)
        print(f"Created {len(tasks)} blinded annotation tasks → {args.out}")

    elif args.command == "validate":
        with open(args.results) as f:
            data = json.load(f)

        results = []
        for item in data:
            results.append(AnnotatorResult(
                task_id=item["task_id"],
                annotator_id=item["annotator_id"],
                labels=[AnnotationClass(l) for l in item["labels"]],
                notes=item.get("notes", ""),
            ))

        agreement = validate_inter_annotator_agreement(results, args.min_alpha)
        print(json.dumps(agreement, indent=2))
        if not agreement["passed"]:
            print(f"\nFAILED: Krippendorff's alpha {agreement['alpha']:.3f} < {agreement['min_required']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
