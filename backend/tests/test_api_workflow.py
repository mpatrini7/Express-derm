import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models import (
    AppCounter,
    LesionAuditEvent,
    LongitudinalReview,
    ModelRun,
    Observation,
    ObservationAcquisition,
)
from app.observation_provenance import CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID


def image_bytes(*, sharp: bool) -> bytes:
    if sharp:
        rows, columns = np.indices((96, 96))
        gray = np.where((rows + columns) % 2 == 0, 80, 180).astype(np.uint8)
    else:
        gray = np.full((96, 96), 120, dtype=np.uint8)
    image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    encoded_ok, encoded = cv2.imencode(".png", image)
    assert encoded_ok
    return encoded.tobytes()


def create_patient_and_lesion(client: TestClient) -> tuple[dict, dict]:
    patient_response = client.post(
        "/api/patients",
        json={"display_name": "Test patient"},
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()
    assert patient["patient_code"] == "ED-0001"

    lesion_response = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={
            "body_part": "torso",
            "x": 0.125,
            "y": 0.75,
            "z": 0.42,
            "label": "Baseline marker",
        },
    )
    assert lesion_response.status_code == 201
    return patient, lesion_response.json()


def upload_observation(
    client: TestClient,
    lesion_id: int,
    *,
    sharp: bool,
    captured_at: str,
) -> dict:
    response = client.post(
        f"/api/lesions/{lesion_id}/observations/upload",
        files={"file": ("microscope.png", image_bytes(sharp=sharp), "image/png")},
        data={
            "notes": "Acceptance-test microscope capture",
            "captured_at": captured_at,
            "microscope_source_confirmed": "true",
        },
    )
    assert response.status_code == 201
    return response.json()


def save_legacy_rejected_observation(
    lesion_id: int,
    *,
    captured_at: str,
) -> dict:
    with SessionLocal() as db:
        observation = Observation(
            lesion_id=lesion_id,
            captured_at=datetime.fromisoformat(captured_at),
            microscope_image_path="legacy/rejected-microscope.png",
            original_filename=None,
            mime_type="image/png",
            device_id=CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
            focus_score=0.0,
            mean_brightness=120.0,
            dark_fraction=0.0,
            bright_fraction=0.0,
            quality_status="rejected",
            quality_reason="Legacy quality-rejected image",
        )
        db.add(observation)
        db.commit()
        db.refresh(observation)
        return {"id": observation.id}


def save_model_run(
    observation_id: int,
    *,
    attention_level: str,
    validation_status: str = "validated",
    domain_status: str = "microscope_validated",
    thresholds_validated: bool = True,
    created_at: datetime,
) -> None:
    with SessionLocal() as db:
        db.add(
            ModelRun(
                observation_id=observation_id,
                model_version="test-model-v1",
                model_hash="test-hash",
                backend="test",
                score=0.62,
                confidence=0.74,
                attention_level=attention_level,
                abstained=attention_level == "uncertain",
                abstention_reason=(
                    "Test abstention" if attention_level == "uncertain" else None
                ),
                validation_status=validation_status,
                domain_status=domain_status,
                latency_ms=10.0,
                result_json=json.dumps(
                    {"thresholds_validated": thresholds_validated}
                ),
                created_at=created_at,
            )
        )
        db.commit()


