import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "soak_microscope.py"
)
SPEC = importlib.util.spec_from_file_location("soak_microscope", SCRIPT_PATH)
assert SPEC is not None
assert SPEC.loader is not None
soak_microscope = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = soak_microscope
SPEC.loader.exec_module(soak_microscope)


def test_decodes_v4l2_fourcc() -> None:
    encoded = cv2.VideoWriter_fourcc(*"MJPG")

    assert soak_microscope.decode_fourcc(float(encoded)) == "MJPG"
    assert soak_microscope.decode_fourcc(0) is None


def test_percentile_uses_linear_interpolation() -> None:
    assert soak_microscope.percentile([], 0.95) is None
    assert soak_microscope.percentile([10], 0.95) == 10
    assert soak_microscope.percentile([10, 20, 30, 40], 0.95) == pytest.approx(
        38.5,
    )


def test_continuity_stats_track_failures_gaps_and_repeated_samples() -> None:
    stats = soak_microscope.ContinuityStats()
    frame_a = np.zeros((48, 64, 3), dtype=np.uint8)
    frame_b = np.full((48, 64, 3), 255, dtype=np.uint8)

    stats.record_frame(frame_a, 1.00)
    stats.record_frame(frame_a.copy(), 1.04)
    stats.record_failure()
    stats.record_frame(frame_b, 1.12)

    report = stats.report_metrics(started=0.98, elapsed=0.16)

    assert report["reads"] == 4
    assert report["frames_received"] == 3
    assert report["read_failures"] == 1
    assert report["max_read_failure_streak"] == 1
    assert report["actual_frame_size"] == {"width": 64, "height": 48}
    assert report["time_to_first_frame_ms"] == pytest.approx(20)
    assert report["mean_frame_gap_ms"] == pytest.approx(60)
    assert report["p95_frame_gap_ms"] == pytest.approx(78)
    assert report["p99_frame_gap_ms"] == pytest.approx(79.6)
    assert report["max_frame_gap_ms"] == pytest.approx(80)
    assert report["repeated_frame_samples"] == 1
    assert report["repeated_frame_sample_rate"] == 0.5
    assert report["max_repeated_frame_streak"] == 1
    assert report["content_change_count"] == 1
