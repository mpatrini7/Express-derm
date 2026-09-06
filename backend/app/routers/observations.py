from datetime import datetime
from typing import Annotated

import cv2
import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..acquisition import (
    attach_acquisition_snapshot,
    get_acquisition_setup,
    setup_thresholds,
)
from ..database import get_db
from ..models import Lesion, LongitudinalReview, Observation
from ..observation_provenance import (
    CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
    has_confirmed_microscope_source,
)
from ..quality import analyze_image
from ..schemas import (
    LongitudinalReviewCreate,
    LongitudinalReviewRead,
    ObservationRead,
)
from ..storage import (
    delete_stored_file,
    finalize_staged_file_deletion,
    read_upload,
    restore_staged_file_deletion,
    save_upload,
    stage_stored_file_deletion,
)

router = APIRouter(tags=["observations"])


@router.get(
    "/lesions/{lesion_id}/observations",
    response_model=list[ObservationRead],
)
def list_observations(lesion_id: int, db: Session = Depends(get_db)):
    if db.get(Lesion, lesion_id) is None:
        raise HTTPException(status_code=404, detail="Lesion not found")
    stmt = (
        select(Observation)
        .where(Observation.lesion_id == lesion_id)
        .order_by(Observation.captured_at.desc())
    )
    return db.scalars(stmt).all()


@router.delete(
    "/observations/{observation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_observation(
    observation_id: int,
    db: Session = Depends(get_db),
):
    observation = db.get(Observation, observation_id)
    if observation is None:
        raise HTTPException(status_code=404, detail="Observation not found")

    staged_file = stage_stored_file_deletion(
        observation.microscope_image_path
    )
    db.delete(observation)
    try:
        db.commit()
    except Exception:
        db.rollback()
        restore_staged_file_deletion(staged_file)
        raise

    finalize_staged_file_deletion(staged_file)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/lesions/{lesion_id}/longitudinal-reviews",
    response_model=list[LongitudinalReviewRead],
)
def list_longitudinal_reviews(
    lesion_id: int,
    db: Session = Depends(get_db),
):
    if db.get(Lesion, lesion_id) is None:
        raise HTTPException(status_code=404, detail="Lesion not found")
    return db.scalars(
        select(LongitudinalReview)
        .where(LongitudinalReview.lesion_id == lesion_id)
        .order_by(
            LongitudinalReview.created_at.desc(),
            LongitudinalReview.id.desc(),
        )
    ).all()


@router.post(
    "/lesions/{lesion_id}/longitudinal-reviews",
    response_model=LongitudinalReviewRead,
    status_code=201,
)
def create_longitudinal_review(
    lesion_id: int,
    payload: LongitudinalReviewCreate,
    db: Session = Depends(get_db),
):
    if db.get(Lesion, lesion_id) is None:
        raise HTTPException(status_code=404, detail="Lesion not found")

    observation_ids = {
        payload.baseline_observation_id,
        payload.comparison_observation_id,
    }
    observations = {
        observation.id: observation
        for observation in db.scalars(
            select(Observation).where(Observation.id.in_(observation_ids))
        ).all()
    }
    if set(observations) != observation_ids:
        raise HTTPException(
            status_code=422,
            detail="Both comparison observations must exist",
        )

    baseline = observations[payload.baseline_observation_id]
    comparison = observations[payload.comparison_observation_id]
    if baseline.lesion_id != lesion_id or comparison.lesion_id != lesion_id:
        raise HTTPException(
            status_code=422,
            detail="Comparison observations must belong to this lesion",
        )
    if (
        baseline.quality_status != "accepted"
        or comparison.quality_status != "accepted"
    ):
        raise HTTPException(
            status_code=422,
            detail="Only quality-accepted microscope images can be compared",
        )
    if (
        not has_confirmed_microscope_source(baseline)
        or not has_confirmed_microscope_source(comparison)
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Only source-confirmed microscope images can be compared"
            ),
        )
    if baseline.captured_at > comparison.captured_at:
        raise HTTPException(
            status_code=422,
            detail="Baseline observation must not be newer than comparison",
        )

    review = LongitudinalReview(
        lesion_id=lesion_id,
        baseline_observation_id=baseline.id,
        comparison_observation_id=comparison.id,
        change_flag=payload.change_flag,
        notes=(
            payload.notes.strip()
            if payload.notes and payload.notes.strip()
            else None
        ),
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.post(
    "/lesions/{lesion_id}/observations/upload",
    response_model=ObservationRead,
    status_code=201,
)
async def upload_observation(
    lesion_id: int,
    file: Annotated[UploadFile, File()],
    notes: Annotated[str | None, Form()] = None,
    captured_at: Annotated[datetime | None, Form()] = None,
    microscope_source_confirmed: Annotated[bool, Form()] = False,
    source_type: Annotated[str | None, Form()] = None,
    db: Session = Depends(get_db),
):
    lesion = db.get(Lesion, lesion_id)
    if lesion is None:
        raise HTTPException(status_code=404, detail="Lesion not found")
    normalized_source_type = (source_type or "microscope").strip().lower()
    if normalized_source_type != "microscope":
        raise HTTPException(
            status_code=422,
            detail=(
                "Only a USB-microscope image can be uploaded as an "
                "observation. Body photos and other images are not accepted."
            ),
        )
    if not microscope_source_confirmed:
        raise HTTPException(
            status_code=422,
            detail=(
                "Confirm that the uploaded file is a USB-microscope image "
                "before it is checked, saved and analyzed."
            ),
        )

    content = await read_upload(file)
    encoded = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode image")

    setup = get_acquisition_setup(db)
    quality = analyze_image(image, setup_thresholds(setup))
    if not quality.accepted:
        raise HTTPException(
            status_code=422,
            detail=quality.reason or "Unable to score microscope image",
        )

    mime_type = file.content_type or "application/octet-stream"
    relative_path = save_upload(
        content,
        mime_type,
        lesion.patient_id,
        lesion.id,
    )
    observation = Observation(
        lesion_id=lesion.id,
        captured_at=captured_at or datetime.now().astimezone(),
        microscope_image_path=relative_path,
        original_filename=file.filename,
        mime_type=mime_type,
        device_id=CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
        focus_score=quality.focus_score,
        mean_brightness=quality.mean_brightness,
        dark_fraction=quality.dark_fraction,
        bright_fraction=quality.bright_fraction,
        quality_score=quality.quality_score,
        quality_status="accepted",
        quality_reason=quality.reason,
        notes=notes,
    )
    db.add(observation)
    image_height, image_width = image.shape[:2]
    attach_acquisition_snapshot(
        db,
        observation,
        setup,
        device_path=CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID,
        device_name="Manual USB microscope upload (operator confirmed)",
        width=image_width,
        height=image_height,
        pixel_format=mime_type,
        frame_rate=None,
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_stored_file(relative_path)
        raise
    db.refresh(observation)
    return observation
