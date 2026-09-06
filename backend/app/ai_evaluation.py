from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .ai_service import ai_service
from .config import settings
from .database import SessionLocal
from .decision_policy import DECISION_POLICY_VERSION
from .models import ModelRun, Observation
from .observation_provenance import has_confirmed_microscope_source
from .quality import QUALITY_SCORE_VERSION

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PendingEvaluationReport:
    model_version: str | None
    evaluated: int
    already_evaluated: int
    failed: int


def create_model_run(
    db: Session,
    observation: Observation,
    *,
    expected_model_version: str | None = None,
    expected_model_hash: str | None = None,
) -> ModelRun:
    acquisition = observation.acquisition

    prediction = ai_service.predict(
        settings.data_dir / observation.microscope_image_path,
        observation_id=observation.id,
        quality_status=observation.quality_status,
        microscope_source_confirmed=has_confirmed_microscope_source(
            observation
        ),
        acquisition_protocol_status=(
            acquisition.protocol_status
            if acquisition is not None
            else "unavailable"
        ),
    )
    if (
        prediction.payload.get("decision_policy_version")
        != DECISION_POLICY_VERSION
    ):
        raise RuntimeError(
            "AI result omitted the current decision-policy version"
        )
    if (
        expected_model_version is not None
        and prediction.model_version != expected_model_version
    ):
        raise RuntimeError(
            "Loaded model version changed while recovering pending "
            "evaluations"
        )
    if (
        expected_model_hash is not None
        and prediction.model_hash != expected_model_hash
    ):
        raise RuntimeError(
            "Loaded model hash changed while recovering pending evaluations"
        )

    result_payload = {
        **prediction.payload,
        "image_quality": {
            "score_percent": observation.quality_score,
            "score_version": QUALITY_SCORE_VERSION,
            "warnings": observation.quality_reason,
            "focus_score": observation.focus_score,
            "mean_brightness": observation.mean_brightness,
            "dark_fraction": observation.dark_fraction,
            "bright_fraction": observation.bright_fraction,
        },
    }
    run = ModelRun(
        observation_id=observation.id,
        model_version=prediction.model_version,
        model_hash=prediction.model_hash,
        backend=prediction.backend,
        score=prediction.score,
        confidence=None,
        attention_level=prediction.attention_level,
        abstained=prediction.abstained,
        abstention_reason=prediction.abstention_reason,
        validation_status=prediction.validation_status,
        domain_status=prediction.domain_status,
        latency_ms=prediction.latency_ms,
        result_json=json.dumps(result_payload, sort_keys=True),
    )
    db.add(run)
    observation.ai_result_json = run.result_json
    db.commit()
    db.refresh(run)
    return run


def evaluate_pending_observations() -> PendingEvaluationReport:
    """Evaluate the latest eligible observation for each lesion once per model."""
    if not settings.ai_enabled:
        return PendingEvaluationReport(None, 0, 0, 0)

    status = ai_service.status()
    model_version = status.get("model_version")
    model_hash = status.get("model_hash")
    if not status.get("ready") or not isinstance(model_version, str):
        logger.warning(
            "Pending AI evaluations skipped because the model is not ready: %s",
            status.get("reason") or "unknown reason",
        )
        return PendingEvaluationReport(model_version, 0, 0, 0)

    with SessionLocal() as db:
        observations = db.scalars(
            select(Observation)
            .options(selectinload(Observation.acquisition))
            .where(Observation.quality_status == "accepted")
            .order_by(
                Observation.lesion_id.asc(),
                Observation.captured_at.desc(),
                Observation.id.desc(),
            )
        ).all()

        latest_by_lesion: dict[int, Observation] = {}
        for observation in observations:
            if observation.lesion_id in latest_by_lesion:
                continue
            if not has_confirmed_microscope_source(observation):
                continue
            latest_by_lesion[observation.lesion_id] = observation

        evaluated = 0
        already_evaluated = 0
        failed = 0
        for observation in latest_by_lesion.values():
            existing_run_payloads = db.scalars(
                select(ModelRun.result_json)
                .where(
                    ModelRun.observation_id == observation.id,
                    ModelRun.model_version == model_version,
                    ModelRun.model_hash == model_hash,
                )
            ).all()
            if any(
                _decision_policy_matches(payload)
                for payload in existing_run_payloads
            ):
                already_evaluated += 1
                continue

            try:
                create_model_run(
                    db,
                    observation,
                    expected_model_version=model_version,
                    expected_model_hash=(
                        model_hash if isinstance(model_hash, str) else None
                    ),
                )
            except Exception:
                db.rollback()
                failed += 1
                logger.exception(
                    "Automatic AI evaluation failed for observation %s",
                    observation.id,
                )
            else:
                evaluated += 1

    report = PendingEvaluationReport(
        model_version=model_version,
        evaluated=evaluated,
        already_evaluated=already_evaluated,
        failed=failed,
    )
    logger.info(
        "Pending AI evaluation recovery completed: model=%s evaluated=%s "
        "already_evaluated=%s failed=%s",
        report.model_version,
        report.evaluated,
        report.already_evaluated,
        report.failed,
    )
    return report


def _decision_policy_matches(result_json: str) -> bool:
    try:
        payload = json.loads(result_json)
    except (json.JSONDecodeError, TypeError):
        return False
    return (
        isinstance(payload, dict)
        and payload.get("decision_policy_version")
        == DECISION_POLICY_VERSION
    )