def test_bodymap_workflow_persists_across_app_restart() -> None:
    with TestClient(app) as first_run:
        patient, lesion = create_patient_and_lesion(first_run)
        accepted = upload_observation(
            first_run,
            lesion["id"],
            sharp=True,
            captured_at="2026-07-22T10:00:00+00:00",
        )
        low_quality_response = first_run.post(
            f"/api/lesions/{lesion['id']}/observations/upload",
            files={
                "file": (
                    "low-quality.png",
                    image_bytes(sharp=False),
                    "image/png",
                )
            },
            data={"microscope_source_confirmed": "true"},
        )

        assert lesion["lesion_code"] == "L-0001"
        assert lesion["body_part"] == "torso"
        assert (lesion["x"], lesion["y"], lesion["z"]) == (0.125, 0.75, 0.42)
        assert accepted["quality_status"] == "accepted"
        assert accepted["quality_score"] == 100.0
        assert low_quality_response.status_code == 201
        low_quality = low_quality_response.json()
        assert low_quality["quality_status"] == "accepted"
        assert low_quality["quality_score"] == 50.0
        assert low_quality["quality_reason"] is None
        assert Path(settings.data_dir / accepted["microscope_image_path"]).is_file()
        assert Path(
            settings.data_dir / low_quality["microscope_image_path"]
        ).is_file()

    with TestClient(app) as restarted:
        patients = restarted.get("/api/patients")
        assert patients.status_code == 200
        assert [item["patient_code"] for item in patients.json()] == ["ED-0001"]
        summary = patients.json()[0]
        assert summary["mapped_lesions"] == 1
        assert summary["documented_lesions"] == 1
        assert summary["observation_count"] == 2
        assert summary["record_status"] == "documented"
        assert summary["last_activity_at"]
        assert summary["next_check_at"] is None

        lesions = restarted.get(f"/api/patients/{patient['id']}/lesions")
        assert lesions.status_code == 200
        lesion_summary = lesions.json()[0]
        assert lesion_summary["id"] == lesion["id"]
        assert lesion_summary["lesion_code"] == lesion["lesion_code"]
        assert lesion_summary["observation_count"] == 2
        assert lesion_summary["accepted_observation_count"] == 2
        assert lesion_summary["latest_accepted_observation_id"] == low_quality["id"]
        assert lesion_summary["risk_status"] == "not_assessed"
        assert lesion_summary["attention_level"] is None
        assert lesion_summary["follow_up_action"] == "evaluate_required"
        assert lesion_summary["next_check_at"] is None

        observations = restarted.get(
            f"/api/lesions/{lesion['id']}/observations"
        )
        assert observations.status_code == 200
        assert [item["id"] for item in observations.json()] == [
            low_quality["id"],
            accepted["id"],
        ]

        image_response = restarted.get(
            f"/media/{accepted['microscope_image_path']}"
        )
        assert image_response.status_code == 200
        assert image_response.headers["content-type"] == "image/png"

        assert restarted.get("/media/express_derm.db").status_code == 404


def test_longitudinal_reviews_are_validated_persisted_and_cascade(
    client: TestClient,
) -> None:
    patient, lesion = create_patient_and_lesion(client)
    baseline = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-20T10:00:00+00:00",
    )
    comparison = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )
    rejected = save_legacy_rejected_observation(
        lesion["id"],
        captured_at="2026-07-23T10:00:00+00:00",
    )

    created_response = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": baseline["id"],
            "comparison_observation_id": comparison["id"],
            "change_flag": "change_observed",
            "notes": "  Border appears different; professional review requested.  ",
        },
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["lesion_id"] == lesion["id"]
    assert created["baseline_observation_id"] == baseline["id"]
    assert created["comparison_observation_id"] == comparison["id"]
    assert created["change_flag"] == "change_observed"
    assert (
        created["notes"]
        == "Border appears different; professional review requested."
    )

    listed_response = client.get(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews"
    )
    assert listed_response.status_code == 200
    assert listed_response.json() == [created]

    reverse_order = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": comparison["id"],
            "comparison_observation_id": baseline["id"],
            "change_flag": "uncertain",
        },
    )
    assert reverse_order.status_code == 422
    assert "must not be newer" in reverse_order.json()["detail"]

    rejected_comparison = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": baseline["id"],
            "comparison_observation_id": rejected["id"],
            "change_flag": "no_visible_change",
        },
    )
    assert rejected_comparison.status_code == 422
    assert "quality-accepted" in rejected_comparison.json()["detail"]

    other_lesion = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={"body_part": "back", "x": 0.2, "y": 1.0, "z": -0.3},
    ).json()
    cross_lesion = client.post(
        f"/api/lesions/{other_lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": baseline["id"],
            "comparison_observation_id": comparison["id"],
            "change_flag": "uncertain",
        },
    )
    assert cross_lesion.status_code == 422
    assert "belong to this lesion" in cross_lesion.json()["detail"]

    same_observation = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": baseline["id"],
            "comparison_observation_id": baseline["id"],
            "change_flag": "uncertain",
        },
    )
    assert same_observation.status_code == 422

    assert client.delete(f"/api/lesions/{lesion['id']}").status_code == 204
    with SessionLocal() as db:
        assert db.query(LongitudinalReview).count() == 0


