from __future__ import annotations

from datetime import datetime
from typing import Annotated

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..acquisition import get_acquisition_setup, setup_thresholds
from ..clinical_photo_detection import crop_candidate, detect_lesion_candidates
from ..config import settings
from ..database import get_db
from ..models import (
    ClinicalPhoto,
    ClinicalPhotoCandidate,
    Lesion,
    Observation,
    Patient,
    utcnow,
)
from ..observation_provenance import CONFIRMED_CLINICAL_PHOTO_DEVICE_ID
from ..quality import analyze_image
from ..risk_policy import summarize_lesions
from ..schemas import (
    ClinicalPhotoCandidateAssign,
    ClinicalPhotoCandidateAssignmentRead,
    ClinicalPhotoCandidateRead,
    ClinicalPhotoRead,
)
from ..storage import (
    delete_stored_file,
    read_upload,
    save_clinical_candidate,
    save_clinical_photo,
    save_encoded_jpeg,
)
from .lesions import _next_lesion_number

router = APIRouter(tags=["clinical photos"])


@router.get(
    "/patients/{patient_id}/clinical-photo-candidates",
    response_model=list[ClinicalPhotoCandidateRead],
)
def list_clinical_photo_candidates(
    patient_id: int,
    status: str = "pending",
    db: Session = Depends(get_db),
):
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if status not in {"pending", "assigned", "dismissed", "all"}:
        raise HTTPException(status_code=422, detail="Unknown candidate status")
    stmt = (
        select(ClinicalPhotoCandidate)
        .join(ClinicalPhoto)
        .where(ClinicalPhoto.patient_id == patient_id)
        .order_by(
            ClinicalPhotoCandidate.quality_score.desc(),
            ClinicalPhotoCandidate.detection_score.desc(),
            ClinicalPhotoCandidate.created_at.desc(),
            ClinicalPhotoCandidate.id.desc(),
        )
    )
    if status != "all":
        stmt = stmt.where(ClinicalPhotoCandidate.status == status)
    return db.scalars(stmt).all()


@router.post(
    "/patients/{patient_id}/clinical-photos",
    response_model=ClinicalPhotoRead,
    status_code=201,
)
async def upload_clinical_photo(
    patient_id: int,
    file: Annotated[UploadFile, File()],
    source_confirmed: Annotated[bool, Form()] = False,
    db: Session = Depends(get_db),
):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not source_confirmed:
        raise HTTPException(
            status_code=422,
            detail="Confirm that this is a patient clinical photo before processing",
        )

    content = await read_upload(file)
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode image")

    setup = get_acquisition_setup(db)
    thresholds = setup_thresholds(setup)
    photo_quality = analyze_image(image, thresholds)
    if not photo_quality.accepted:
        raise HTTPException(
            status_code=422,
            detail=photo_quality.reason or "Photo quality is below 50%",
        )
    height, width = image.shape[:2]
    mime_type = file.content_type or "application/octet-stream"
    stored_paths: list[str] = []

    photo_path = save_clinical_photo(content, mime_type, patient_id)
    stored_paths.append(photo_path)
    photo = ClinicalPhoto(
        patient_id=patient_id,
        image_path=photo_path,
        original_filename=file.filename,
        mime_type=mime_type,
        width=width,
        height=height,
        quality_score=photo_quality.quality_score,
        focus_score=photo_quality.focus_score,
        mean_brightness=photo_quality.mean_brightness,
        dark_fraction=photo_quality.dark_fraction,
        bright_fraction=photo_quality.bright_fraction,
        quality_reason=photo_quality.reason,
    )
    db.add(photo)
    db.flush()

    accepted_index = 0
    for region in detect_lesion_candidates(image):
        crop = crop_candidate(image, region)
        crop_quality = analyze_image(crop, thresholds)
        if not crop_quality.accepted:
            continue
        accepted_index += 1
        encoded_ok, encoded = cv2.imencode(
            ".jpg",
            crop,
            [int(cv2.IMWRITE_JPEG_QUALITY), 95],
        )
        if not encoded_ok:
            continue
        crop_path = save_clinical_candidate(encoded.tobytes(), patient_id)
        stored_paths.append(crop_path)
        db.add(
            ClinicalPhotoCandidate(
                clinical_photo_id=photo.id,
                candidate_index=accepted_index,
                crop_image_path=crop_path,
                bbox_x=region.x,
                bbox_y=region.y,
                bbox_width=region.width,
                bbox_height=region.height,
                detection_score=region.detection_score,
                quality_score=crop_quality.quality_score,
                focus_score=crop_quality.focus_score,
                mean_brightness=crop_quality.mean_brightness,
                dark_fraction=crop_quality.dark_fraction,
                bright_fraction=crop_quality.bright_fraction,
                quality_reason=crop_quality.reason,
            )
        )

    try:
        db.commit()
    except Exception:
        db.rollback()
        for stored_path in stored_paths:
            delete_stored_file(stored_path)
        raise

    return db.scalar(
        select(ClinicalPhoto)
        .options(selectinload(ClinicalPhoto.candidates))
        .where(ClinicalPhoto.id == photo.id)
    )


