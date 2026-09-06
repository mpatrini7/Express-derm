from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.ai_service import Prediction, ai_service
from app.camera import MOCK_DEVICE_PATH
from app.config import settings
from app.database import SessionLocal
from app.decision_policy import DECISION_POLICY_VERSION
from app.models import (
    Lesion,
    Observation,
    ObservationAcquisition,
    Patient,
)
from app.observation_provenance import (
    CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
)
from app.routers.ai import evaluate_observation


def reference_image_bytes() -> bytes:
    rows, columns = np.indices((96, 96))
    gray = np.where((rows + columns) % 2 == 0, 70, 190).astype(np.uint8)
    image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    encoded_ok, encoded = cv2.imencode(".png", image)
    assert encoded_ok
    return encoded.tobytes()


def create_lesion(client: TestClient) -> dict:
    patient_response = client.post(
        "/api/patients",
        json={"display_name": "Protocol test patient"},
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()
    lesion_response = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={
            "body_part": "torso",
            "x": 0.2,
            "y": 0.3,
            "z": 0.4,
            "label": "Protocol test lesion",
        },
    )
    assert lesion_response.status_code == 201
    return lesion_response.json()


def setup_payload(
    *,
    magnification_x: float = 200,
    thresholds_status: str = "provisional",
) -> dict:
    return {
        "name": "Ninyoon fixed setup",
        "magnification_x": magnification_x,
        "orientation": "cranial_up",
        "spacer_id": "spacer-01",
        "illumination": "integrated_led",
        "exposure": -5,
        "gain": 12,
        "white_balance": 4600,
        "focus_threshold": 80,
        "min_brightness": 45,
        "max_brightness": 220,
        "thresholds_status": thresholds_status,
    }


def upload_reference(
    client: TestClient,
    reference_type: str,
) -> dict:
    response = client.post(
        f"/api/acquisition/setup/references/{reference_type}",
        files={
            "file": (
                f"{reference_type}.png",
                reference_image_bytes(),
                "image/png",
            )
        },
    )
    assert response.status_code == 200
    return response.json()


def test_protocol_revisions_and_observation_snapshot_are_immutable(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "camera_mock", True)

    default_response = client.get("/api/acquisition/setup")
    assert default_response.status_code == 200
    default = default_response.json()
    assert default["revision"] == 1
    assert default["capture_ready"] is False
    assert default["protocol_status"] == "incomplete"

    configured_response = client.put(
        "/api/acquisition/setup",
        json=setup_payload(),
    )
    assert configured_response.status_code == 200
    configured = configured_response.json()
    assert configured["revision"] == 2
    assert configured["capture_ready"] is True
    assert configured["protocol_status"] == "reference_pending"

    premature_calibration = client.put(
        "/api/acquisition/setup",
        json=setup_payload(thresholds_status="calibrated"),
    )
    assert premature_calibration.status_code == 422

    scale_setup = upload_reference(client, "scale")
    assert scale_setup["revision"] == 3
    assert Path(
        settings.data_dir / scale_setup["scale_reference_path"]
    ).is_file()

    color_setup = upload_reference(client, "color")
    assert color_setup["revision"] == 4
    assert color_setup["protocol_status"] == "provisional"
    assert Path(
        settings.data_dir / color_setup["color_reference_path"]
    ).is_file()

    validated_response = client.put(
        "/api/acquisition/setup",
        json=setup_payload(thresholds_status="calibrated"),
    )
    assert validated_response.status_code == 200
    validated = validated_response.json()
    assert validated["revision"] == 5
    assert validated["protocol_status"] == "validated"

    lesion = create_lesion(client)
    snapshot_response = client.post(
        f"/api/camera/snapshot/{lesion['id']}",
        params={
            "device": MOCK_DEVICE_PATH,
            "width": 640,
            "height": 480,
            "pixel_format": "MJPG",
            "frame_rate": 30,
        },
    )
    assert snapshot_response.status_code == 201
    acquisition = snapshot_response.json()["acquisition"]
    assert acquisition["protocol_revision"] == 5
    assert acquisition["protocol_status"] == "validated"
    assert acquisition["magnification_x"] == 200
    assert acquisition["spacer_id"] == "spacer-01"
    assert acquisition["width"] == 640
    assert acquisition["height"] == 480
    assert acquisition["frame_rate"] == 30
    assert acquisition["thresholds_status"] == "calibrated"

    replaced_scale = upload_reference(client, "scale")
    assert replaced_scale["revision"] == 6
    assert replaced_scale["protocol_status"] == "provisional"
    assert (
        replaced_scale["scale_reference_path"]
        != acquisition["scale_reference_path"]
    )
    assert Path(
        settings.data_dir / acquisition["scale_reference_path"]
    ).is_file()

    changed_response = client.put(
        "/api/acquisition/setup",
        json=setup_payload(magnification_x=300),
    )
    assert changed_response.status_code == 200
    changed = changed_response.json()
    assert changed["revision"] == 7
    assert changed["protocol_status"] == "reference_pending"
    assert changed["thresholds_status"] == "provisional"
    assert changed["scale_reference_path"] is None
    assert changed["color_reference_path"] is None

    observations_response = client.get(
        f"/api/lesions/{lesion['id']}/observations"
    )
    unchanged = observations_response.json()[0]["acquisition"]
    assert unchanged["protocol_revision"] == 5
    assert unchanged["magnification_x"] == 200
    assert Path(
        settings.data_dir / unchanged["scale_reference_path"]
    ).is_file()
    assert Path(
        settings.data_dir / unchanged["color_reference_path"]
    ).is_file()


def test_ai_accepts_incomplete_acquisition_protocol(
    monkeypatch,
) -> None:
    with SessionLocal() as db:
        patient = Patient(patient_code="ED-PROTOCOL-FREE")
        lesion = Lesion(
            patient=patient,
            lesion_code="L-0001",
            body_part="torso",
            x=0.2,
            y=0.3,
            z=0.4,
        )
        observation = Observation(
            lesion=lesion,
            microscope_image_path="images/protocol-free.png",
            mime_type="image/png",
            device_id=CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
            quality_status="accepted",
            acquisition=ObservationAcquisition(
                protocol_revision=1,
                protocol_name="Incomplete protocol",
                protocol_status="incomplete",
                device_path=CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
                device_name="Confirmed USB microscope upload",
                width=96,
                height=96,
                pixel_format="image/png",
                orientation="cranial_up",
                illumination="integrated_led",
                focus_threshold=80,
                min_brightness=45,
                max_brightness=220,
                thresholds_status="provisional",
            ),
        )
        db.add(patient)
        db.commit()
        observation_id = observation.id

        received_protocol_statuses: list[str] = []

        def fake_predict(*args, **kwargs) -> Prediction:
            del args
            received_protocol_statuses.append(
                kwargs["acquisition_protocol_status"]
            )
            return Prediction(
                model_version="protocol-independent-v1",
                model_hash="fixture-hash",
                backend="test",
                score=0.6,
                attention_level="intermediate",
                abstained=False,
                abstention_reason=None,
                validation_status="research_only",
                domain_status="microscope_validation_pending",
                latency_ms=1.0,
                payload={
                    "thresholds_validated": False,
                    "decision_policy_version": DECISION_POLICY_VERSION,
                },
            )

        monkeypatch.setattr(settings, "ai_enabled", True)
        monkeypatch.setattr(ai_service, "predict", fake_predict)
        run = evaluate_observation(observation_id, db)

        assert run.observation_id == observation_id
        assert received_protocol_statuses == ["incomplete"]
