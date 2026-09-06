from __future__ import annotations

from typing import Annotated, Literal

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..acquisition import (
    get_acquisition_setup,
    setup_capture_ready,
    setup_status,
)
from ..database import get_db
from ..models import AcquisitionSetup
from ..schemas import AcquisitionSetupRead, AcquisitionSetupUpdate
from ..storage import (
    delete_stored_file,
    read_upload,
    save_calibration_reference,
)

router = APIRouter(prefix="/acquisition", tags=["acquisition"])


def _read_setup(setup: AcquisitionSetup) -> AcquisitionSetupRead:
    return AcquisitionSetupRead(
        id=setup.id,
        revision=setup.revision,
        name=setup.name,
        magnification_x=setup.magnification_x,
        orientation=setup.orientation,
        spacer_id=setup.spacer_id,
        illumination=setup.illumination,
        exposure=setup.exposure,
        gain=setup.gain,
        white_balance=setup.white_balance,
        focus_threshold=setup.focus_threshold,
        min_brightness=setup.min_brightness,
        max_brightness=setup.max_brightness,
        thresholds_status=setup.thresholds_status,
        scale_reference_path=setup.scale_reference_path,
        color_reference_path=setup.color_reference_path,
        capture_ready=setup_capture_ready(setup),
        protocol_status=setup_status(setup),
        updated_at=setup.updated_at,
    )


@router.get("/setup", response_model=AcquisitionSetupRead)
def get_setup(db: Session = Depends(get_db)):
    return _read_setup(get_acquisition_setup(db))


@router.put("/setup", response_model=AcquisitionSetupRead)
def update_setup(
    payload: AcquisitionSetupUpdate,
    db: Session = Depends(get_db),
):
    setup = get_acquisition_setup(db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=422,
            detail="Protocol name cannot be blank",
        )
    if payload.thresholds_status == "calibrated" and (
        not setup.scale_reference_path or not setup.color_reference_path
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Scale and color references are required before thresholds "
                "can be marked calibrated"
            ),
        )

    values = payload.model_dump()
    values["name"] = name
    spacer_id = payload.spacer_id.strip() if payload.spacer_id else ""
    values["spacer_id"] = spacer_id or None
    calibration_inputs = (
        "magnification_x",
        "orientation",
        "spacer_id",
        "illumination",
        "exposure",
        "gain",
        "white_balance",
    )
    calibration_changed = any(
        getattr(setup, field) != values[field]
        for field in calibration_inputs
    )
    if calibration_changed:
        values["thresholds_status"] = "provisional"
        setup.scale_reference_path = None
        setup.color_reference_path = None

    for field, value in values.items():
        setattr(setup, field, value)
    setup.revision += 1
    db.commit()
    db.refresh(setup)
    return _read_setup(setup)


@router.post(
    "/setup/references/{reference_type}",
    response_model=AcquisitionSetupRead,
)
async def upload_reference(
    reference_type: Literal["scale", "color"],
    file: Annotated[UploadFile, File()],
    db: Session = Depends(get_db),
):
    setup = get_acquisition_setup(db)
    content = await read_upload(file)
    encoded = np.frombuffer(content, dtype=np.uint8)
    if cv2.imdecode(encoded, cv2.IMREAD_COLOR) is None:
        raise HTTPException(status_code=400, detail="Unable to decode image")

    mime_type = file.content_type or "application/octet-stream"
    new_path = save_calibration_reference(
        content,
        mime_type,
        reference_type,
    )
    field = f"{reference_type}_reference_path"
    setattr(setup, field, new_path)
    setup.thresholds_status = "provisional"
    setup.revision += 1
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_stored_file(new_path)
        raise
    db.refresh(setup)
    return _read_setup(setup)
