import json
from calendar import monthrange
from collections import defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Lesion, LesionAuditEvent, ModelRun, Observation
from .schemas import LesionRead, LesionSummaryRead

VALIDATED_DOMAIN_STATUS = "microscope_validated"
ATTENTION_LEVELS = {"low", "intermediate", "high", "uncertain"}
FOLLOW_UP_POLICY_VERSION = "dual-center-scale-confirmation-v1"


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _result_payload(run: ModelRun) -> dict:
    try:
        payload = json.loads(run.result_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _is_run_validated(run: ModelRun) -> bool:
    payload = _result_payload(run)
    return (
        run.validation_status == "validated"
        and run.domain_status == VALIDATED_DOMAIN_STATUS
        and payload.get("thresholds_validated") is True
    )


def _risk_fields(
    run: ModelRun | None,
    accepted_observation_count: int,
) -> dict:
    if run is None:
        return {
            "attention_level": None,
            "risk_status": "not_assessed",
            "risk_score": None,
            "risk_confidence": None,
            "risk_assessed_at": None,
            "risk_model_version": None,
            "risk_validation_status": None,
            "risk_domain_status": None,
            "follow_up_action": (
                "evaluate_required"
                if accepted_observation_count
                else "capture_required"
            ),
            "next_check_at": None,
        }

    attention_level = (
        "uncertain"
        if run.abstained or run.attention_level == "intermediate"
        else run.attention_level
        if run.attention_level in ATTENTION_LEVELS
        else "uncertain"
    )
    fields = {
        "attention_level": attention_level,
        "risk_status": "experimental",
        "risk_score": run.score,
        "risk_confidence": run.confidence,
        "risk_assessed_at": run.created_at,
        "risk_model_version": run.model_version,
        "risk_validation_status": run.validation_status,
        "risk_domain_status": run.domain_status,
        "follow_up_action": "monitor_12_months",
        "next_check_at": None,
    }
    if _is_run_validated(run):
        fields["risk_status"] = "validated"
    if attention_level == "low":
        fields["follow_up_action"] = "monitor_12_months"
        fields["next_check_at"] = _add_months(run.created_at, 12)
    elif attention_level == "high":
        fields["follow_up_action"] = "professional_review"
        fields["next_check_at"] = run.created_at
    else:
        fields["follow_up_action"] = "inconclusive"
    return fields


def summarize_lesions(
    db: Session,
    *,
    patient_id: int | None = None,
    lesion_id: int | None = None,
) -> list[LesionSummaryRead]:
    lesion_stmt = select(Lesion).where(Lesion.archived.is_(False))
    if patient_id is not None:
        lesion_stmt = lesion_stmt.where(Lesion.patient_id == patient_id)
    if lesion_id is not None:
        lesion_stmt = lesion_stmt.where(Lesion.id == lesion_id)
    lesions = list(db.scalars(lesion_stmt.order_by(Lesion.lesion_code)).all())
    if not lesions:
        return []

    lesion_ids = [lesion.id for lesion in lesions]
    observations = list(
        db.scalars(
            select(Observation)
            .where(Observation.lesion_id.in_(lesion_ids))
            .order_by(Observation.captured_at.desc(), Observation.id.desc())
        ).all()
    )
    runs = list(
        db.scalars(
            select(ModelRun)
            .join(Observation, ModelRun.observation_id == Observation.id)
            .where(
                Observation.lesion_id.in_(lesion_ids),
                Observation.quality_status == "accepted",
            )
            .order_by(ModelRun.created_at.desc(), ModelRun.id.desc())
        ).all()
    )
    audit_events = list(
        db.scalars(
            select(LesionAuditEvent)
            .where(LesionAuditEvent.lesion_id.in_(lesion_ids))
            .order_by(
                LesionAuditEvent.created_at.desc(),
                LesionAuditEvent.id.desc(),
            )
        ).all()
    )

    observations_by_lesion: dict[int, list[Observation]] = defaultdict(list)
    for observation in observations:
        observations_by_lesion[observation.lesion_id].append(observation)

    latest_run_by_lesion: dict[int, ModelRun] = {}
    latest_audit_by_lesion: dict[int, LesionAuditEvent] = {}
    observation_lesion_ids = {
        observation.id: observation.lesion_id for observation in observations
    }
    for run in runs:
        run_lesion_id = observation_lesion_ids.get(run.observation_id)
        if run_lesion_id is not None:
            latest_run_by_lesion.setdefault(run_lesion_id, run)
    for event in audit_events:
        latest_audit_by_lesion.setdefault(event.lesion_id, event)

    summaries: list[LesionSummaryRead] = []
    for lesion in lesions:
        lesion_observations = observations_by_lesion[lesion.id]
        accepted = [
            observation
            for observation in lesion_observations
            if observation.quality_status == "accepted"
        ]
        latest_observation = lesion_observations[0] if lesion_observations else None
        latest_accepted = accepted[0] if accepted else None
        latest_run = latest_run_by_lesion.get(lesion.id)
        latest_audit = latest_audit_by_lesion.get(lesion.id)
        last_activity_at = max(
            value
            for value in (
                lesion.created_at,
                latest_observation.captured_at if latest_observation else None,
                latest_observation.created_at if latest_observation else None,
                latest_run.created_at if latest_run else None,
                latest_audit.created_at if latest_audit else None,
            )
            if value is not None
        )
        summaries.append(
            LesionSummaryRead(
                **LesionRead.model_validate(lesion).model_dump(),
                observation_count=len(lesion_observations),
                accepted_observation_count=len(accepted),
                latest_observation_at=(
                    latest_observation.captured_at if latest_observation else None
                ),
                latest_accepted_observation_id=(
                    latest_accepted.id if latest_accepted else None
                ),
                latest_accepted_image_path=(
                    latest_accepted.microscope_image_path
                    if latest_accepted
                    else None
                ),
                last_activity_at=last_activity_at,
                **_risk_fields(latest_run, len(accepted)),
            )
        )
    return summaries