def test_single_observation_deletion_keeps_lesion_and_other_images(
    client: TestClient,
) -> None:
    patient, lesion = create_patient_and_lesion(client)
    deleted_observation = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-20T10:00:00+00:00",
    )
    retained_observation = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )
    save_model_run(
        deleted_observation["id"],
        attention_level="high",
        created_at=datetime(2026, 7, 20, 10, 5, tzinfo=timezone.utc),
    )
    review_response = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": deleted_observation["id"],
            "comparison_observation_id": retained_observation["id"],
            "change_flag": "uncertain",
        },
    )
    assert review_response.status_code == 201

    deleted_path = settings.data_dir / deleted_observation[
        "microscope_image_path"
    ]
    retained_path = settings.data_dir / retained_observation[
        "microscope_image_path"
    ]
    assert deleted_path.is_file()
    assert retained_path.is_file()

    response = client.delete(
        f"/api/observations/{deleted_observation['id']}"
    )
    assert response.status_code == 204
    assert response.content == b""

    assert deleted_path.exists() is False
    assert retained_path.is_file()
    assert list(retained_path.parent.glob(".*.deleting-*")) == []
    deleted_media = client.get(
        f"/media/{deleted_observation['microscope_image_path']}"
    )
    retained_media = client.get(
        f"/media/{retained_observation['microscope_image_path']}"
    )
    assert deleted_media.status_code == 404
    assert retained_media.status_code == 200
    listed = client.get(
        f"/api/lesions/{lesion['id']}/observations"
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [
        retained_observation["id"]
    ]

    lesion_response = client.get(f"/api/lesions/{lesion['id']}")
    assert lesion_response.status_code == 200
    lesion_summary = lesion_response.json()
    assert lesion_summary["observation_count"] == 1
    assert lesion_summary["accepted_observation_count"] == 1
    assert (
        lesion_summary["latest_accepted_observation_id"]
        == retained_observation["id"]
    )
    assert client.get(f"/api/patients/{patient['id']}").status_code == 200

    with SessionLocal() as db:
        assert db.get(Observation, deleted_observation["id"]) is None
        assert db.get(Observation, retained_observation["id"]) is not None
        assert (
            db.get(ObservationAcquisition, deleted_observation["id"])
            is None
        )
        assert db.query(ModelRun).count() == 0
        assert db.query(LongitudinalReview).count() == 0

    assert (
        client.delete(f"/api/observations/{deleted_observation['id']}").status_code
        == 404
    )


def test_lesion_edits_preserve_identity_and_create_immutable_audit_events(
    client: TestClient,
) -> None:
    patient, lesion = create_patient_and_lesion(client)
    observation = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )

    relocated_response = client.put(
        f"/api/lesions/{lesion['id']}",
        json={
            "body_part": "left-underarm",
            "x": -0.63,
            "y": 1.17,
            "z": 0.2,
            "label": "Corrected marker",
            "notes": "Position checked against the body map.",
            "change_reason": "Initial marker was too low.",
        },
    )
    assert relocated_response.status_code == 200
    relocated = relocated_response.json()
    assert relocated["id"] == lesion["id"]
    assert relocated["lesion_code"] == lesion["lesion_code"]
    assert relocated["created_at"] == lesion["created_at"]
    assert relocated["body_part"] == "left-underarm"
    assert (relocated["x"], relocated["y"], relocated["z"]) == (
        -0.63,
        1.17,
        0.2,
    )
    assert relocated["observation_count"] == 1
    assert relocated["latest_accepted_observation_id"] == observation["id"]

    details_response = client.put(
        f"/api/lesions/{lesion['id']}",
        json={
            "body_part": relocated["body_part"],
            "x": relocated["x"],
            "y": relocated["y"],
            "z": relocated["z"],
            "label": "Axillary marker",
            "notes": relocated["notes"],
        },
    )
    assert details_response.status_code == 200
    assert details_response.json()["label"] == "Axillary marker"

    events_response = client.get(
        f"/api/lesions/{lesion['id']}/audit-events"
    )
    assert events_response.status_code == 200
    events = events_response.json()
    assert [event["event_type"] for event in events] == [
        "details",
        "location",
    ]
    relocation = events[1]
    assert relocation["previous_state"]["body_part"] == "torso"
    assert relocation["current_state"]["body_part"] == "left-underarm"
    assert relocation["previous_state"]["label"] == "Baseline marker"
    assert relocation["current_state"]["label"] == "Corrected marker"
    assert relocation["change_reason"] == "Initial marker was too low."

    no_op = client.put(
        f"/api/lesions/{lesion['id']}",
        json={
            "body_part": relocated["body_part"],
            "x": relocated["x"],
            "y": relocated["y"],
            "z": relocated["z"],
            "label": "Axillary marker",
            "notes": relocated["notes"],
        },
    )
    assert no_op.status_code == 200
    assert len(
        client.get(f"/api/lesions/{lesion['id']}/audit-events").json()
    ) == 2

    assert client.delete(f"/api/lesions/{lesion['id']}").status_code == 204
    with SessionLocal() as db:
        assert db.query(LesionAuditEvent).count() == 0
    assert client.get(f"/api/patients/{patient['id']}").status_code == 200


