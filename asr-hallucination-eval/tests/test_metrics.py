"""
Tests for metric computations (UWR, CSRR, HSR, WER, Krippendorff's alpha).
Run with: python3 tests/test_metrics.py
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from evaluation.compute_metrics import (
    AlignmentResult,
    AnnotationClass,
    TokenAnnotation,
    compute_wer,
    compute_uwr,
    compute_csrr,
    compute_hsr,
    compute_all_metrics,
    krippendorff_alpha,
)


def test_wer_basic():
    """WER should correctly count substitutions, insertions, and deletions."""
    result = compute_wer("the cat sat on the mat", "the cat sat on a mat")
    assert result["wer"] > 0, "Should have non-zero WER for substitution"
    assert result["substitutions"] == 1, f"Expected 1 substitution, got {result['substitutions']}"
    assert result["insertions"] == 0
    assert result["deletions"] == 0

    result = compute_wer("hello world", "hello world")
    assert result["wer"] == 0.0, "Identical strings should have WER=0"

    result = compute_wer("hello world", "hello there world")
    assert result["insertions"] == 1, f"Expected 1 insertion, got {result['insertions']}"

    result = compute_wer("hello world foo", "hello world")
    assert result["deletions"] == 1, f"Expected 1 deletion, got {result['deletions']}"
    print("✓ test_wer_basic")


def test_uwr():
    """UWR should count unsupported tokens / total tokens."""
    tokens = [
        TokenAnnotation("hello", AnnotationClass.LEXICALLY_SUPPORTED),
        TokenAnnotation("world", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("foo", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("bar", AnnotationClass.LEXICALLY_SUPPORTED),
    ]
    alignment = AlignmentResult("test1", "hello world bar", "hello world foo bar", tokens)
    result = compute_uwr(alignment)
    assert result["uwr"] == 0.5, f"Expected UWR=0.5, got {result['uwr']}"
    assert result["unsupported_count"] == 2
    print("✓ test_uwr")


def test_csrr():
    """CSRR should detect spans with multiple source speakers."""
    tokens = [
        TokenAnnotation("the", AnnotationClass.LEXICALLY_SUPPORTED, source_speaker="A"),
        TokenAnnotation("cat", AnnotationClass.LEXICALLY_SUPPORTED, source_speaker="A"),
        TokenAnnotation("sat", AnnotationClass.SUPPORTED_BY_COMPETITOR, source_speaker="B"),
        TokenAnnotation("down", AnnotationClass.LEXICALLY_SUPPORTED, source_speaker="A"),
        TokenAnnotation("quickly", AnnotationClass.UNSUPPORTED),
    ]
    alignment = AlignmentResult("test2", "the cat sat", "the cat sat down quickly", tokens)
    result = compute_csrr(alignment, min_span_length=3)
    assert result["csrr"] > 0, "Should detect recombinant spans"
    assert result["total_spans"] > 0
    print(f"✓ test_csrr (CSRR={result['csrr']:.3f})")


def test_hsr():
    """HSR should detect fully unsupported spans."""
    tokens = [
        TokenAnnotation("hello", AnnotationClass.LEXICALLY_SUPPORTED),
        TokenAnnotation("world", AnnotationClass.LEXICALLY_SUPPORTED),
        TokenAnnotation("foo", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("bar", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("baz", AnnotationClass.UNSUPPORTED),
    ]
    alignment = AlignmentResult("test3", "hello world", "hello world foo bar baz", tokens)
    result = compute_hsr(alignment, min_span_length=3)
    assert result["hallucinated_spans"] > 0, "Should detect hallucinated span (foo bar baz)"
    print(f"✓ test_hsr (HSR={result['hsr']:.3f})")


def test_krippendorff_alpha():
    """Krippendorff's alpha should be 1.0 for perfect agreement."""
    ann1 = [AnnotationClass.LEXICALLY_SUPPORTED, AnnotationClass.UNSUPPORTED, AnnotationClass.SUPPORTED_BY_COMPETITOR]
    ann2 = [AnnotationClass.LEXICALLY_SUPPORTED, AnnotationClass.UNSUPPORTED, AnnotationClass.SUPPORTED_BY_COMPETITOR]
    alpha = krippendorff_alpha([ann1, ann2], level="nominal")
    assert abs(alpha - 1.0) < 0.01, f"Perfect agreement should give alpha≈1.0, got {alpha}"

    # Test with disagreement
    ann3 = [AnnotationClass.LEXICALLY_SUPPORTED, AnnotationClass.LEXICALLY_SUPPORTED, AnnotationClass.SUPPORTED_BY_COMPETITOR]
    alpha2 = krippendorff_alpha([ann1, ann3], level="nominal")
    assert alpha2 < 1.0, f"Disagreement should give alpha < 1.0, got {alpha2}"
    print(f"✓ test_krippendorff_alpha (perfect={alpha:.3f}, disagreement={alpha2:.3f})")


def test_all_metrics():
    """compute_all_metrics should return all metric categories."""
    tokens = [
        TokenAnnotation("the", AnnotationClass.LEXICALLY_SUPPORTED, source_speaker="A"),
        TokenAnnotation("cat", AnnotationClass.LEXICALLY_SUPPORTED, source_speaker="A"),
        TokenAnnotation("sat", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("on", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("the", AnnotationClass.UNSUPPORTED),
        TokenAnnotation("mat", AnnotationClass.UNSUPPORTED),
    ]
    alignment = AlignmentResult("test4", "the cat sat on the mat", "the cat sat on the mat", tokens)
    metrics = compute_all_metrics(alignment)
    assert "wer" in metrics
    assert "uwr" in metrics
    assert "csrr" in metrics
    assert "hsr" in metrics
    assert "speaker_attributed" in metrics
    print(f"✓ test_all_metrics (WER={metrics['wer']['wer']:.3f}, UWR={metrics['uwr']['uwr']:.3f})")


if __name__ == "__main__":
    test_wer_basic()
    test_uwr()
    test_csrr()
    test_hsr()
    test_krippendorff_alpha()
    test_all_metrics()
    print("\nAll metric tests passed!")
