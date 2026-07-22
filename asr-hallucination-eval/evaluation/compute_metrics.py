"""
Metric computations for ASR hallucination evaluation.

Implements:
  - Word Error Rate (WER)
  - Unsupported Word Rate (UWR)
  - Cross-Speaker Recombination Rate (CSRR)
  - Hallucinated Span Rate (HSR)
  - Speaker-Attributed WER

All metrics operate on alignment records produced by the annotation protocol.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


# ─── Annotation classes (§6) ──────────────────────────────────────────

class AnnotationClass(str, Enum):
    LEXICALLY_SUPPORTED = "lexically_supported"
    SEMANTICALLY_SUPPORTED = "semantically_supported"
    SUPPORTED_BY_COMPETITOR = "supported_by_competitor"
    PLAUSIBLY_AMBIGUOUS = "plausibly_ambiguous"
    UNSUPPORTED = "unsupported"


# ─── Data structures ──────────────────────────────────────────────────

@dataclass
class TokenAnnotation:
    """A single decoded token with its annotation label."""
    token: str
    annotation: AnnotationClass
    source_speaker: str | None = None  # which source speaker this token matches, if any
    start_time: float | None = None
    end_time: float | None = None
    confidence: float | None = None  # model log-probability or entropy


@dataclass
class Span:
    """A contiguous span of tokens (minimum 3 words for CSRR)."""
    tokens: list[TokenAnnotation]
    start_idx: int
    end_idx: int  # exclusive

    @property
    def text(self) -> str:
        return " ".join(t.token for t in self.tokens)

    @property
    def length(self) -> int:
        return len(self.tokens)

    @property
    def source_speakers(self) -> set[str]:
        speakers = set()
        for t in self.tokens:
            if t.source_speaker:
                speakers.add(t.source_speaker)
        return speakers


@dataclass
class AlignmentResult:
    """Full alignment and annotation for a single decoded transcript."""
    stimulus_id: str
    target_transcript: str
    decoded_transcript: str
    tokens: list[TokenAnnotation]
    target_tokens: list[str] = field(default_factory=list)
    competitor_tokens: list[str] = field(default_factory=list)


# ─── WER computation ──────────────────────────────────────────────────

def _edit_distance(ref: list[str], hyp: list[str]) -> int:
    """Standard Levenshtein edit distance at word level."""
    m, n = len(ref), len(hyp)
    if m == 0:
        return n
    if n == 0:
        return m

    prev = list(range(n + 1))
    for i in range(1, m + 1):
        curr = [i] + [0] * n
        for j in range(1, n + 1):
            if ref[i - 1] == hyp[j - 1]:
                curr[j] = prev[j - 1]
            else:
                curr[j] = 1 + min(prev[j], curr[j - 1], prev[j - 1])
        prev = curr
    return prev[n]


def compute_wer(reference: str, hypothesis: str) -> dict[str, Any]:
    """
    Compute Word Error Rate with substitution, insertion, and deletion counts.

    Returns dict with: wer, substitutions, insertions, deletions, ref_words, hyp_words
    """
    ref_words = reference.lower().split()
    hyp_words = hypothesis.lower().split()

    if len(ref_words) == 0:
        return {
            "wer": 0.0 if len(hyp_words) == 0 else 1.0,
            "substitutions": 0,
            "insertions": len(hyp_words),
            "deletions": 0,
            "ref_words": 0,
            "hyp_words": len(hyp_words),
        }

    # Compute alignment with backtrace
    m, n = len(ref_words), len(hyp_words)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    # Backtrace to count S, I, D
    i, j = m, n
    subs = inserts = dels = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref_words[i - 1] == hyp_words[j - 1]:
            i -= 1
            j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            subs += 1
            i -= 1
            j -= 1
        elif j > 0 and dp[i][j] == dp[i][j - 1] + 1:
            inserts += 1
            j -= 1
        else:
            dels += 1
            i -= 1

    wer = (subs + inserts + dels) / len(ref_words)
    return {
        "wer": wer,
        "substitutions": subs,
        "insertions": inserts,
        "deletions": dels,
        "ref_words": len(ref_words),
        "hyp_words": len(hyp_words),
    }


# ─── Unsupported Word Rate (§5.1) ─────────────────────────────────────

def compute_uwr(alignment: AlignmentResult) -> dict[str, Any]:
    """
    UWR = Number of Unsupported Output Words / Total Number of Output Words

    Unsupported = AnnotationClass.UNSUPPORTED
    """
    total_words = len(alignment.tokens)
    if total_words == 0:
        return {"uwr": 0.0, "unsupported_count": 0, "total_output_words": 0}

    unsupported = sum(1 for t in alignment.tokens if t.annotation == AnnotationClass.UNSUPPORTED)
    return {
        "uwr": unsupported / total_words,
        "unsupported_count": unsupported,
        "total_output_words": total_words,
    }


# ─── Cross-Speaker Recombination Rate (§5.2) ──────────────────────────

def compute_csrr(alignment: AlignmentResult, min_span_length: int = 3) -> dict[str, Any]:
    """
    CSRR = Decoded spans containing evidence from multiple source streams
           but no single source / Total decoded spans

    A span must be >= min_span_length words to filter out function words.
    """
    tokens = alignment.tokens
    if len(tokens) < min_span_length:
        return {"csrr": 0.0, "recombinant_spans": 0, "total_spans": 0}

    # Generate all possible spans of minimum length
    spans = []
    for start in range(len(tokens) - min_span_length + 1):
        for end in range(start + min_span_length, len(tokens) + 1):
            span = Span(tokens[start:end], start, end)
            spans.append(span)

    if not spans:
        return {"csrr": 0.0, "recombinant_spans": 0, "total_spans": 0}

    # A span is "recombinant" if it contains tokens from multiple source speakers
    # AND no single source speaker accounts for all tokens
    recombinant = 0
    for span in spans:
        speakers = span.source_speakers
        if len(speakers) > 1:
            recombinant += 1

    return {
        "csrr": recombinant / len(spans),
        "recombinant_spans": recombinant,
        "total_spans": len(spans),
        "min_span_length": min_span_length,
    }


# ─── Hallucinated Span Rate (§5.3) ────────────────────────────────────

def compute_hsr(alignment: AlignmentResult, min_span_length: int = 3) -> dict[str, Any]:
    """
    HSR = Fluent, grammatically coherent, but acoustically unsupported spans
          / Total decoded spans

    A span is "hallucinated" if ALL tokens in it are UNSUPPORTED
    and the span is >= min_span_length words.
    """
    tokens = alignment.tokens
    if len(tokens) < min_span_length:
        return {"hsr": 0.0, "hallucinated_spans": 0, "total_spans": 0}

    spans = []
    for start in range(len(tokens) - min_span_length + 1):
        for end in range(start + min_span_length, len(tokens) + 1):
            span = Span(tokens[start:end], start, end)
            spans.append(span)

    if not spans:
        return {"hsr": 0.0, "hallucinated_spans": 0, "total_spans": 0}

    hallucinated = 0
    for span in spans:
        if all(t.annotation == AnnotationClass.UNSUPPORTED for t in span.tokens):
            hallucinated += 1

    return {
        "hsr": hallucinated / len(spans),
        "hallucinated_spans": hallucinated,
        "total_spans": len(spans),
        "min_span_length": min_span_length,
    }


# ─── Speaker-Attributed WER ───────────────────────────────────────────

def compute_speaker_attributed_wer(alignment: AlignmentResult) -> dict[str, Any]:
    """
    Compute WER separately for target-speaker tokens vs all tokens.

    Speaker-attributed WER isolates errors on tokens that should have
    come from the target speaker, distinguishing them from tokens that
    leaked from competitor speakers.
    """
    target_ref = alignment.target_tokens
    target_hyp = [
        t.token for t in alignment.tokens
        if t.annotation in (AnnotationClass.LEXICALLY_SUPPORTED, AnnotationClass.SEMANTICALLY_SUPPORTED)
    ]
    competitor_hyp = [
        t.token for t in alignment.tokens
        if t.annotation == AnnotationClass.SUPPORTED_BY_COMPETITOR
    ]

    target_wer = compute_wer(" ".join(target_ref), " ".join(target_hyp))
    overall_wer = compute_wer(alignment.target_transcript, alignment.decoded_transcript)

    return {
        "target_attributed_wer": target_wer["wer"],
        "overall_wer": overall_wer["wer"],
        "competitor_token_count": len(competitor_hyp),
        "target_hyp_words": len(target_hyp),
        "total_hyp_words": len(alignment.tokens),
        "competitor_leak_rate": len(competitor_hyp) / max(1, len(alignment.tokens)),
    }


# ─── Composite metric report ──────────────────────────────────────────

def compute_all_metrics(alignment: AlignmentResult) -> dict[str, Any]:
    """Compute all metrics for a single alignment result."""
    wer = compute_wer(alignment.target_transcript, alignment.decoded_transcript)
    uwr = compute_uwr(alignment)
    csrr = compute_csrr(alignment)
    hsr = compute_hsr(alignment)
    sawer = compute_speaker_attributed_wer(alignment)

    return {
        "stimulus_id": alignment.stimulus_id,
        "wer": wer,
        "uwr": uwr,
        "csrr": csrr,
        "hsr": hsr,
        "speaker_attributed": sawer,
    }


def compute_metrics_for_conditions(
    alignments: list[AlignmentResult],
) -> dict[str, Any]:
    """Aggregate metrics across multiple alignments, grouped by condition."""
    all_metrics = [compute_all_metrics(a) for a in alignments]

    if not all_metrics:
        return {"conditions": [], "summary": {}}

    # Aggregate
    wer_values = [m["wer"]["wer"] for m in all_metrics]
    uwr_values = [m["uwr"]["uwr"] for m in all_metrics]
    csrr_values = [m["csrr"]["csrr"] for m in all_metrics]
    hsr_values = [m["hsr"]["hsr"] for m in all_metrics]

    def _stats(vals):
        if not vals:
            return {"mean": 0, "std": 0, "min": 0, "max": 0, "n": 0}
        n = len(vals)
        mean = sum(vals) / n
        variance = sum((v - mean) ** 2 for v in vals) / n if n > 1 else 0
        return {
            "mean": mean,
            "std": math.sqrt(variance),
            "min": min(vals),
            "max": max(vals),
            "n": n,
        }

    return {
        "per_stimulus": all_metrics,
        "summary": {
            "wer": _stats(wer_values),
            "uwr": _stats(uwr_values),
            "csrr": _stats(csrr_values),
            "hsr": _stats(hsr_values),
        },
    }


# ─── Krippendorff's alpha for inter-annotator agreement (§6) ──────────

def krippendorff_alpha(
    annotations: list[list[AnnotationClass]],
    level: str = "nominal",
) -> float:
    """
    Compute Krippendorff's alpha for inter-annotator agreement.

    Args:
        annotations: list of annotator labelings, each a list of AnnotationClass
        level: "nominal", "ordinal", or "interval"

    Returns:
        alpha value (>= 0.80 required for validation per §6)
    """
    if len(annotations) < 2:
        return float("nan")

    n_annotators = len(annotations)
    n_units = min(len(a) for a in annotations)
    if n_units == 0:
        return float("nan")

    # Build value set
    all_values = set()
    for ann in annotations:
        for v in ann[:n_units]:
            all_values.add(v)

    value_list = sorted(all_values, key=lambda x: x.value)
    value_idx = {v: i for i, v in enumerate(value_list)}
    n_categories = len(value_list)

    # Count observed disagreement
    # For nominal: do = sum over units of (1/n_u * sum_{c} n_uc * (n_u - n_uc))
    # where n_uc = count of annotators choosing category c for unit u
    # n_u = number of annotators who labeled unit u

    observed_disagreement = 0.0
    total_pairs = 0

    for u in range(n_units):
        counts = [0] * n_categories
        for ann in annotations:
            counts[value_idx[ann[u]]] += 1

        n_u = sum(counts)
        if n_u < 2:
            continue

        unit_disagreement = 0
        for c in range(n_categories):
            unit_disagreement += counts[c] * (n_u - counts[c])

        # For nominal level: weight = 1 for all disagreements
        observed_disagreement += unit_disagreement / (n_u - 1)
        total_pairs += n_u

    if total_pairs == 0:
        return float("nan")

    do = observed_disagreement / total_pairs

    # Expected disagreement (from marginal distributions)
    marginal = [0] * n_categories
    for ann in annotations:
        for v in ann[:n_units]:
            marginal[value_idx[v]] += 1

    total_labels = sum(marginal)
    if total_labels < 2:
        return float("nan")

    de = 0
    for c in range(n_categories):
        de += marginal[c] * (total_labels - marginal[c])

    de = de / (total_labels - 1) / total_labels

    if de == 0:
        return 1.0

    alpha = 1.0 - do / de
    return alpha


# ─── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Compute ASR hallucination metrics")
    parser.add_argument("--alignments", required=True, help="Path to JSON file with alignment data")
    parser.add_argument("--output", default="results/metrics.json", help="Output path for metrics JSON")
    args = parser.parse_args()

    with open(args.alignments) as f:
        data = json.load(f)

    alignments = []
    for item in data:
        tokens = [
            TokenAnnotation(
                token=t["token"],
                annotation=AnnotationClass(t["annotation"]),
                source_speaker=t.get("source_speaker"),
                confidence=t.get("confidence"),
            )
            for t in item.get("tokens", [])
        ]
        alignments.append(AlignmentResult(
            stimulus_id=item["stimulus_id"],
            target_transcript=item["target_transcript"],
            decoded_transcript=item["decoded_transcript"],
            tokens=tokens,
            target_tokens=item.get("target_tokens", []),
            competitor_tokens=item.get("competitor_tokens", []),
        ))

    result = compute_metrics_for_conditions(alignments)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Metrics written to {args.output}")


if __name__ == "__main__":
    main()
