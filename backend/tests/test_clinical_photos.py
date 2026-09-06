from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.clinical_photo_detection import detect_lesion_candidates
from app.config import settings
from app.database import SessionLocal
from app.models import ClinicalPhotoCandidate


def multi_lesion_image() -> bytes:
    image = np.full((720, 1280, 3), (165, 190, 215), dtype=np.uint8)
    cv2.circle(image, (280, 230), 34, (48, 60, 72), -1)
    cv2.circle(image, (650, 410), 46, (58, 68, 83), -1)
    cv2.ellipse(image, (1010, 270), (28, 39), 12, 0, 360, (52, 64, 78), -1)
    encoded_ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 96])
    assert encoded_ok
    return encoded.tobytes()


def black_image() -> bytes:
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    encoded_ok, encoded = cv2.imencode(".jpg", image)
    assert encoded_ok
    return encoded.tobytes()


def create_patient(client: TestClient) -> dict:
    response = client.post("/api/patients", json={"display_name": "Photo patient"})
    assert response.status_code == 201
    return response.json()


def test_detector_proposes_separate_regions() -> None:
    encoded = np.frombuffer(multi_lesion_image(), dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    regions = detect_lesion_candidates(image)
    assert len(regions) == 3
    centers = sorted((item.x + item.width // 2, item.y + item.height // 2) for item in regions)
    assert centers[0][0] < 400
    assert 500 < centers[1][0] < 800
    assert centers[2][0] > 900


def test_multi_lesion_photo_creates_pending_candidates_then_assigns_one(
    client: TestClient,
) -> None:
    patient = create_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/clinical-photos",
        files={"file": ("skin-4k.jpg", multi_lesion_image(), "image/jpeg")},
        data={"source_confirmed": "true"},
    )
    assert response.status_code == 201, response.text
    photo = response.json()
    assert (photo["width"], photo["height"]) == (1280, 720)
    assert 0 <= photo["quality_score"] <= 100
    assert len(photo["candidates"]) == 3
    assert Path(settings.data_dir / photo["image_path"]).is_file()
    for candidate in photo["candidates"]:
        assert candidate["status"] == "pending"
        assert 0 <= candidate["quality_score"] <= 100
        assert Path(settings.data_dir / candidate["crop_image_path"]).is_file()

    pending = client.get(
        f"/api/patients/{patient['id']}/clinical-photo-candidates"
    )
    assert pending.status_code == 200
    assert len(pending.json()) == 3

    quality_by_id = {
        candidate["id"]: quality
        for candidate, quality in zip(
            photo["candidates"],
            (61.0, 94.0, 78.0),
            strict=True,
        )
    }
    with SessionLocal() as db:
        for candidate_id, quality in quality_by_id.items():
            candidate = db.get(ClinicalPhotoCandidate, candidate_id)
            assert candidate is not None
            candidate.quality_score = quality
        db.commit()
    pending = client.get(
        f"/api/patients/{patient['id']}/clinical-photo-candidates"
    )
    assert [candidate["quality_score"] for candidate in pending.json()] == [
        94.0,
        78.0,
        61.0,
    ]

    chosen = pending.json()[0]
    assignment = client.post(
        f"/api/clinical-photo-candidates/{chosen['id']}/assign",
        json={
            "body_part": "chest",
            "x": 0.12,
            "y": 1.18,
            "z": 0.31,
            "label": "Upper chest photo candidate",
        },
    )
    assert assignment.status_code == 201, assignment.text
    payload = assignment.json()
    assert payload["candidate"]["status"] == "assigned"
    assert payload["lesion"]["lesion_code"] == "L-0001"
    assert payload["lesion"]["body_part"] == "chest"
    assert payload["observation"]["quality_status"] == "accepted"
    assert payload["observation"]["quality_score"] == chosen["quality_score"]
    assert payload["observation"]["device_id"] == "clinical-photo:operator-confirmed"
    assert Path(
        settings.data_dir / payload["observation"]["microscope_image_path"]
    ).is_file()

    remaining = client.get(
        f"/api/patients/{patient['id']}/clinical-photo-candidates"
    ).json()
    assert len(remaining) == 2

    dismissed = client.post(
        f"/api/clinical-photo-candidates/{remaining[0]['id']}/dismiss"
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"


def test_clinical_photo_requires_operator_confirmation(client: TestClient) -> None:
    patient = create_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/clinical-photos",
        files={"file": ("skin.jpg", multi_lesion_image(), "image/jpeg")},
    )
    assert response.status_code == 422
    assert not any(settings.image_dir.rglob("*"))


def test_clinical_photo_below_fifty_percent_is_not_persisted(
    client: TestClient,
) -> None:
    patient = create_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/clinical-photos",
        files={"file": ("unusable.jpg", black_image(), "image/jpeg")},
        data={"source_confirmed": "true"},
    )
    assert response.status_code == 422
    assert "below the 50% minimum" in response.json()["detail"]
    assert "was not saved" in response.json()["detail"]
    assert not any(settings.image_dir.rglob("*"))
    assert client.get(
        f"/api/patients/{patient['id']}/clinical-photo-candidates"
    ).json() == []
