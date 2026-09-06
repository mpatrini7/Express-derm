from pathlib import Path

from fastapi.testclient import TestClient

from app.camera import MOCK_DEVICE_PATH, parse_v4l2_modes
from app.config import settings


V4L2_FORMATS = """
ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture

	[0]: 'MJPG' (Motion-JPEG, compressed)
		Size: Discrete 1920x1080
			Interval: Discrete 0.033s (30.000 fps)
			Interval: Discrete 0.067s (15.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.033s (30.000 fps)
	[1]: 'YUYV' (YUYV 4:2:2)
		Size: Discrete 640x480
			Interval: Discrete 0.033s (30.000 fps)
"""


def create_lesion(client: TestClient) -> dict:
    patient_response = client.post(
        "/api/patients",
        json={"display_name": "Camera test patient"},
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    lesion_response = client.post(
        f"/api/patients/{patient['id']}/lesions",
        json={
            "body_part": "torso",
            "x": 0.1,
            "y": 0.2,
            "z": 0.3,
            "label": "Camera test marker",
        },
    )
    assert lesion_response.status_code == 201
    return lesion_response.json()


def test_parse_v4l2_modes() -> None:
    assert parse_v4l2_modes(V4L2_FORMATS) == [
        {
            "pixel_format": "MJPG",
            "width": 1920,
            "height": 1080,
            "fps": [30.0, 15.0],
        },
        {
            "pixel_format": "MJPG",
            "width": 1280,
            "height": 720,
            "fps": [30.0],
        },
        {
            "pixel_format": "YUYV",
            "width": 640,
            "height": 480,
            "fps": [30.0],
        },
    ]


def test_mock_camera_lists_modes_and_saves_accepted_snapshot(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "camera_mock", True)
    lesion = create_lesion(client)

    devices_response = client.get("/api/camera/devices")
    assert devices_response.status_code == 200
    mock_device = devices_response.json()[0]
    assert mock_device["path"] == MOCK_DEVICE_PATH
    assert mock_device["is_mock"] is True
    assert mock_device["modes"][0]["width"] == 1280

    snapshot_response = client.post(
        f"/api/camera/snapshot/{lesion['id']}",
        params={
            "device": MOCK_DEVICE_PATH,
            "width": 640,
            "height": 480,
            "pixel_format": "MJPG",
        },
    )
    assert snapshot_response.status_code == 201
    observation = snapshot_response.json()
    assert observation["quality_status"] == "accepted"
    assert 0 <= observation["quality_score"] <= 100
    assert observation["quality_reason"] is None
    assert observation["device_id"] == "mock://microscope [640x480/MJPG]"
    assert Path(
        settings.data_dir / observation["microscope_image_path"]
    ).is_file()


def test_camera_snapshot_below_fifty_percent_is_not_persisted(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "camera_mock", True)
    monkeypatch.setattr(settings, "focus_threshold", 1_000_000_000.0)
    monkeypatch.setattr(settings, "min_brightness", 250.0)
    lesion = create_lesion(client)
    snapshot_response = client.post(
        f"/api/camera/snapshot/{lesion['id']}",
        params={"device": MOCK_DEVICE_PATH},
    )
    assert snapshot_response.status_code == 422
    assert "below the 50% minimum" in snapshot_response.json()["detail"]
    assert "was not saved" in snapshot_response.json()["detail"]

    observations_response = client.get(
        f"/api/lesions/{lesion['id']}/observations"
    )
    assert observations_response.status_code == 200
    assert observations_response.json() == []
    assert not any(settings.image_dir.rglob("*"))


def test_camera_rejects_unknown_device(client: TestClient) -> None:
    lesion = create_lesion(client)

    snapshot_response = client.post(
        f"/api/camera/snapshot/{lesion['id']}",
        params={"device": "/tmp/not-a-camera"},
    )

    assert snapshot_response.status_code == 404
    assert snapshot_response.json()["detail"] == "Camera device not available"