def test_attention_sets_follow_up_for_validated_and_research_runs(
    client: TestClient,
) -> None:
    patient, lesion = create_patient_and_lesion(client)
    accepted = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )
    save_model_run(
        accepted["id"],
        attention_level="low",
        created_at=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc),
    )

    validated = client.get(f"/api/lesions/{lesion['id']}").json()
    assert validated["risk_status"] == "validated"
    assert validated["attention_level"] == "low"
    assert validated["follow_up_action"] == "monitor_12_months"
    assert validated["next_check_at"].startswith("2027-07-24T12:00:00")

    patient_summary = client.get(f"/api/patients/{patient['id']}").json()
    assert patient_summary["highest_attention_level"] == "low"
    assert patient_summary["attention_status"] == "validated"
    assert patient_summary["next_check_at"].startswith("2027-07-24T12:00:00")

    save_model_run(
        accepted["id"],
        attention_level="high",
        validation_status="research_only",
        domain_status="microscope_validation_pending",
        thresholds_validated=False,
        created_at=datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc),
    )

    experimental = client.get(f"/api/lesions/{lesion['id']}").json()
    assert experimental["risk_status"] == "experimental"
    assert experimental["attention_level"] == "high"
    assert experimental["follow_up_action"] == "professional_review"
    assert experimental["next_check_at"].startswith("2026-07-25T12:00:00")

    patient_summary = client.get(f"/api/patients/{patient['id']}").json()
    assert patient_summary["highest_attention_level"] == "high"
    assert patient_summary["attention_status"] == "experimental"
    assert patient_summary["next_check_at"].startswith("2026-07-25T12:00:00")


def test_ai_is_disabled_and_rejected_images_are_never_evaluated(
    client: TestClient,
) -> None:
    _, lesion = create_patient_and_lesion(client)
    accepted = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )
    rejected = save_legacy_rejected_observation(
        lesion["id"],
        captured_at="2026-07-23T10:00:00+00:00",
    )

    status = client.get("/api/ai/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is False
    assert status.json()["ready"] is False

    rejected_evaluation = client.post(
        f"/api/ai/observations/{rejected['id']}/evaluate"
    )
    assert rejected_evaluation.status_code == 422
    assert "quality-accepted" in rejected_evaluation.json()["detail"]

    disabled_evaluation = client.post(
        f"/api/ai/observations/{accepted['id']}/evaluate"
    )
    assert disabled_evaluation.status_code == 503
    assert disabled_evaluation.json()["detail"] == "AI is disabled"

    evaluations = client.get(
        f"/api/ai/observations/{rejected['id']}/evaluations"
    )
    assert evaluations.status_code == 200
    assert evaluations.json() == []


def test_invalid_upload_is_rejected_without_leaving_a_file(
    client: TestClient,
) -> None:
    _, lesion = create_patient_and_lesion(client)
    files_before = set(settings.image_dir.rglob("*"))

    response = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files={"file": ("not-an-image.png", b"invalid image bytes", "image/png")},
        data={"microscope_source_confirmed": "true"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unable to decode image"
    assert set(settings.image_dir.rglob("*")) == files_before


def test_manual_upload_requires_confirmed_microscope_source(
    client: TestClient,
) -> None:
    _, lesion = create_patient_and_lesion(client)
    files_before = set(settings.image_dir.rglob("*"))
    file_payload = {
        "file": ("microscope.png", image_bytes(sharp=True), "image/png")
    }

    unconfirmed = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files=file_payload,
    )
    assert unconfirmed.status_code == 422
    assert "Confirm that the uploaded file" in unconfirmed.json()["detail"]
    assert set(settings.image_dir.rglob("*")) == files_before

    confirmed_microscope = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files=file_payload,
        data={"microscope_source_confirmed": "true"},
    )
    assert confirmed_microscope.status_code == 201
    observation = confirmed_microscope.json()
    assert (
        observation["device_id"]
        == "manual-upload:usb-microscope-confirmed"
    )
    assert (
        observation["acquisition"]["device_path"]
        == "manual-upload:usb-microscope-confirmed"
    )
    assert (
        observation["acquisition"]["device_name"]
        == "Manual USB microscope upload (operator confirmed)"
    )
    files_after_confirmed_upload = set(settings.image_dir.rglob("*"))

    body_photo = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files=file_payload,
        data={"source_type": "body_photo"},
    )
    assert body_photo.status_code == 422
    assert "Body photos" in body_photo.json()["detail"]

    other_image = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files=file_payload,
        data={"source_type": "other_image"},
    )
    assert other_image.status_code == 422
    assert "other images" in other_image.json()["detail"]

    invalid_type = client.post(
        f"/api/lesions/{lesion['id']}/observations/upload",
        files=file_payload,
        data={"source_type": "drone"},
    )
    assert invalid_type.status_code == 422
    assert "Only a USB-microscope image" in invalid_type.json()["detail"]
    assert set(settings.image_dir.rglob("*")) == files_after_confirmed_upload


