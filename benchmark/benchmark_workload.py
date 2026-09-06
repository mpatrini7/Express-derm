#!/usr/bin/env python3
"""Dependency-light workloads for the Express-Derm storage benchmark."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import shutil
import socket
import statistics
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterable


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


class LatencySamples:
    """Bounded deterministic reservoir for long sustained workloads."""

    def __init__(self, limit: int = 100_000, seed: int = 0) -> None:
        self.limit = limit
        self.seen = 0
        self.values: list[float] = []
        self._random = random.Random(seed)

    def add(self, value: float) -> None:
        self.seen += 1
        if len(self.values) < self.limit:
            self.values.append(float(value))
            return
        replacement = self._random.randrange(self.seen)
        if replacement < self.limit:
            self.values[replacement] = float(value)


def percentile(values: Iterable[float], fraction: float) -> float | None:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def image_paths(source_dir: Path) -> list[Path]:
    paths = sorted(
        path
        for path in source_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )
    if not paths:
        raise RuntimeError(f"No supported images found under {source_dir}")
    return paths


def load_image_payloads(source_dir: Path, memory_limit_mib: int) -> list[tuple[str, bytes]]:
    limit = max(memory_limit_mib, 1) * 1024 * 1024
    payloads: list[tuple[str, bytes]] = []
    used = 0
    for path in image_paths(source_dir):
        size = path.stat().st_size
        if payloads and used + size > limit:
            break
        data = path.read_bytes()
        payloads.append((path.suffix.lower() or ".bin", data))
        used += len(data)
        if used >= limit:
            break
    if not payloads:
        raise RuntimeError("Unable to stage an image payload in memory")
    return payloads


def safe_generated_directory(path: Path, required_prefix: str) -> Path:
    resolved = path.resolve()
    if not resolved.name.startswith(required_prefix):
        raise RuntimeError(
            f"Refusing generated directory without prefix {required_prefix!r}: {resolved}"
        )
    if resolved in {Path("/"), Path.home()}:
        raise RuntimeError(f"Refusing unsafe generated directory: {resolved}")
    return resolved


def remove_generated_directory(path: Path, required_prefix: str) -> None:
    resolved = safe_generated_directory(path, required_prefix)
    if resolved.exists():
        shutil.rmtree(resolved)


def command_ingest(args: argparse.Namespace) -> int:
    source_dir = Path(args.source_dir).resolve()
    destination = safe_generated_directory(Path(args.destination), "ingest-run-")
    output = Path(args.output).resolve()
    payloads = load_image_payloads(source_dir, args.memory_limit_mib)
    destination.mkdir(parents=True, exist_ok=False)

    latencies_ms: list[float] = []
    total_bytes = 0
    started = time.perf_counter()
    try:
        for index in range(args.count):
            suffix, data = payloads[index % len(payloads)]
            target = destination / f"image-{index:05d}{suffix}"
            operation_started = time.perf_counter()
            with target.open("wb", buffering=0) as handle:
                handle.write(data)
                os.fsync(handle.fileno())
            latencies_ms.append((time.perf_counter() - operation_started) * 1000.0)
            total_bytes += len(data)
        fsync_directory(destination)
        elapsed = time.perf_counter() - started
        payload = {
            "status": "ok",
            "count": args.count,
            "unique_source_images_staged": len(payloads),
            "staged_source_bytes": sum(len(item[1]) for item in payloads),
            "total_bytes": total_bytes,
            "elapsed_seconds": elapsed,
            "images_per_second": args.count / elapsed if elapsed else None,
            "throughput_mib_per_second": total_bytes / 1024 / 1024 / elapsed if elapsed else None,
            "latency_p50_ms": percentile(latencies_ms, 0.50),
            "latency_p95_ms": percentile(latencies_ms, 0.95),
            "operation_latencies_ms": latencies_ms,
            "fsync_per_image": True,
        }
        write_json(output, payload)
    finally:
        if not args.keep_data:
            remove_generated_directory(destination, "ingest-run-")
    return 0


def onnx_files(model_dir: Path) -> list[Path]:
    return sorted(path for path in model_dir.rglob("*.onnx") if path.is_file())


def create_onnx_sessions(model_dir: Path) -> tuple[list[Any], list[dict[str, Any]], str | None]:
    files = onnx_files(model_dir)
    if not files:
        return [], [], f"No ONNX files found under {model_dir}"
    try:
        import onnxruntime as ort  # type: ignore
    except Exception as exc:  # pragma: no cover - target-dependent
        return [], [], f"onnxruntime is unavailable: {exc}"

    sessions: list[Any] = []
    descriptions: list[dict[str, Any]] = []
    try:
        for path in files:
            session = ort.InferenceSession(str(path))
            sessions.append(session)
            descriptions.append(
                {
                    "path": str(path),
                    "bytes": path.stat().st_size,
                    "providers": session.get_providers(),
                    "inputs": [
                        {"name": item.name, "shape": item.shape, "type": item.type}
                        for item in session.get_inputs()
                    ],
                }
            )
    except Exception as exc:  # pragma: no cover - model/provider-dependent
        return [], descriptions, f"Unable to initialise ONNX session: {exc}"
    return sessions, descriptions, None


def command_model_load(args: argparse.Namespace) -> int:
    model_dir = Path(args.model_dir).resolve()
    output = Path(args.output).resolve()
    started = time.perf_counter()
    sessions, descriptions, error = create_onnx_sessions(model_dir)
    elapsed = time.perf_counter() - started
    payload = {
        "status": "ok" if error is None else "unavailable",
        "elapsed_seconds": elapsed if error is None else None,
        "model_count": len(descriptions),
        "models": descriptions,
        "error": error,
    }
    write_json(output, payload)
    if args.require_inference and error is not None:
        print(error, file=sys.stderr)
        return 2
    # Keep sessions alive until after the timing result has been assembled.
    _ = sessions
    return 0


def numpy_dtype(type_name: str) -> Any:
    import numpy as np  # type: ignore

    mapping = {
        "tensor(float)": np.float32,
        "tensor(float16)": np.float16,
        "tensor(double)": np.float64,
        "tensor(int64)": np.int64,
        "tensor(int32)": np.int32,
        "tensor(uint8)": np.uint8,
    }
    if type_name not in mapping:
        raise RuntimeError(f"Unsupported ONNX input type for replay: {type_name}")
    return mapping[type_name]


def dummy_inputs(session: Any) -> dict[str, Any]:
    import numpy as np  # type: ignore

    feeds: dict[str, Any] = {}
    for item in session.get_inputs():
        shape: list[int] = []
        for dimension in item.shape:
            if isinstance(dimension, int) and dimension > 0:
                shape.append(dimension)
            else:
                shape.append(1)
        elements = math.prod(shape)
        if elements > 50_000_000:
            raise RuntimeError(f"Replay input is unexpectedly large: {item.name} {shape}")
        feeds[item.name] = np.zeros(shape, dtype=numpy_dtype(item.type))
    return feeds


def command_replay(args: argparse.Namespace) -> int:
    source_dir = Path(args.source_dir).resolve()
    model_dir = Path(args.model_dir).resolve()
    destination = safe_generated_directory(Path(args.destination), "replay-run-")
    output = Path(args.output).resolve()
    payloads = load_image_payloads(source_dir, args.memory_limit_mib)
    destination.mkdir(parents=True, exist_ok=False)

    sessions, model_descriptions, inference_error = create_onnx_sessions(model_dir)
    prepared_inputs: list[dict[str, Any]] = []
    if inference_error is None:
        try:
            prepared_inputs = [dummy_inputs(session) for session in sessions]
        except Exception as exc:  # pragma: no cover - model-dependent
            inference_error = str(exc)
            sessions = []
            prepared_inputs = []
    if args.require_inference and inference_error is not None:
        write_json(
            output,
            {
                "status": "error",
                "error": inference_error,
                "inference_enabled": False,
                "model_count": len(model_descriptions),
            },
        )
        remove_generated_directory(destination, "replay-run-")
        print(inference_error, file=sys.stderr)
        return 2

    stop_event = threading.Event()
    review_latencies = LatencySamples(seed=1)
    replay_errors: list[str] = []
    ring_size = max(args.ring_size, 8)

    for index in range(min(ring_size, len(payloads))):
        suffix, data = payloads[index % len(payloads)]
        (destination / f"observation-{index:04d}{suffix}").write_bytes(data)
    fsync_directory(destination)

    def review_worker() -> None:
        cursor = 0
        while not stop_event.is_set():
            try:
                files = sorted(destination.glob("observation-*"))
                if files:
                    target = files[cursor % len(files)]
                    cursor += 1
                    started = time.perf_counter()
                    with target.open("rb", buffering=0) as handle:
                        while handle.read(1024 * 1024):
                            pass
                    review_latencies.add((time.perf_counter() - started) * 1000.0)
                else:
                    time.sleep(0.002)
            except Exception as exc:  # pragma: no cover - device-dependent
                replay_errors.append(f"review: {exc}")
                time.sleep(0.01)

    reviewer = threading.Thread(target=review_worker, name="history-review", daemon=True)
    reviewer.start()

    operation_latencies = LatencySamples(seed=2)
    inference_latencies = LatencySamples(seed=3)
    total_bytes = 0
    operations = 0
    started = time.perf_counter()
    deadline = started + args.duration_seconds
    try:
        while time.perf_counter() < deadline:
            suffix, data = payloads[operations % len(payloads)]
            slot = operations % ring_size
            final_path = destination / f"observation-{slot:04d}{suffix}"
            temporary_path = destination / f"replay-temporary-{slot:04d}.tmp"
            operation_started = time.perf_counter()
            try:
                with temporary_path.open("wb", buffering=0) as handle:
                    handle.write(data)
                    os.fsync(handle.fileno())
                os.replace(temporary_path, final_path)
                if sessions:
                    inference_started = time.perf_counter()
                    for session, feeds in zip(sessions, prepared_inputs):
                        session.run(None, feeds)
                    inference_latencies.add(
                        (time.perf_counter() - inference_started) * 1000.0
                    )
                operation_latencies.add(
                    (time.perf_counter() - operation_started) * 1000.0
                )
                operations += 1
                total_bytes += len(data)
            except Exception as exc:  # pragma: no cover - device-dependent
                replay_errors.append(f"operation: {exc}")
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
                time.sleep(0.01)
        fsync_directory(destination)
    finally:
        stop_event.set()
        reviewer.join(timeout=5)
        elapsed = time.perf_counter() - started
        payload = {
            "status": "ok" if not replay_errors else "completed_with_errors",
            "duration_seconds": elapsed,
            "operations": operations,
            "operations_per_second": operations / elapsed if elapsed else None,
            "total_bytes_written": total_bytes,
            "inference_enabled": bool(sessions),
            "inference_error": inference_error,
            "model_count": len(model_descriptions),
            "operation_p50_ms": percentile(operation_latencies.values, 0.50),
            "operation_p95_ms": percentile(operation_latencies.values, 0.95),
            "inference_p50_ms": percentile(inference_latencies.values, 0.50),
            "inference_p95_ms": percentile(inference_latencies.values, 0.95),
            "review_read_p50_ms": percentile(review_latencies.values, 0.50),
            "review_read_p95_ms": percentile(review_latencies.values, 0.95),
            "operation_sample_count": len(operation_latencies.values),
            "operation_total_count": operation_latencies.seen,
            "inference_sample_count": len(inference_latencies.values),
            "inference_total_count": inference_latencies.seen,
            "review_sample_count": len(review_latencies.values),
            "review_total_count": review_latencies.seen,
            "latency_sampling": "deterministic reservoir capped at 100000 samples per stream",
            "errors": replay_errors[:100],
        }
        write_json(output, payload)
        if not args.keep_data:
            remove_generated_directory(destination, "replay-run-")
    return 0 if not replay_errors else 3


def command_metadata(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    payload = {
        "schema_version": 1,
        "label": args.label,
        "started_at": args.started_at,
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "python": sys.version,
        "target_dir": str(Path(args.target_dir).resolve()),
        "target_mount": args.target_mount,
        "image_dir": str(Path(args.image_dir).resolve()),
        "model_dir": str(Path(args.model_dir).resolve()),
        "runs": args.runs,
        "fio_size_gib": args.fio_size_gib,
        "fio_seconds": args.fio_seconds,
        "image_count": args.image_count,
        "replay_seconds": args.replay_seconds,
        "sustained_seconds": args.sustained_seconds,
        "cache_preparation": args.cache_preparation,
        "notes": args.notes,
    }
    write_json(output, payload)
    return 0


def command_cleanup(args: argparse.Namespace) -> int:
    path = Path(args.path).resolve()
    parent = Path(args.parent).resolve()
    try:
        path.relative_to(parent)
    except ValueError as exc:
        raise RuntimeError(f"Cleanup path is outside its declared parent: {path}") from exc
    remove_generated_directory(path, "session-")
    return 0


def command_hash_tree(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    output = Path(args.output).resolve()
    rows: list[str] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        if path == output:
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        rows.append(f"{digest.hexdigest()}  {path.relative_to(root)}")
    output.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="Copy and fsync an image corpus")
    ingest.add_argument("--source-dir", required=True)
    ingest.add_argument("--destination", required=True)
    ingest.add_argument("--output", required=True)
    ingest.add_argument("--count", type=int, default=1000)
    ingest.add_argument("--memory-limit-mib", type=int, default=512)
    ingest.add_argument("--keep-data", action="store_true")
    ingest.set_defaults(handler=command_ingest)

    model_load = subparsers.add_parser("model-load", help="Initialise every ONNX model")
    model_load.add_argument("--model-dir", required=True)
    model_load.add_argument("--output", required=True)
    model_load.add_argument("--require-inference", action="store_true")
    model_load.set_defaults(handler=command_model_load)

    replay = subparsers.add_parser("replay", help="Concurrent ingest, inference and review replay")
    replay.add_argument("--source-dir", required=True)
    replay.add_argument("--model-dir", required=True)
    replay.add_argument("--destination", required=True)
    replay.add_argument("--output", required=True)
    replay.add_argument("--duration-seconds", type=int, required=True)
    replay.add_argument("--memory-limit-mib", type=int, default=512)
    replay.add_argument("--ring-size", type=int, default=64)
    replay.add_argument("--require-inference", action="store_true")
    replay.add_argument("--keep-data", action="store_true")
    replay.set_defaults(handler=command_replay)

    metadata = subparsers.add_parser("metadata", help="Write a run metadata receipt")
    metadata.add_argument("--output", required=True)
    metadata.add_argument("--label", required=True)
    metadata.add_argument("--started-at", required=True)
    metadata.add_argument("--target-dir", required=True)
    metadata.add_argument("--target-mount", required=True)
    metadata.add_argument("--image-dir", required=True)
    metadata.add_argument("--model-dir", required=True)
    metadata.add_argument("--runs", type=int, required=True)
    metadata.add_argument("--fio-size-gib", type=int, required=True)
    metadata.add_argument("--fio-seconds", type=int, required=True)
    metadata.add_argument("--image-count", type=int, required=True)
    metadata.add_argument("--replay-seconds", type=int, required=True)
    metadata.add_argument("--sustained-seconds", type=int, required=True)
    metadata.add_argument("--cache-preparation", required=True)
    metadata.add_argument("--notes", default="")
    metadata.set_defaults(handler=command_metadata)

    cleanup = subparsers.add_parser("cleanup", help="Remove only a generated benchmark session")
    cleanup.add_argument("--path", required=True)
    cleanup.add_argument("--parent", required=True)
    cleanup.set_defaults(handler=command_cleanup)

    hash_tree = subparsers.add_parser("hash-tree", help="Create SHA-256 receipts")
    hash_tree.add_argument("--root", required=True)
    hash_tree.add_argument("--output", required=True)
    hash_tree.set_defaults(handler=command_hash_tree)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except Exception as exc:
        print(f"benchmark workload failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
