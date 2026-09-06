from __future__ import annotations

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .config import settings
from .models import (
    AcquisitionSetup,
    Observation,
    ObservationAcquisition,
    utcnow,
)
from .quality import QualityThresholds

SETUP_ID = 1


def get_acquisition_setup(db: Session) -> AcquisitionSetup:
    setup = db.get(AcquisitionSetup, SETUP_ID)
    if setup is not None:
        return setup

    db.execute(
        sqlite_insert(AcquisitionSetup)
        .values(
            id=SETUP_ID,
            revision=1,
            name="Primary microscope protocol",
            orientation="cranial_up",
            illumination="integrated_led",
            focus_threshold=settings.focus_threshold,
            min_brightness=settings.min_brightness,
            max_brightness=settings.max_brightness,
            thresholds_status="provisional",
            updated_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    db.commit()
    setup = db.get(AcquisitionSetup, SETUP_ID)
    if setup is None:
        raise RuntimeError("Unable to initialize acquisition setup")
    return setup


def setup_capture_ready(setup: AcquisitionSetup) -> bool:
    return bool(
        setup.magnification_x
        and setup.spacer_id
        and setup.spacer_id.strip()
        and setup.orientation
    )


def setup_status(setup: AcquisitionSetup) -> str:
    if not setup_capture_ready(setup):
        return "incomplete"
    if not setup.scale_reference_path or not setup.color_reference_path:
        return "reference_pending"
    if setup.thresholds_status != "calibrated":
        return "provisional"
    return "validated"


def setup_thresholds(setup: AcquisitionSetup) -> QualityThresholds:
    return QualityThresholds(
        focus=setup.focus_threshold,
        min_brightness=setup.min_brightness,
        max_brightness=setup.max_brightness,
    )


def attach_acquisition_snapshot(
    db: Session,
    observation: Observation,
    setup: AcquisitionSetup,
    *,
    device_path: str,
    device_name: str,
    width: int,
    height: int,
    pixel_format: str,
    frame_rate: float | None,
) -> ObservationAcquisition:
    snapshot = ObservationAcquisition(
        observation=observation,
        protocol_revision=setup.revision,
        protocol_name=setup.name,
        protocol_status=setup_status(setup),
        device_path=device_path,
        device_name=device_name,
        width=width,
        height=height,
        pixel_format=pixel_format,
        frame_rate=frame_rate,
        exposure=setup.exposure,
        gain=setup.gain,
        white_balance=setup.white_balance,
        magnification_x=setup.magnification_x,
        orientation=setup.orientation,
        spacer_id=setup.spacer_id,
        illumination=setup.illumination,
        focus_threshold=setup.focus_threshold,
        min_brightness=setup.min_brightness,
        max_brightness=setup.max_brightness,
        thresholds_status=setup.thresholds_status,
        scale_reference_path=setup.scale_reference_path,
        color_reference_path=setup.color_reference_path,
    )
    db.add(snapshot)
    return snapshot
