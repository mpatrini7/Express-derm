from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

import cv2

from app.decision_policy import classify_binary_score
from app.quality import QualityThresholds, analyze_image


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ROOT = ROOT / "demo_images"
MODEL_PATH = ROOT / "models" / "express-derm-1" / "model.onnx"
EXPECTED_ROLE_COUNTS = {
    "low": 10,
    "inconclusive_benign": 5,
    "inconclusive_melanoma": 5,
    "high": 10,
}
EXPECTED_RESULT_COUNTS = {"Low": 10, "Inconclusive": 10, "High": 10}
EXPECTED_CATEGORY_COUNTS = {
    "01_low_benigni": 10,
    "02_inconclusive_misti": 10,
    "03_high_melanomi": 10,
}
EXPECTED_MODEL_SHA256 = (
    "f47087ac224641740f7af18b4d112b460d7905cd37dc90f0b9fce707a5a106be"
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_result_for_score(
    score: float, *, low_threshold: float, high_threshold: float
) -> str:
    decision = classify_binary_score(
        score,
        low_threshold=low_threshold,
        high_threshold=high_threshold,
    )
    return {
        "low": "Low",
        "uncertain": "Inconclusive",
        "high": "High",
    }[decision.level]


def test_challenge_sample_is_complete_and_attributed() -> None:
    manifest_path = SAMPLE_ROOT / "manifest.csv"
    with manifest_path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    receipt = json.loads(
        (SAMPLE_ROOT / "selection_receipt.json").read_text(encoding="utf-8")
    )
    metadata = json.loads(
        (SAMPLE_ROOT / "metadata_source_snapshot.json").read_text(
            encoding="utf-8"
        )
    )

    assert len(rows) == 30
    assert len(metadata["records"]) == 30
    assert Counter(row["fixture_role"] for row in rows) == EXPECTED_ROLE_COUNTS
    assert (
        Counter(row["expected_app_result"] for row in rows)
        == EXPECTED_RESULT_COUNTS
    )
    assert Counter(row["category"] for row in rows) == EXPECTED_CATEGORY_COUNTS
    assert len({row["isic_id"] for row in rows}) == 30
    assert len({row["patient_id"] for row in rows}) == 30
    assert len({row["lesion_id"] for row in rows}) == 30
    assert len({row["fixture_sha256"] for row in rows}) == 30
    assert len(list(SAMPLE_ROOT.rglob("*.jpg"))) == 30
    assert (SAMPLE_ROOT / "README.md").is_file()

    assert receipt["integrity"] == {
        "image_count": 30,
        "manifest_sha256": file_sha256(manifest_path),
        "original_demo_overlap_count": 0,
        "training_overlap_count": 0,
        "unique_lesion_count": 30,
        "unique_patient_count": 30,
    }
    assert receipt["selected_counts"] == EXPECTED_ROLE_COUNTS
    assert receipt["model"]["onnx_sha256"] == EXPECTED_MODEL_SHA256
    assert receipt["model"]["validation_status"] == "research_only"
    assert receipt["model"]["domain_status"] == "microscope_validation_pending"
    assert receipt["model"]["thresholds_validated"] is False
    assert file_sha256(MODEL_PATH) == EXPECTED_MODEL_SHA256


def test_challenge_images_pass_quality_and_record_stable_outputs() -> None:
    with (SAMPLE_ROOT / "manifest.csv").open(
        newline="", encoding="utf-8"
    ) as source:
        rows = list(csv.DictReader(source))
    metadata = json.loads(
        (SAMPLE_ROOT / "metadata_source_snapshot.json").read_text(
            encoding="utf-8"
        )
    )
    metadata_by_id = {
        record["source_manifest_record"]["image_name"]: record
        for record in metadata["records"]
    }

    for row in rows:
        relative_path = Path(row["filename"])
        assert not relative_path.is_absolute()
        assert ".." not in relative_path.parts
        assert relative_path.parts[0] == row["category"]
        assert relative_path.stem == row["isic_id"]

        image_path = SAMPLE_ROOT / relative_path
        assert image_path.is_file()
        assert not image_path.is_symlink()
        assert file_sha256(image_path) == row["fixture_sha256"]

        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        assert image is not None
        assert image.shape[1] == int(row["pixels_x"])
        assert image.shape[0] == int(row["pixels_y"])
        assert max(image.shape[:2]) == 1024
        quality = analyze_image(
            image,
            QualityThresholds(
                focus=float(row["quality_threshold_focus"]),
                min_brightness=float(row["quality_threshold_min_brightness"]),
                max_brightness=float(row["quality_threshold_max_brightness"]),
            ),
        )
        assert quality.accepted is True
        assert quality.reason is None

        assert row["license"] == "CC-0"
        assert row["license_url"] == (
            "https://creativecommons.org/publicdomain/zero/1.0/"
        )
        assert row["diagnosis_confirm_type"] == "histopathology"
        assert row["image_type"] == "dermoscopic"
        assert row["model_name"] == "express-derm"
        assert row["model_sha256"] == EXPECTED_MODEL_SHA256
        assert row["decision_policy_version"] == "binary-extremes-v1"
        assert row["selected_output_aware"] == "True"
        assert row["intended_use"] == "challenge_demo_fixture_not_validation"

        low_threshold = float(row["low_threshold"])
        high_threshold = float(row["high_threshold"])
        orientation_scores = json.loads(row["orientation_scores_json"])
        assert len(orientation_scores) == 4
        assert {
            expected_result_for_score(
                score,
                low_threshold=low_threshold,
                high_threshold=high_threshold,
            )
            for score in orientation_scores
        } == {row["expected_app_result"]}
        assert float(row["minimum_boundary_margin"]) >= 0.003

        snapshot = metadata_by_id[row["isic_id"]]
        source_record = snapshot["source_manifest_record"]
        assert snapshot["source_dataset"] == row["source_dataset"]
        assert source_record["patient_id"] == row["patient_id"]
        assert source_record["lesion_id"] == row["lesion_id"]
        assert source_record["target"] == row["ground_truth_target"]
        assert source_record["copyright_license"] == row["license"]
        assert source_record["attribution"] == row["attribution"]
        assert source_record["sha256"] == row["source_sha256"]
        assert source_record["full_image_url"] == row["source_download_url"]
