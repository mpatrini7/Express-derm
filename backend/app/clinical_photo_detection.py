from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class CandidateRegion:
    x: int
    y: int
    width: int
    height: int
    detection_score: float


def detect_lesion_candidates(
    image: np.ndarray,
    *,
    max_candidates: int = 30,
) -> list[CandidateRegion]:
    """Propose dark, locally contrasting regions for operator confirmation."""
    height, width = image.shape[:2]
    scale = min(1.0, 1600.0 / max(height, width))
    if scale < 1.0:
        working = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        working = image

    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    sigma = max(7.0, min(gray.shape[:2]) / 18.0)
    local_background = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)
    darkness = local_background.astype(np.float32) - gray.astype(np.float32)
    positive = darkness[darkness > 0]
    if positive.size == 0:
        return []

    # Cap the adaptive threshold so one very dark lesion cannot hide a lighter
    # lesion in the same frame. Later contour/contrast filters remove noise.
    threshold = max(7.0, min(25.0, float(np.percentile(positive, 72))))
    mask = (darkness >= threshold).astype(np.uint8) * 255
    kernel = np.ones((3, 3), dtype=np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = float(gray.shape[0] * gray.shape[1])
    regions: list[CandidateRegion] = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < frame_area * 0.00004 or area > frame_area * 0.08:
            continue
        x, y, candidate_width, candidate_height = cv2.boundingRect(contour)
        if min(candidate_width, candidate_height) < 6:
            continue
        aspect = candidate_width / max(candidate_height, 1)
        if aspect < 0.18 or aspect > 5.5:
            continue
        contour_mask = np.zeros(gray.shape, dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 255, -1)
        contrast = float(cv2.mean(darkness, mask=contour_mask)[0])
        if contrast < 6.0:
            continue
        solidity = area / max(float(candidate_width * candidate_height), 1.0)
        score = round(
            min(100.0, 35.0 + contrast * 1.8 + min(solidity, 1.0) * 20.0),
            1,
        )
        regions.append(
            CandidateRegion(
                x=round(x / scale),
                y=round(y / scale),
                width=max(1, round(candidate_width / scale)),
                height=max(1, round(candidate_height / scale)),
                detection_score=score,
            )
        )

    regions.sort(
        key=lambda item: (item.detection_score, item.width * item.height),
        reverse=True,
    )
    return regions[:max_candidates]


def crop_candidate(image: np.ndarray, region: CandidateRegion) -> np.ndarray:
    height, width = image.shape[:2]
    padding = max(24, round(max(region.width, region.height) * 0.65))
    x1 = max(0, region.x - padding)
    y1 = max(0, region.y - padding)
    x2 = min(width, region.x + region.width + padding)
    y2 = min(height, region.y + region.height + padding)
    return image[y1:y2, x1:x2]
