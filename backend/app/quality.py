from dataclasses import dataclass

import cv2
import numpy as np

from .config import settings


QUALITY_SCORE_VERSION = "focus-exposure-clipping-v1"
MINIMUM_QUALITY_SCORE = 50.0


@dataclass
class QualityResult:
    accepted: bool
    quality_score: float
    focus_score: float
    mean_brightness: float
    dark_fraction: float
    bright_fraction: float
    reason: str | None


@dataclass(frozen=True)
class QualityThresholds:
    focus: float
    min_brightness: float
    max_brightness: float


def configured_thresholds() -> QualityThresholds:
    return QualityThresholds(
        focus=settings.focus_threshold,
        min_brightness=settings.min_brightness,
        max_brightness=settings.max_brightness,
    )


def analyze_image(
    image: np.ndarray,
    thresholds: QualityThresholds | None = None,
) -> QualityResult:
    if image is None or image.size == 0:
        return QualityResult(
            accepted=False,
            quality_score=0.0,
            focus_score=0.0,
            mean_brightness=0.0,
            dark_fraction=1.0,
            bright_fraction=0.0,
            reason="Empty image",
        )

    active_thresholds = thresholds or configured_thresholds()
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    focus_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_brightness = float(gray.mean())
    dark_fraction = float((gray < 12).mean())
    bright_fraction = float((gray > 245).mean())

    focus_quality = min(
        max(focus_score / max(active_thresholds.focus, 1e-6), 0.0),
        1.0,
    )
    if mean_brightness < active_thresholds.min_brightness:
        exposure_quality = mean_brightness / max(
            active_thresholds.min_brightness,
            1e-6,
        )
    elif mean_brightness > active_thresholds.max_brightness:
        exposure_quality = (255.0 - mean_brightness) / max(
            255.0 - active_thresholds.max_brightness,
            1e-6,
        )
    else:
        exposure_quality = 1.0
    exposure_quality = min(max(exposure_quality, 0.0), 1.0)
    clipping_quality = min(
        max(1.0 - dark_fraction / 0.25, 0.0),
        max(1.0 - bright_fraction / 0.15, 0.0),
    )
    quality_score = round(
        100.0
        * (
            0.50 * focus_quality
            + 0.30 * exposure_quality
            + 0.20 * clipping_quality
        ),
        1,
    )

    reasons: list[str] = []
    if mean_brightness < active_thresholds.min_brightness:
        reasons.append("Image is too dark")
    if mean_brightness > active_thresholds.max_brightness:
        reasons.append("Image is too bright")
    if dark_fraction > 0.25:
        reasons.append("Too many clipped dark pixels")
    if bright_fraction > 0.15:
        reasons.append("Too many saturated highlights")
    if quality_score < MINIMUM_QUALITY_SCORE:
        reasons.insert(
            0,
            (
                f"Photo quality {quality_score:g}% is below the "
                f"{MINIMUM_QUALITY_SCORE:g}% minimum; image was not saved"
            ),
        )

    return QualityResult(
        accepted=quality_score >= MINIMUM_QUALITY_SCORE,
        quality_score=quality_score,
        focus_score=focus_score,
        mean_brightness=mean_brightness,
        dark_fraction=dark_fraction,
        bright_fraction=bright_fraction,
        reason="; ".join(reasons) if reasons else None,
    )
