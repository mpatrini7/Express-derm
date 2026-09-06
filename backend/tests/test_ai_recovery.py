from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.ai_evaluation import evaluate_pending_observations
from app.ai_service import Prediction, ai_service
from app.config import settings
from app.database import SessionLocal
from app.decision_policy import DECISION_POLICY_VERSION
from app.models import (
    Lesion,
    ModelRun,
    Observation,
    ObservationAcquisition,
    Patient,
)
from app.observation_provenance import MANUAL_UPLOAD_BODY_PHOTO_DEVICE_ID


def _observation(
    lesion: Lesion,
    *,
    captured_at: datetime,
    device_id: str = "/dev/video0",
    protocol_status: str = "validated",
) -> Observation:
    return Observation(
        lesion=lesion,
        captured_at=captured_at,
        microscope_image_path="images/recovery-fixture.png",
        mime_type="image/png",
        device_id=device_id,
        focus_score=0.0,
        mean_brightness=120.0,
        dark_fraction=0.0,
        bright_fraction=0.0,
        quality_score=50.0,
        quality_status="accepted",
        quality_reason="Image is not sufficiently sharp",
        acquisition=ObservationAcquisition(
            protocol_revision=1,
            protocol_name="Recovery test protocol",
            protocol_status=protocol_status,
            device_path=device_id,
            device_name="Recovery test microscope",
            width=640,
            height=480,
            pixel_format="MJPG",
            orientation="cranial_up",
            illumination="integrated_led",
            focus_threshold=80.0,
            min_brightness=45.0,
            max_brightness=220.0,
            thresholds_status="calibrated",
        ),
    )


def _existing_run(observation: Observation) -> ModelRun:
    return ModelRun(
        observation=observation,
        model_version="recovery-model-v1",
        model_hash="fixture-hash",
        backend="test",
        score=0.7,
        confidence=0.4,
        attention_level="intermediate",
        abstained=False,
        validation_status="research_only",
        domain_status="microscope_validation_pending",
        latency_ms=1.0,
        result_json=(
            '{"decision_policy_version": "'
            + DECISION_POLICY_VERSION
            + '"}'
        ),
    )


def _legacy_policy_run(observation: Observation) -> ModelRun:
    run = _existing_run(observation)
    run.result_json = "{}"
    return run


def test_startup_recovery_evaluates_latest_eligible_observation_once(
    monkeypatch,
) -> None:
    first = datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc)
    second = datetime(2026, 8, 21, 10, 0, tzinfo=timezone.utc)

    with SessionLocal() as db:
        patient = Patient(patient_code="ED-RECOVERY")
        latest_candidate_lesion = Lesion(
            patient=patient,
            lesion_code="L-0001",
            body_part="torso",
            x=0.1,
            y=0.2,
            z=0.3,
        )
        old_candidate = _observation(
            latest_candidate_lesion,
            captured_at=first,
        )
        latest_candidate = _observation(
            latest_candidate_lesion,
            captured_at=second,
        )

        completed_lesion = Lesion(
            patient=patient,
            lesion_code="L-0002",
            body_part="arm",
            x=0.2,
            y=0.3,
            z=0.4,
        )
        completed_candidate = _observation(
            completed_lesion,
            captured_at=second,
        )
        completed_candidate.model_runs.append(
            _existing_run(completed_candidate)
        )

        legacy_policy_lesion = Lesion(
            patient=patient,
            lesion_code="L-0005",
            body_part="shoulder",
            x=0.5,
            y=0.6,
            z=0.7,
        )
        legacy_policy_candidate = _observation(
            legacy_policy_lesion,
            captured_at=second,
        )
        legacy_policy_candidate.model_runs.append(
            _legacy_policy_run(legacy_policy_candidate)
        )

        ineligible_lesion = Lesion(
            patient=patient,
            lesion_code="L-0003",
            body_part="leg",
            x=0.3,
            y=0.4,
            z=0.5,
        )
        _observation(
            ineligible_lesion,
            captured_at=second,
            device_id=MANUAL_UPLOAD_BODY_PHOTO_DEVICE_ID,
        )

        fallback_lesion = Lesion(
            patient=patient,
            lesion_code="L-0004",
            body_part="back",
            x=0.4,
            y=0.5,
            z=0.6,
        )
        fallback_candidate = _observation(
            fallback_lesion,
            captured_at=first,
        )
        latest_fallback_candidate = _observation(
            fallback_lesion,
            captured_at=second,
            protocol_status="provisional",
        )

        db.add(patient)
        db.commit()
        expected_evaluations = {
            latest_candidate.id,
            latest_fallback_candidate.id,
            legacy_policy_candidate.id,
        }
        old_candidate_id = old_candidate.id
        fallback_candidate_id = fallback_candidate.id

    evaluated_observation_ids: list[int] = []
    active_model_hash = ["fixture-hash"]

    def fake_status() -> dict:
        return {
            "enabled": True,
            "ready": True,
            "model_version": "recovery-model-v1",
            "model_hash": active_model_hash[0],
            "reason": None,
        }

    def fake_predict(*args, **kwargs) -> Prediction:
        del args
        evaluated_observation_ids.append(kwargs["observation_id"])
        return Prediction(
            model_version="recovery-model-v1",
            model_hash=active_model_hash[0],
            backend="test",
            score=0.8,
            attention_level="high",
            abstained=False,
            abstention_reason=None,
            validation_status="research_only",
            domain_status="microscope_validation_pending",
            latency_ms=2.0,
            payload={
                "thresholds_validated": False,
                "decision_policy_version": DECISION_POLICY_VERSION,
            },
        )

    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(ai_service, "status", fake_status)
    monkeypatch.setattr(ai_service, "predict", fake_predict)

    first_report = evaluate_pending_observations()
    second_report = evaluate_pending_observations()

    assert first_report.evaluated == 3
    assert first_report.already_evaluated == 1
    assert first_report.failed == 0
    assert set(evaluated_observation_ids) == expected_evaluations
    assert second_report.evaluated == 0
    assert second_report.already_evaluated == 4
    assert len(evaluated_observation_ids) == 3

    active_model_hash[0] = "replacement-fixture-hash"
    replacement_report = evaluate_pending_observations()
    assert replacement_report.evaluated == 4
    assert replacement_report.already_evaluated == 0
    assert replacement_report.failed == 0

    with SessionLocal() as db:
        assert db.scalar(select(func.count(ModelRun.id))) == 9
        scored_run = db.scalar(
            select(ModelRun)
            .where(ModelRun.model_hash == "replacement-fixture-hash")
            .order_by(ModelRun.id.asc())
        )
        assert scored_run is not None
        quality_receipt = json.loads(scored_run.result_json)["image_quality"]
        assert quality_receipt["score_percent"] == 50.0
        assert quality_receipt["score_version"] == (
            "focus-exposure-clipping-v1"
        )
        assert quality_receipt["warnings"] == (
            "Image is not sufficiently sharp"
        )
        assert db.scalar(
            select(func.count(ModelRun.id)).where(
                ModelRun.observation_id == old_candidate_id
            )
        ) == 0
        assert db.scalar(
            select(func.count(ModelRun.id)).where(
                ModelRun.observation_id == fallback_candidate_id
            )
        ) == 0
