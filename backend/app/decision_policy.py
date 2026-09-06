from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


DECISION_POLICY_VERSION = "dual-center-scale-confirmation-v1"
RUNTIME_ATTENTION_LEVELS = {"low", "high", "uncertain"}
THRESHOLD_GAP_REASON = (
    "Score falls between the configured low and high decision thresholds"
)
MARGIN_REASON = "Score falls inside the configured uncertainty region"
VIEW_DISAGREEMENT_REASON = (
    "The center-scale views do not agree on a reliable extreme"
)
DUAL_REVIEW_REASON = (
    "The melanoma and broad-malignancy signals do not jointly confirm high "
    "and do not both support low"
)


@dataclass(frozen=True)
class AttentionDecision:
    level: str
    abstained: bool
    reason: str | None


def classify_binary_score(
    score: float,
    *,
    low_threshold: float,
    high_threshold: float,
    abstention_margin: float = 0.0,
) -> AttentionDecision:
    """Expose only reliable binary extremes and abstain between them."""
    values = (score, low_threshold, high_threshold, abstention_margin)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Decision-policy inputs must be finite")
    if not 0.0 <= low_threshold < high_threshold <= 1.0:
        raise ValueError("Decision thresholds must be ordered within [0, 1]")
    if not 0.0 <= abstention_margin <= 0.5:
        raise ValueError("Abstention margin must be within [0, 0.5]")
    if not 0.0 <= score <= 1.0:
        raise ValueError("Score must be within [0, 1]")

    if low_threshold <= score < high_threshold:
        return AttentionDecision("uncertain", True, THRESHOLD_GAP_REASON)
    if abs(score - 0.5) < abstention_margin:
        return AttentionDecision("uncertain", True, MARGIN_REASON)
    if score < low_threshold:
        return AttentionDecision("low", False, None)
    return AttentionDecision("high", False, None)


def classify_consensus_scores(
    scores: Sequence[float],
    *,
    low_threshold: float,
    high_threshold: float,
) -> AttentionDecision:
    """Require every center-scale view to support the same extreme."""
    if not scores:
        raise ValueError("At least one center-scale score is required")
    if not all(math.isfinite(score) for score in scores):
        raise ValueError("Center-scale scores must be finite")
    if any(not 0.0 <= score <= 1.0 for score in scores):
        raise ValueError("Center-scale scores must be within [0, 1]")
    if not 0.0 <= low_threshold < high_threshold <= 1.0:
        raise ValueError("Decision thresholds must be ordered within [0, 1]")

    if max(scores) < low_threshold:
        return AttentionDecision("low", False, None)
    if min(scores) >= high_threshold:
        return AttentionDecision("high", False, None)
    return AttentionDecision("uncertain", True, VIEW_DISAGREEMENT_REASON)


def combine_dual_signals(
    melanoma: AttentionDecision,
    broad: AttentionDecision,
    *,
    broad_scores: Sequence[float],
    broad_confirmation_threshold: float,
) -> AttentionDecision:
    """Confirm high jointly; expose low only when both signals support it."""
    if not 0.0 <= broad_confirmation_threshold <= 1.0:
        raise ValueError("Broad confirmation threshold must be within [0, 1]")
    if not broad_scores:
        raise ValueError("Broad center-scale scores are required")
    if not all(
        math.isfinite(score) and 0.0 <= score <= 1.0
        for score in broad_scores
    ):
        raise ValueError("Broad center-scale scores must be finite in [0, 1]")

    if (
        melanoma.level == "high"
        and broad.level == "high"
        and min(broad_scores) >= broad_confirmation_threshold
    ):
        return AttentionDecision("high", False, None)
    if melanoma.level == "low" and broad.level == "low":
        return AttentionDecision("low", False, None)
    return AttentionDecision("uncertain", True, DUAL_REVIEW_REASON)
