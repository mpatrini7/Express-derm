from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai_evaluation import create_model_run
from ..ai_service import ai_service
from ..config import settings
from ..database import get_db
from ..models import ModelRun, Observation
from ..observation_provenance import has_confirmed_microscope_source
from ..schemas import AIStatus, ModelRunRead

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status", response_model=AIStatus)
def status():
    return ai_service.status()


@router.get(
    "/observations/{observation_id}/evaluations",
    response_model=list[ModelRunRead],
)
def list_evaluations(
    observation_id: int,
    db: Session = Depends(get_db),
):
    if db.get(Observation, observation_id) is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    stmt = (
        select(ModelRun)
        .where(ModelRun.observation_id == observation_id)
        .order_by(ModelRun.created_at.desc())
    )
    return db.scalars(stmt).all()


@router.post(
    "/observations/{observation_id}/evaluate",
    response_model=ModelRunRead,
    status_code=201,
)
def evaluate_observation(
    observation_id: int,
    db: Session = Depends(get_db),
):
    observation = db.get(Observation, observation_id)
    if observation is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    if observation.quality_status != "accepted":
        raise HTTPException(
            status_code=422,
            detail="Only quality-accepted microscope images can be evaluated",
        )
    if not has_confirmed_microscope_source(observation):
        raise HTTPException(
            status_code=422,
            detail=(
                "Only source-confirmed microscope images can be evaluated"
            ),
        )
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")

    try:
        return create_model_run(db, observation)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
