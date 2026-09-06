import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .ai_evaluation import evaluate_pending_observations
from .camera import camera_manager
from .config import settings
from .migrations import run_migrations
from .risk_policy import FOLLOW_UP_POLICY_VERSION
from .routers import (
    acquisition,
    ai,
    camera,
    clinical_photos,
    lesions,
    observations,
    patients,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    try:
        evaluate_pending_observations()
    except Exception:
        # A recovery failure must not make the offline clinical record unusable.
        logger.exception(
            "Pending AI evaluation recovery failed during startup"
        )
    yield
    camera_manager.stop_all()


app = FastAPI(
    title="Express-Derm BodyMap API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patients.router, prefix="/api")
app.include_router(lesions.router, prefix="/api")
app.include_router(observations.router, prefix="/api")
app.include_router(camera.router, prefix="/api")
app.include_router(clinical_photos.router, prefix="/api")
app.include_router(acquisition.router, prefix="/api")
app.include_router(ai.router, prefix="/api")

app.mount(
    "/media/images",
    StaticFiles(directory=settings.image_dir),
    name="microscope-images",
)


@app.api_route("/api/health", methods=["GET", "HEAD"])
def health():
    return {
        "status": "ok",
        "follow_up_policy_version": FOLLOW_UP_POLICY_VERSION,
    }
