#!/usr/bin/env python3
"""Compare UHS and SD Express benchmark receipts and create Appendix A values."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
from pathlib import Path
from typing import Any, Iterable


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def median(values: Iterable[float | int | None]) -> float | None:
    usable = [float(value) for value in values if value is not None]
    return statistics.median(usable) if usable else None


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


def fio_read_section(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    jobs = payload.get("jobs") or []
    if not jobs:
        raise RuntimeError(f"fio result has no jobs: {path}")
    return jobs[0].get("read") or {}


def fio_bandwidth_mib(path: Path) -> float | None:
    read = fio_read_section(path)
    if read.get("bw_bytes") is not None:
        return float(read["bw_bytes"]) / 1024 / 1024
    if read.get("bw") is not None:
        return float(read["bw"]) / 1024
    return None


def fio_iops(path: Path) -> float | None:
    value = fio_read_section(path).get("iops")
    return float(value) if value is not None else None


def fio_histogram(path: Path) -> dict[int, int]:
    read = fio_read_section(path)
    for key, multiplier in (("clat_ns", 1), ("lat_ns", 1), ("clat_us", 1000), ("clat", 1000)):
        section = read.get(key) or {}
        bins = section.get("bins") or {}
        if bins:
            return {int(float(bucket) * multiplier): int(count) for bucket, count in bins.items()}
    return {}


def histogram_percentile(histogram: dict[int, int], fraction: float) -> float | None:
    total = sum(histogram.values())
    if total <= 0:
        return None
    threshold = math.ceil(total * fraction)
    cumulative = 0
    for value, count in sorted(histogram.items()):
        cumulative += count
        if cumulative >= threshold:
            return float(value)
    return float(max(histogram))


def pooled_fio_p95_ms(paths: list[Path]) -> float | None:
    pooled: dict[int, int] = {}
    for path in paths:
        for bucket, count in fio_histogram(path).items():
            pooled[bucket] = pooled.get(bucket, 0) + count
    value_ns = histogram_percentile(pooled, 0.95)
    if value_ns is not None:
        return value_ns / 1_000_000

    per_run: list[float] = []
    for path in paths:
        read = fio_read_section(path)
        section = read.get("clat_ns") or read.get("lat_ns") or {}
        percentiles = section.get("percentile") or {}
        value = percentiles.get("95.000000")
        if value is not None:
            per_run.append(float(value) / 1_000_000)
    return median(per_run)


def all_json(directory: Path) -> list[dict[str, Any]]:
    return [load_json(path) for path in sorted(directory.glob("*.json"))]


def parse_tegrastats(path: Path) -> dict[str, float | None]:
    if not path.exists():
        return {"peak_temperature_c": None, "median_vdd_in_w": None, "peak_vdd_in_w": None}
    text = path.read_text(encoding="utf-8", errors="replace")
    temperatures = [float(value) for value in re.findall(r"@([0-9]+(?:\.[0-9]+)?)C", text)]
    vdd_in_mw = [float(value) for value in re.findall(r"VDD_IN\s+([0-9]+(?:\.[0-9]+)?)mW", text)]
    return {
        "peak_temperature_c": max(temperatures) if temperatures else None,
        "median_vdd_in_w": median(vdd_in_mw) / 1000 if vdd_in_mw else None,
        "peak_vdd_in_w": max(vdd_in_mw) / 1000 if vdd_in_mw else None,
    }


def summarise(root: Path) -> dict[str, Any]:
    metadata = load_json(root / "metadata.json")
    seq_paths = sorted((root / "fio").glob("sequential-read-*.json"))
    random_paths = sorted((root / "fio").glob("random-read-4k-*.json"))
    model_rows = [row for row in all_json(root / "model-load") if row.get("status") == "ok"]
    ingest_rows = [row for row in all_json(root / "ingest") if row.get("status") == "ok"]
    concurrent = load_json(root / "replay" / "concurrent.json")
    sustained = load_json(root / "replay" / "sustained.json")
    thermal = parse_tegrastats(root / "system" / "tegrastats.log")

    ingest_latencies = [
        float(value)
        for row in ingest_rows
        for value in row.get("operation_latencies_ms", [])
    ]
    return {
        "label": metadata.get("label", root.name),
        "metadata": metadata,
        "sequential_read_mib_s": median(fio_bandwidth_mib(path) for path in seq_paths),
        "random_read_iops": median(fio_iops(path) for path in random_paths),
        "random_read_p95_ms": pooled_fio_p95_ms(random_paths),
        "model_cold_load_s": median(row.get("elapsed_seconds") for row in model_rows),
        "model_load_valid_runs": len(model_rows),
        "ingest_images_s": median(row.get("images_per_second") for row in ingest_rows),
        "ingest_p95_ms": percentile(ingest_latencies, 0.95),
        "ingest_valid_runs": len(ingest_rows),
        "concurrent_operation_p50_ms": concurrent.get("operation_p50_ms"),
        "concurrent_operation_p95_ms": concurrent.get("operation_p95_ms"),
        "concurrent_review_p95_ms": concurrent.get("review_read_p95_ms"),
        "concurrent_errors": len(concurrent.get("errors") or []),
        "concurrent_inference_enabled": concurrent.get("inference_enabled"),
        "sustained_operations_s": sustained.get("operations_per_second"),
        "sustained_operation_p95_ms": sustained.get("operation_p95_ms"),
        "sustained_errors": len(sustained.get("errors") or []),
        "sustained_inference_enabled": sustained.get("inference_enabled"),
        **thermal,
    }


def ratio(candidate: float | None, baseline: float | None) -> float | None:
    if candidate is None or baseline in {None, 0}:
        return None
    return candidate / baseline


def percent_faster_time(candidate: float | None, baseline: float | None) -> float | None:
    if candidate is None or baseline in {None, 0}:
        return None
    return (1.0 - candidate / baseline) * 100.0


def format_value(value: Any, decimals: int = 2) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return f"{float(value):.{decimals}f}"


def write_hashes(root: Path) -> None:
    output = root / "SHA256SUMS"
    rows: list[str] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file() and item != output):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(f"{digest}  {path.relative_to(root)}")
    output.write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uhs", required=True, help="UHS result directory")
    parser.add_argument("--sd-express", required=True, help="SD Express result directory")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    uhs = summarise(Path(args.uhs).resolve())
    sd = summarise(Path(args.sd_express).resolve())
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    seq_ratio = ratio(sd["sequential_read_mib_s"], uhs["sequential_read_mib_s"])
    random_ratio = ratio(sd["random_read_iops"], uhs["random_read_iops"])
    ingest_ratio = ratio(sd["ingest_images_s"], uhs["ingest_images_s"])
    load_improvement = percent_faster_time(sd["model_cold_load_s"], uhs["model_cold_load_s"])

    comparison = {
        "schema_version": 1,
        "uhs": uhs,
        "sd_express": sd,
        "derived": {
            "sequential_speedup": seq_ratio,
            "random_iops_speedup": random_ratio,
            "model_load_percent_faster": load_improvement,
            "ingest_speedup": ingest_ratio,
        },
        "limitations": [
            "The Jetson operating system remained on SD Express in both scenarios.",
            "The UHS and SD Express cards have different capacities and controllers.",
            "The result characterises the complete tested interfaces and configurations, not the SD standards in isolation.",
        ],
    }
    (output_dir / "comparison.json").write_text(
        json.dumps(comparison, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    rows = [
        ("Sequential read", "MiB/s", uhs["sequential_read_mib_s"], sd["sequential_read_mib_s"], f"{format_value(seq_ratio)}x"),
        ("4 KiB random read", "IOPS", uhs["random_read_iops"], sd["random_read_iops"], f"{format_value(random_ratio)}x"),
        ("4 KiB random-read p95", "ms", uhs["random_read_p95_ms"], sd["random_read_p95_ms"], "Lower is better"),
        ("Model cold load", "s", uhs["model_cold_load_s"], sd["model_cold_load_s"], f"{format_value(load_improvement)}% faster"),
        ("1,000-image ingest", "images/s", uhs["ingest_images_s"], sd["ingest_images_s"], f"{format_value(ingest_ratio)}x"),
        ("Concurrent replay p50", "ms", uhs["concurrent_operation_p50_ms"], sd["concurrent_operation_p50_ms"], "Lower is better"),
        ("Concurrent replay p95", "ms", uhs["concurrent_operation_p95_ms"], sd["concurrent_operation_p95_ms"], "Lower is better"),
        ("History-read p95 during replay", "ms", uhs["concurrent_review_p95_ms"], sd["concurrent_review_p95_ms"], "Lower is better"),
        ("Sustained replay", "operations/s", uhs["sustained_operations_s"], sd["sustained_operations_s"], "Higher is better"),
        ("Peak Jetson temperature", "°C", uhs["peak_temperature_c"], sd["peak_temperature_c"], "No thermal throttling"),
        ("Median VDD_IN power", "W", uhs["median_vdd_in_w"], sd["median_vdd_in_w"], "Reported, not optimised"),
    ]

    with (output_dir / "comparison.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Workload", "Metric", "UHS baseline", "SD Express", "Comparison"])
        for name, unit, baseline, candidate, comparison_text in rows:
            writer.writerow([name, unit, format_value(baseline), format_value(candidate), comparison_text])

    lines = [
        "# Appendix A measured results",
        "",
        "| Workload | Metric | UHS baseline | SD Express | Comparison |",
        "|---|---:|---:|---:|---|",
    ]
    for name, unit, baseline, candidate, comparison_text in rows:
        lines.append(
            f"| {name} | {unit} | {format_value(baseline)} | {format_value(candidate)} | {comparison_text} |"
        )
    lines.extend(
        [
            "",
            "The measurements compare the complete tested deployment configurations. The Jetson operating system remained on the SD Express card in both scenarios; application data and model packages were placed first on the externally connected UHS card and then in a dedicated directory on SD Express. The cards differ in capacity and controller, and the UHS result includes its external reader interface.",
            "",
            f"Concurrent replay inference enabled: UHS={format_value(uhs['concurrent_inference_enabled'])}, SD Express={format_value(sd['concurrent_inference_enabled'])}.",
            f"Recorded replay errors: UHS={uhs['concurrent_errors']}, SD Express={sd['concurrent_errors']}; sustained errors: UHS={uhs['sustained_errors']}, SD Express={sd['sustained_errors']}.",
            "",
            "Raw fio, iostat, application replay, power and temperature logs are retained with SHA-256 receipts.",
        ]
    )
    (output_dir / "appendix-a-results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_hashes(output_dir)

    print(output_dir / "appendix-a-results.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
