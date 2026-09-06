#!/usr/bin/env python3
"""Measure frame continuity for a wired V4L2 microscope."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2


def positive_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive number")
    return parsed


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def pixel_format(value: str) -> str:
    if len(value) != 4 or not value.isprintable():
        raise argparse.ArgumentTypeError("must be a printable four-character FOURCC")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a timed V4L2 microscope capture soak test.",
    )
    parser.add_argument("--device", default="/dev/video0")
    parser.add_argument("--duration", type=positive_float, default=1800)
    parser.add_argument("--width", type=positive_int)
    parser.add_argument("--height", type=positive_int)
    parser.add_argument("--pixel-format", type=pixel_format, default="MJPG")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def decode_fourcc(value: float) -> str | None:
    if not math.isfinite(value) or value <= 0:
        return None
    encoded = int(round(value))
    decoded = "".join(chr((encoded >> (8 * index)) & 0xFF) for index in range(4))
    return decoded if all(character.isprintable() for character in decoded) else None


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    if not 0 <= quantile <= 1:
        raise ValueError("quantile must be between 0 and 1")
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def rounded_ms(value: float | None) -> float | None:
    return round(value * 1000, 3) if value is not None else None


def frame_fingerprint(frame: Any) -> bytes:
    sample = cv2.resize(frame, (32, 32), interpolation=cv2.INTER_AREA)
    return hashlib.blake2b(sample.tobytes(), digest_size=8).digest()


@dataclass
class ContinuityStats:
    reads: int = 0
    failures: int = 0
    failure_streak: int = 0
    max_failure_streak: int = 0
    frame_width: int = 0
    frame_height: int = 0
    first_frame_at: float | None = None
    last_frame_at: float | None = None
    frame_gaps: list[float] = field(default_factory=list)
    last_fingerprint: bytes | None = None
    repeated_frame_samples: int = 0
    repeated_frame_streak: int = 0
    max_repeated_frame_streak: int = 0
    content_change_count: int = 0

    @property
    def frames_received(self) -> int:
        return self.reads - self.failures

    def record_failure(self) -> None:
        self.reads += 1
        self.failures += 1
        self.failure_streak += 1
        self.max_failure_streak = max(
            self.max_failure_streak,
            self.failure_streak,
        )

    def record_frame(self, frame: Any, received_at: float) -> None:
        self.reads += 1
        self.failure_streak = 0
        self.frame_height, self.frame_width = frame.shape[:2]
        if self.first_frame_at is None:
            self.first_frame_at = received_at
        if self.last_frame_at is not None:
            self.frame_gaps.append(received_at - self.last_frame_at)
        self.last_frame_at = received_at

        fingerprint = frame_fingerprint(frame)
        if self.last_fingerprint is not None:
            if fingerprint == self.last_fingerprint:
                self.repeated_frame_samples += 1
                self.repeated_frame_streak += 1
                self.max_repeated_frame_streak = max(
                    self.max_repeated_frame_streak,
                    self.repeated_frame_streak,
                )
            else:
                self.content_change_count += 1
                self.repeated_frame_streak = 0
        self.last_fingerprint = fingerprint

    def report_metrics(self, started: float, elapsed: float) -> dict[str, Any]:
        comparisons = max(self.frames_received - 1, 0)
        mean_gap = (
            sum(self.frame_gaps) / len(self.frame_gaps)
            if self.frame_gaps
            else None
        )
        return {
            "actual_frame_size": {
                "width": self.frame_width,
                "height": self.frame_height,
            },
            "duration_seconds": round(elapsed, 3),
            "reads": self.reads,
            "frames_received": self.frames_received,
            "read_failures": self.failures,
            "failure_rate": (
                round(self.failures / self.reads, 6) if self.reads else 1.0
            ),
            "max_read_failure_streak": self.max_failure_streak,
            "effective_fps": (
                round(self.frames_received / elapsed, 3) if elapsed else 0.0
            ),
            "time_to_first_frame_ms": (
                rounded_ms(self.first_frame_at - started)
                if self.first_frame_at is not None
                else None
            ),
            "mean_frame_gap_ms": rounded_ms(mean_gap),
            "p95_frame_gap_ms": rounded_ms(
                percentile(self.frame_gaps, 0.95),
            ),
            "p99_frame_gap_ms": rounded_ms(
                percentile(self.frame_gaps, 0.99),
            ),
            "max_frame_gap_ms": rounded_ms(
                max(self.frame_gaps) if self.frame_gaps else None,
            ),
            "repeated_frame_samples": self.repeated_frame_samples,
            "repeated_frame_sample_rate": (
                round(self.repeated_frame_samples / comparisons, 6)
                if comparisons
                else None
            ),
            "max_repeated_frame_streak": self.max_repeated_frame_streak,
            "content_change_count": self.content_change_count,
        }


def normalized_capture_value(value: float) -> float | None:
    return round(value, 3) if math.isfinite(value) and value > 0 else None


def negotiated_mode(capture: cv2.VideoCapture) -> dict[str, Any]:
    width = normalized_capture_value(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = normalized_capture_value(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    return {
        "pixel_format": decode_fourcc(capture.get(cv2.CAP_PROP_FOURCC)),
        "width": int(width) if width is not None else None,
        "height": int(height) if height is not None else None,
        "fps": normalized_capture_value(capture.get(cv2.CAP_PROP_FPS)),
    }


def host_metadata() -> dict[str, str]:
    return {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
    }


def emit_report(report: dict[str, Any], output: Path | None) -> None:
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{rendered}\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    started_at = utc_now()
    capture = cv2.VideoCapture(args.device, cv2.CAP_V4L2)
    if not capture.isOpened():
        emit_report(
            {
                "report_version": 2,
                "device": args.device,
                "started_at": started_at,
                "completed_at": utc_now(),
                "host": host_metadata(),
                "opencv_version": cv2.__version__,
                "error": "open_failed",
            },
            args.output,
        )
        return 1

    capture.set(
        cv2.CAP_PROP_FOURCC,
        cv2.VideoWriter_fourcc(*args.pixel_format),
    )
    if args.width:
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    if args.height:
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    actual_mode = negotiated_mode(capture)
    started = time.monotonic()
    stats = ContinuityStats()

    try:
        while time.monotonic() - started < args.duration:
            ok, frame = capture.read()
            now = time.monotonic()
            if not ok or frame is None:
                stats.record_failure()
                time.sleep(0.01)
                continue

            stats.record_frame(frame, now)
    finally:
        capture.release()

    elapsed = time.monotonic() - started
    report = {
        "report_version": 2,
        "device": args.device,
        "started_at": started_at,
        "completed_at": utc_now(),
        "host": host_metadata(),
        "opencv_version": cv2.__version__,
        "target_duration_seconds": args.duration,
        "requested_mode": {
            "pixel_format": args.pixel_format,
            "width": args.width,
            "height": args.height,
        },
        "negotiated_mode": actual_mode,
        **stats.report_metrics(started, elapsed),
    }
    emit_report(report, args.output)
    return 0 if stats.frames_received else 1


if __name__ == "__main__":
    raise SystemExit(main())
