from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppCounter, Lesion, LesionAuditEvent, Patient, utcnow
from ..risk_policy import summarize_lesions
from ..schemas import (
    LesionAuditEventRead,
    LesionCreate,
    LesionSummaryRead,
    LesionUpdate,
)
from ..storage import delete_lesion_files

router = APIRouter(tags=["lesions"])
LOCATION_FIELDS = ("body_part", "x", "y", "z")
EDITABLE_FIELDS = (*LOCATION_FIELDS, "label", "notes")
LESION_CODE_COUNTER_PREFIX = "lesion_code:"


def _editable_state(lesion: Lesion) -> dict:
    return {
        field: getattr(lesion, field)
        for field in EDITABLE_FIELDS
    }


def _lesion_counter_name(patient: Patient) -> str:
    return f"{LESION_CODE_COUNTER_PREFIX}{patient.patient_code}"


def _sync_lesion_counter(db: Session, patient: Patient) -> str:
    existing_codes = db.scalars(
        select(Lesion.lesion_code).where(Lesion.patient_id == patient.id)
    ).all()
    highest_existing = max(
        (
            int(code.removeprefix("L-"))
            for code in existing_codes
            if code.startswith("L-") and code.removeprefix("L-").isdigit()
        ),
        default=0,
    )
    counter_name = _lesion_counter_name(patient)
    db.execute(
        sqlite_insert(AppCounter)
        .values(name=counter_name, value=highest_existing)
        .on_conflict_do_update(
            index_elements=["name"],
            set_={"value": func.max(AppCounter.value, highest_existing)},
        )
    )
    return counter_name


def _next_lesion_number(db: Session, patient: Patient) -> int:
    counter_name = _sync_lesion_counter(db, patient)
    next_number = db.scalar(
        update(AppCounter)
        .where(AppCounter.name == counter_name)
        .values(value=AppCounter.value + 1)
        .returning(AppCounter.value)
    )
    if next_number is None:
        raise RuntimeError("Unable to allocate lesion code")
    return int(next_number)


@router.get(
    "/patients/{patient_id}/lesions",
    response_model=list[LesionSummaryRead],
)
def list_lesions(patient_id: int, db: Session = Depends(get_db)):
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return summarize_lesions(db, patient_id=patient_id)


@router.post(
    "/patients/{patient_id}/lesions",
    response_model=LesionSummaryRead,
    status_code=201,
)
def create_lesion(
    patient_id: int,
    payload: LesionCreate,
    db: Session = Depends(get_db),
):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    lesion = Lesion(
        patient_id=patient_id,
        lesion_code=f"L-{_next_lesion_number(db, patient):04d}",
        **payload.model_dump(),
    )
    db.add(lesion)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Unable to allocate a lesion code; retry creation",
        ) from exc
    db.refresh(lesion)
    return summarize_lesions(db, lesion_id=lesion.id)[0]


@router.get("/lesions/{lesion_id}", response_model=LesionSummaryRead)
def get_lesion(lesion_id: int, db: Session = Depends(get_db)):
    summaries = summarize_lesions(db, lesion_id=lesion_id)
    if not summaries:
        raise HTTPException(status_code=404, detail="Lesion not found")
    return summaries[0]


@router.put("/lesions/{lesion_id}", response_model=LesionSummaryRead)
def update_lesion(
    lesion_id: int,
    payload: LesionUpdate,
    db: Session = Depends(get_db),
):
    lesion = db.get(Lesion, lesion_id)
    if lesion is None:
        raise HTTPException(status_code=404, detail="Lesion not found")

    previous_state = _editable_state(lesion)
    current_state = payload.model_dump(exclude={"change_reason"})
    if previous_state == current_state:
        return summarize_lesions(db, lesion_id=lesion.id)[0]

    location_changed = any(
        previous_state[field] != current_state[field]
        for field in LOCATION_FIELDS
    )
    event = LesionAuditEvent(
        lesion_id=lesion.id,
        event_type="location" if location_changed else "details",
        previous_state=previous_state,
        current_state=current_state,
        change_reason=(
            payload.change_reason.strip()
            if payload.change_reason and payload.change_reason.strip()
            else None
        ),
        created_at=utcnow(),
    )
    for field, value in current_state.items():
        setattr(lesion, field, value)
    db.add(event)
    db.commit()
    return summarize_lesions(db, lesion_id=lesion.id)[0]


@router.get(
    "/lesions/{lesion_id}/audit-events",
    response_model=list[LesionAuditEventRead],
)
def list_lesion_audit_events(
    lesion_id: int,
    db: Session = Depends(get_db),
):
    if db.get(Lesion, lesion_id) is None:
        raise HTTPException(status_code=404, detail="Lesion not found")
    return db.scalars(
        select(LesionAuditEvent)
        .where(LesionAuditEvent.lesion_id == lesion_id)
        .order_by(
            LesionAuditEvent.created_at.desc(),
            LesionAuditEvent.id.desc(),
        )
    ).all()


@router.delete("/lesions/{lesion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesion(lesion_id: int, db: Session = Depends(get_db)):
    lesion = db.get(Lesion, lesion_id)
    if lesion is None:
        raise HTTPException(status_code=404, detail="Lesion not found")

    patient_id = lesion.patient_id
    _sync_lesion_counter(db, lesion.patient)
    db.delete(lesion)
    db.commit()
    delete_lesion_files(patient_id, lesion_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
