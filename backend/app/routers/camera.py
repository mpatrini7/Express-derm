from __future__ import annotations

import time

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..acquisition import (
    attach_acquisition_snapshot,
    get_acquisition_setup,
    setup_thresholds,
)
from ..camera import (
    CameraStream,
    camera_manager,
    device_name,
    is_supported_device,
    list_devices,
)
from ..database import get_db
from ..models import Lesion, Observation
from ..quality import QualityResult, analyze_image
from ..schemas import CameraDevice, ObservationRead
from ..storage import delete_stored_file, save_encoded_jpeg

router = APIRouter(prefix="/camera", tags=["camera"])


@router.get("/devices", response_model=list[CameraDevice])
def devices():
    return list_devices()


def _stream(
    device: str,
    width: int | None,
    height: int | None,
    pixel_format: str | None,
    frame_rate: float | None,
) -> CameraStream:
    if not is_supported_device(device):
        raise HTTPException(status_code=404, detail="Camera device not available")
    return camera_manager.get_stream(
        device,
        width=width,
        height=height,
        pixel_format=pixel_format,
        frame_rate=frame_rate,
    )


def mjpeg_frames(stream: CameraStream):
    last_sequence = -1
    while True:
        frame = stream.wait_for_frame(1.5, after_sequence=last_sequence)
        if frame is None or frame.image is None:
            time.sleep(0.1)
            continue
        last_sequence = frame.sequence
        ok, encoded = cv2.imencode(
            ".jpg",
            frame.image,
            [cv2.IMWRITE_JPEG_QUALITY, 85],
        )
        if not ok:
            continue
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + encoded.tobytes()
            + b"\r\n"
        )
        time.sleep(0.08)


@router.get("/preview")
def preview(
    device: str = Query(default="/dev/video0"),
    width: int | None = Query(default=None, ge=160, le=7680),
    height: int | None = Query(default=None, ge=120, le=4320),
    pixel_format: str | None = Query(default=None, min_length=4, max_length=4),
    frame_rate: float | None = Query(default=None, ge=1, le=240),
):
    stream = _stream(device, width, height, pixel_format, frame_rate)
    if stream.wait_for_frame(2) is None:
        raise HTTPException(
            status_code=503,
            detail=stream.error or "No microscope frames available",
        )
    return StreamingResponse(
        mjpeg_frames(stream),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


def _best_candidate(
    candidates: list[tuple[np.ndarray, QualityResult]],
) -> tuple[np.ndarray, QualityResult]:
    return max(
        candidates,
        key=lambda item: (
            item[1].quality_score,
            item[1].focus_score,
            -abs(item[1].mean_brightness - 132),
        ),
    )


@router.post(
    "/snapshot/{lesion_id}",
    response_model=ObservationRead,
    status_code=201,
)
def snapshot(
    lesion_id: int,
    device: str = Query(default="/dev/video0"),
    width: int | None = Query(default=None, ge=160, le=7680),
    height: int | None = Query(default=None, ge=120, le=4320),
    pixel_format: str | None = Query(default=None, min_length=4, max_length=4),
    frame_rate: float | None = Query(default=None, ge=1, le=240),
    db: Session = Depends(get_db),
):
    lesion = db.get(Lesion, lesion_id)
    if lesion is None:
        raise HTTPException(status_code=404, detail="Lesion not found")

    setup = get_acquisition_setup(db)
    thresholds = setup_thresholds(setup)
    stream = _stream(
        device,
        width,
        height,
        pixel_format,
        frame_rate,
    )
    candidates: list[tuple[np.ndarray, QualityResult]] = []
    last_sequence = -1
    deadline = time.monotonic() + 3
    while len(candidates) < 12 and time.monotonic() < deadline:
        frame = stream.wait_for_frame(0.35, after_sequence=last_sequence)
        if frame is None or frame.image is None:
            continue
        last_sequence = frame.sequence
        candidates.append(
            (frame.image, analyze_image(frame.image, thresholds))
        )

    if not candidates:
        raise HTTPException(
            status_code=503,
            detail=stream.error or "No microscope frames available",
        )

    best_image, quality = _best_candidate(candidates)
    if not quality.accepted:
        raise HTTPException(
            status_code=422,
            detail=quality.reason or "Unable to score microscope frame",
        )

    ok, encoded = cv2.imencode(
        ".jpg",
        best_image,
        [cv2.IMWRITE_JPEG_QUALITY, 95],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Unable to encode snapshot")

    path = save_encoded_jpeg(encoded.tobytes(), lesion.patient_id, lesion.id)
    actual_height, actual_width = best_image.shape[:2]
    mode = (
        f"{actual_width}x{actual_height}/{pixel_format or 'auto'}"
        if width and height
        else "auto"
    )
    if frame_rate:
        mode = f"{mode}@{frame_rate:g}fps"
    observation = Observation(
        lesion_id=lesion.id,
        microscope_image_path=path,
        original_filename=None,
        mime_type="image/jpeg",
        device_id=f"{device} [{mode}]",
        focus_score=quality.focus_score,
        mean_brightness=quality.mean_brightness,
        dark_fraction=quality.dark_fraction,
        bright_fraction=quality.bright_fraction,
        quality_score=quality.quality_score,
        quality_status="accepted",
        quality_reason=quality.reason,
    )
    db.add(observation)
    attach_acquisition_snapshot(
        db,
        observation,
        setup,
        device_path=device,
        device_name=device_name(device),
        width=actual_width,
        height=actual_height,
        pixel_format=pixel_format or "AUTO",
        frame_rate=frame_rate,
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_stored_file(path)
        raise
    db.refresh(observation)
    return observation