def test_legacy_unconfirmed_upload_is_excluded_from_comparison_and_ai(
    client: TestClient,
    monkeypatch,
) -> None:
    _, lesion = create_patient_and_lesion(client)
    confirmed = upload_observation(
        client,
        lesion["id"],
        sharp=True,
        captured_at="2026-07-23T10:00:00+00:00",
    )
    with SessionLocal() as db:
        legacy = Observation(
            lesion_id=lesion["id"],
            captured_at=datetime(2026, 7, 22, 10, tzinfo=timezone.utc),
            microscope_image_path="legacy/manual-upload.png",
            original_filename="legacy.png",
            mime_type="image/png",
            device_id="upload",
            quality_status="accepted",
        )
        db.add(legacy)
        db.commit()
        legacy_id = legacy.id

    comparison = client.post(
        f"/api/lesions/{lesion['id']}/longitudinal-reviews",
        json={
            "baseline_observation_id": legacy_id,
            "comparison_observation_id": confirmed["id"],
            "change_flag": "uncertain",
            "notes": None,
        },
    )
    assert comparison.status_code == 422
    assert "source-confirmed" in comparison.json()["detail"]

    monkeypatch.setattr(settings, "ai_enabled", True)
    evaluation = client.post(
        f"/api/ai/observations/{legacy_id}/evaluate"
    )
    assert evaluation.status_code == 422
    assert "source-confirmed" in evaluation.json()["detail"]
    assert client.get(
        f"/api/ai/observations/{legacy_id}/evaluations"
    ).json() == []


def test_patient_codes_are_progressive_and_not_reused(client: TestClient) -> None:
    first = client.post("/api/patients", json={"display_name": "First"})
    second = client.post("/api/patients", json={"display_name": "Second"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["patient_code"] == "ED-0001"
    assert second.json()["patient_code"] == "ED-0002"

    assert client.delete(f"/api/patients/{second.json()['id']}").status_code == 204

    third = client.post("/api/patients", json={"display_name": "Third"})
    assert third.status_code == 201
    assert third.json()["patient_code"] == "ED-0003"

    lesion = client.post(
        f"/api/patients/{third.json()['id']}/lesions",
        json={"body_part": "left-underarm", "x": -0.63, "y": 1.17, "z": 0.2},
    )
    assert lesion.status_code == 201

    summaries = client.get("/api/patients").json()
    third_summary = next(item for item in summaries if item["id"] == third.json()["id"])
    assert third_summary["mapped_lesions"] == 1
    assert third_summary["documented_lesions"] == 0
    assert third_summary["record_status"] == "needs_capture"


def test_lesion_codes_are_progressive_and_not_reused(client: TestClient) -> None:
    patient, first = create_patient_and_lesion(client)
    assert first["lesion_code"] == "L-0001"

    second = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={"body_part": "left-arm", "x": -0.8, "y": 1.0, "z": 0.1},
    )
    assert second.status_code == 201
    assert second.json()["lesion_code"] == "L-0002"

    counter_name = f"lesion_code:{patient['patient_code']}"
    with SessionLocal() as db:
        counter = db.get(AppCounter, counter_name)
        assert counter is not None
        assert counter.value == 2
        db.delete(counter)
        db.commit()

    assert client.delete(f"/api/lesions/{second.json()['id']}").status_code == 204

    with SessionLocal() as db:
        restored_counter = db.get(AppCounter, counter_name)
        assert restored_counter is not None
        assert restored_counter.value == 2

    third = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={"body_part": "right-arm", "x": 0.8, "y": 1.0, "z": 0.1},
    )
    assert third.status_code == 201
    assert third.json()["lesion_code"] == "L-0003"


