from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppCounter, Patient
from ..risk_policy import summarize_lesions
from ..schemas import (
    LesionSummaryRead,
    PatientCreate,
    PatientRead,
    PatientSummaryRead,
    PatientUpdate,
)
from ..storage import delete_patient_files

router = APIRouter(tags=["patients"])
PATIENT_CODE_COUNTER = "patient_code"


def _record_status(mapped: int, documented: int) -> str:
    if mapped == 0:
        return "not_mapped"
    if documented < mapped:
        return "needs_capture"
    return "documented"


def _summary(
    patient: Patient,
    lesions: list[LesionSummaryRead],
) -> PatientSummaryRead:
    mapped = len(lesions)
    documented = sum(
        lesion.accepted_observation_count > 0 for lesion in lesions
    )
    observations = sum(lesion.observation_count for lesion in lesions)
    last_activity = max(
        value
        for value in (
            patient.updated_at,
            *(lesion.last_activity_at for lesion in lesions),
        )
        if value is not None
    )
    attention_candidates = [
        lesion for lesion in lesions if lesion.attention_level is not None
    ]
    attention_priority = {
        "low": 1,
        "intermediate": 2,
        "uncertain": 2,
        "high": 3,
    }
    highest_attention = max(
        attention_candidates,
        key=lambda lesion: attention_priority[lesion.attention_level],
        default=None,
    )
    scheduled_checks = [
        lesion.next_check_at
        for lesion in lesions
        if lesion.next_check_at is not None
    ]
    return PatientSummaryRead(
        **PatientRead.model_validate(patient).model_dump(),
        mapped_lesions=mapped,
        documented_lesions=documented,
        observation_count=observations,
        record_status=_record_status(mapped, documented),
        highest_attention_level=(
            highest_attention.attention_level if highest_attention else None
        ),
        attention_status=(
            highest_attention.risk_status
            if highest_attention
            else "not_assessed"
        ),
        last_activity_at=last_activity,
        next_check_at=min(scheduled_checks, default=None),
    )


def _patient_summaries(
    db: Session,
    patient_id: int | None = None,
) -> list[PatientSummaryRead]:
    stmt = select(Patient).order_by(Patient.patient_code)
    if patient_id is not None:
        stmt = stmt.where(Patient.id == patient_id)

    patients = list(db.scalars(stmt).all())
    lesion_summaries = summarize_lesions(db, patient_id=patient_id)
    lesions_by_patient: dict[int, list[LesionSummaryRead]] = {}
    for lesion in lesion_summaries:
        lesions_by_patient.setdefault(lesion.patient_id, []).append(lesion)
    return [
        _summary(patient, lesions_by_patient.get(patient.id, []))
        for patient in patients
    ]


def _next_patient_number(db: Session) -> int:
    existing_codes = db.scalars(select(Patient.patient_code)).all()
    highest_existing = max(
        (
            int(code.removeprefix("ED-"))
            for code in existing_codes
            if code.startswith("ED-") and code.removeprefix("ED-").isdigit()
        ),
        default=0,
    )
    db.execute(
        sqlite_insert(AppCounter)
        .values(name=PATIENT_CODE_COUNTER, value=highest_existing)
        .on_conflict_do_update(
            index_elements=["name"],
            set_={"value": func.max(AppCounter.value, highest_existing)},
        )
    )
    next_number = db.scalar(
        update(AppCounter)
        .where(AppCounter.name == PATIENT_CODE_COUNTER)
        .values(value=AppCounter.value + 1)
        .returning(AppCounter.value)
    )
    if next_number is None:
        raise RuntimeError("Unable to allocate patient code")
    return int(next_number)


@router.get("/patients", response_model=list[PatientSummaryRead])
def list_patients(db: Session = Depends(get_db)):
    return _patient_summaries(db)


@router.post("/patients", response_model=PatientSummaryRead, status_code=201)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db)):
    patient = Patient(
        patient_code=f"ED-{_next_patient_number(db):04d}",
        **payload.model_dump(),
    )
    db.add(patient)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Unable to allocate a patient code; retry creation",
        ) from exc
    db.refresh(patient)
    return _summary(patient, [])


@router.get("/patients/{patient_id}", response_model=PatientSummaryRead)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    summaries = _patient_summaries(db, patient_id)
    if not summaries:
        raise HTTPException(status_code=404, detail="Patient not found")
    return summaries[0]


@router.put("/patients/{patient_id}", response_model=PatientSummaryRead)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    db: Session = Depends(get_db),
):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    current = {
        "display_name": patient.display_name,
        "birth_year": patient.birth_year,
        "notes": patient.notes,
    }
    updated = payload.model_dump()
    if current == updated:
        return _patient_summaries(db, patient_id)[0]

    for field, value in updated.items():
        setattr(patient, field, value)
    db.commit()
    return _patient_summaries(db, patient_id)[0]


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(patient_id: int, db: Session = Depends(get_db)):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    db.delete(patient)
    db.commit()
    delete_patient_files(patient_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
