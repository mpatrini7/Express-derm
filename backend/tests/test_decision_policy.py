import pytest

from app.decision_policy import (
    DECISION_POLICY_VERSION,
    DUAL_REVIEW_REASON,
    THRESHOLD_GAP_REASON,
    classify_binary_score,
    classify_consensus_scores,
    combine_dual_signals,
)


def test_binary_extremes_policy_has_a_stable_version() -> None:
    assert DECISION_POLICY_VERSION == "dual-center-scale-confirmation-v1"


@pytest.mark.parametrize(
    ("score", "expected_level", "expected_abstained"),
    [
        (0.05, "low", False),
        (0.2, "uncertain", True),
        (0.5, "uncertain", True),
        (0.8, "high", False),
    ],
)
def test_binary_policy_returns_only_extremes_or_inconclusive(
    score: float,
    expected_level: str,
    expected_abstained: bool,
) -> None:
    decision = classify_binary_score(
        score,
        low_threshold=0.2,
        high_threshold=0.8,
    )

    assert decision.level == expected_level
    assert decision.abstained is expected_abstained
    assert decision.reason == (
        THRESHOLD_GAP_REASON if expected_abstained else None
    )
    assert decision.level != "intermediate"


def test_binary_policy_keeps_high_threshold_in_the_high_extreme() -> None:
    decision = classify_binary_score(
        0.8,
        low_threshold=0.2,
        high_threshold=0.8,
    )

    assert decision.level == "high"
    assert decision.abstained is False


@pytest.mark.parametrize(
    ("scores", "expected"),
    [
        ([0.05, 0.04, 0.03], "low"),
        ([0.85, 0.81, 0.9], "high"),
        ([0.85, 0.4, 0.9], "uncertain"),
    ],
)
def test_center_scale_consensus_requires_every_view(
    scores: list[float],
    expected: str,
) -> None:
    decision = classify_consensus_scores(
        scores,
        low_threshold=0.2,
        high_threshold=0.8,
    )

    assert decision.level == expected


def test_dual_policy_confirms_high_only_with_strict_broad_signal() -> None:
    melanoma = classify_consensus_scores(
        [0.9, 0.91, 0.92],
        low_threshold=0.2,
        high_threshold=0.8,
    )
    broad = classify_consensus_scores(
        [0.75, 0.76, 0.77],
        low_threshold=0.2,
        high_threshold=0.7,
    )

    review = combine_dual_signals(
        melanoma,
        broad,
        broad_scores=[0.75, 0.76, 0.77],
        broad_confirmation_threshold=0.8,
    )
    confirmed = combine_dual_signals(
        melanoma,
        broad,
        broad_scores=[0.85, 0.86, 0.87],
        broad_confirmation_threshold=0.8,
    )

    assert review.level == "uncertain"
    assert review.reason == DUAL_REVIEW_REASON
    assert confirmed.level == "high"
    assert confirmed.abstained is False


def test_dual_policy_exposes_low_only_when_both_signals_are_low() -> None:
    low = classify_consensus_scores(
        [0.01, 0.02, 0.03],
        low_threshold=0.1,
        high_threshold=0.8,
    )
    uncertain = classify_consensus_scores(
        [0.01, 0.2, 0.03],
        low_threshold=0.1,
        high_threshold=0.8,
    )

    combined_low = combine_dual_signals(
        low,
        low,
        broad_scores=[0.01, 0.02, 0.03],
        broad_confirmation_threshold=0.8,
    )
    combined_review = combine_dual_signals(
        low,
        uncertain,
        broad_scores=[0.01, 0.2, 0.03],
        broad_confirmation_threshold=0.8,
    )

    assert combined_low.level == "low"
    assert combined_review.level == "uncertain"