@router.post(
    "/clinical-photo-candidates/{candidate_id}/dismiss",
    response_model=ClinicalPhotoCandidateRead,
)
def dismiss_clinical_photo_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
):
    candidate = db.get(ClinicalPhotoCandidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Photo candidate not found")
    if candidate.status == "assigned":
        raise HTTPException(
            status_code=409,
            detail="Assigned candidate cannot be dismissed",
        )
    candidate.status = "dismissed"
    db.commit()
    db.refresh(candidate)
    return candidate


@router.post(
    "/clinical-photo-candidates/{candidate_id}/assign",
    response_model=ClinicalPhotoCandidateAssignmentRead,
    status_code=201,
)
def assign_clinical_photo_candidate(
    candidate_id: int,
    payload: ClinicalPhotoCandidateAssign,
    db: Session = Depends(get_db),
):
    candidate = db.scalar(
        select(ClinicalPhotoCandidate)
        .options(selectinload(ClinicalPhotoCandidate.clinical_photo))
        .where(ClinicalPhotoCandidate.id == candidate_id)
    )
    if candidate is None:
        raise HTTPException(status_code=404, detail="Photo candidate not found")
    if candidate.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Photo candidate is no longer pending",
        )

    photo = candidate.clinical_photo
    patient = db.get(Patient, photo.patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    lesion = Lesion(
        patient_id=patient.id,
        lesion_code=f"L-{_next_lesion_number(db, patient):04d}",
        body_part=payload.body_part,
        x=payload.x,
        y=payload.y,
        z=payload.z,
        label=(
            payload.label.strip()
            if payload.label and payload.label.strip()
            else None
        ),
    )
    db.add(lesion)
    db.flush()

    source_path = settings.data_dir / candidate.crop_image_path
    if not source_path.is_file():
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Candidate crop is missing from storage",
        )
    observation_path = save_encoded_jpeg(
        source_path.read_bytes(),
        patient.id,
        lesion.id,
    )
    observation = Observation(
        lesion_id=lesion.id,
        captured_at=photo.created_at or datetime.now().astimezone(),
        microscope_image_path=observation_path,
        original_filename=photo.original_filename,
        mime_type="image/jpeg",
        device_id=CONFIRMED_CLINICAL_PHOTO_DEVICE_ID,
        focus_score=candidate.focus_score,
        mean_brightness=candidate.mean_brightness,
        dark_fraction=candidate.dark_fraction,
        bright_fraction=candidate.bright_fraction,
        quality_score=candidate.quality_score,
        quality_status="accepted",
        quality_reason=candidate.quality_reason,
        notes=(
            f"Candidate {candidate.candidate_index} from clinical photo {photo.id}; "
            "operator assigned on BodyMap."
        ),
    )
    db.add(observation)
    candidate.status = "assigned"
    candidate.assigned_lesion_id = lesion.id
    candidate.assigned_at = utcnow()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        delete_stored_file(observation_path)
        raise HTTPException(
            status_code=409,
            detail="Unable to allocate lesion record",
        ) from exc
    except Exception:
        db.rollback()
        delete_stored_file(observation_path)
        raise

    db.refresh(candidate)
    db.refresh(observation)
    return {
        "candidate": candidate,
        "lesion": summarize_lesions(db, lesion_id=lesion.id)[0],
        "observation": observation,
    }
