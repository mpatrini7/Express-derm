import cv2
import numpy as np

from app.quality import QualityThresholds, analyze_image


THRESHOLDS = QualityThresholds(
    focus=80.0,
    min_brightness=45.0,
    max_brightness=220.0,
)


def _bgr(gray: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def test_sharp_well_exposed_image_scores_one_hundred() -> None:
    rows, columns = np.indices((96, 96))
    gray = np.where((rows + columns) % 2 == 0, 80, 180).astype(np.uint8)

    result = analyze_image(_bgr(gray), THRESHOLDS)

    assert result.accepted is True
    assert result.quality_score == 100.0
    assert result.reason is None


def test_blurry_but_well_exposed_image_is_saved_with_fifty_percent() -> None:
    gray = np.full((96, 96), 120, dtype=np.uint8)

    result = analyze_image(_bgr(gray), THRESHOLDS)

    assert result.accepted is True
    assert result.quality_score == 50.0
    assert result.reason is None


def test_black_image_below_fifty_percent_is_rejected() -> None:
    gray = np.zeros((96, 96), dtype=np.uint8)

    result = analyze_image(_bgr(gray), THRESHOLDS)

    assert result.accepted is False
    assert result.quality_score == 0.0
    assert result.reason is not None
    assert "below the 50% minimum" in result.reason
    assert "was not saved" in result.reason
    assert "not sufficiently sharp" not in result.reason
    assert "too dark" in result.reason
    assert "clipped dark pixels" in result.reason


def test_empty_image_remains_a_technical_rejection() -> None:
    result = analyze_image(np.asarray([], dtype=np.uint8), THRESHOLDS)

    assert result.accepted is False
    assert result.quality_score == 0.0
    assert result.reason == "Empty image"