def test_lesion_code_sequence_is_scoped_by_immutable_patient_code(
    client: TestClient,
) -> None:
    deleted_patient, _ = create_patient_and_lesion(client)
    assert client.delete(
        f"/api/patients/{deleted_patient['id']}"
    ).status_code == 204

    replacement_patient = client.post(
        "/api/patients",
        json={"display_name": "Replacement patient"},
    ).json()
    assert replacement_patient["id"] == deleted_patient["id"]
    replacement_lesion = client.post(
        f"/api/patients/{replacement_patient['id']}/lesions",
        json={"body_part": "chest", "x": 0.1, "y": 1.1, "z": 0.3},
    )
    assert replacement_lesion.status_code == 201
    assert replacement_lesion.json()["lesion_code"] == "L-0001"


def test_patient_profile_can_be_created_and_updated_without_changing_code(
    client: TestClient,
) -> None:
    created_response = client.post(
        "/api/patients",
        json={
            "display_name": "  Study alias  ",
            "birth_year": 1985,
            "notes": "  Non-identifying operator note.  ",
        },
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["patient_code"] == "ED-0001"
    assert created["display_name"] == "Study alias"
    assert created["birth_year"] == 1985
    assert created["notes"] == "Non-identifying operator note."

    updated_response = client.put(
        f"/api/patients/{created['id']}",
        json={
            "display_name": "Updated alias",
            "birth_year": 1986,
            "notes": "Follow-up note.",
        },
    )
    assert updated_response.status_code == 200
    updated = updated_response.json()
    assert updated["id"] == created["id"]
    assert updated["patient_code"] == created["patient_code"]
    assert updated["display_name"] == "Updated alias"
    assert updated["birth_year"] == 1986
    assert updated["notes"] == "Follow-up note."

    no_op = client.put(
        f"/api/patients/{created['id']}",
        json={
            "display_name": updated["display_name"],
            "birth_year": updated["birth_year"],
            "notes": updated["notes"],
        },
    )
    assert no_op.status_code == 200
    assert no_op.json()["patient_code"] == created["patient_code"]

    invalid_year = client.put(
        f"/api/patients/{created['id']}",
        json={"display_name": "Alias", "birth_year": 1899},
    )
    assert invalid_year.status_code == 422

    missing = client.put(
        "/api/patients/999999",
        json={"display_name": "Missing"},
    )
    assert missing.status_code == 404


def test_lesion_and_patient_deletion_remove_history_and_images(
    client: TestClient,
) -> None:
    patient, first_lesion = create_patient_and_lesion(client)
    first_observation = upload_observation(
        client,
        first_lesion["id"],
        sharp=True,
        captured_at="2026-07-22T10:00:00+00:00",
    )
    first_image = settings.data_dir / first_observation["microscope_image_path"]
    assert first_image.is_file()

    second_response = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={
            "body_part": "left-underarm",
            "x": -0.63,
            "y": 1.17,
            "z": 0.2,
        },
    )
    assert second_response.status_code == 201
    second_lesion = second_response.json()
    assert second_lesion["lesion_code"] == "L-0002"

    deleted_lesion = client.delete(f"/api/lesions/{first_lesion['id']}")
    assert deleted_lesion.status_code == 204
    assert deleted_lesion.content == b""
    assert not first_image.exists()
    assert client.get(f"/api/lesions/{first_lesion['id']}").status_code == 404

    third_response = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={"body_part": "upper-torso", "x": 0.1, "y": 1.1, "z": 0.35},
    )
    assert third_response.status_code == 201
    assert third_response.json()["lesion_code"] == "L-0003"

    second_observation = upload_observation(
        client,
        second_lesion["id"],
        sharp=True,
        captured_at="2026-07-23T10:00:00+00:00",
    )
    second_image = settings.data_dir / second_observation["microscope_image_path"]
    assert second_image.is_file()

    deleted_patient = client.delete(f"/api/patients/{patient['id']}")
    assert deleted_patient.status_code == 204
    assert deleted_patient.content == b""
    assert not second_image.exists()
    assert not (settings.image_dir / str(patient["id"])).exists()
    assert client.get(f"/api/patients/{patient['id']}").status_code == 404
    assert client.get(f"/api/lesions/{second_lesion['id']}").status_code == 404
    assert client.get("/api/patients").json() == []
