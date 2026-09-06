import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="express-derm-tests-"))
os.environ["EXPRESS_DERM_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["EXPRESS_DERM_AI_ENABLED"] = "false"

from app.camera import camera_manager
from app.config import settings
from app.database import Base, engine
from app.main import app
from app.migrations import run_migrations

if settings.data_dir.resolve() != TEST_DATA_DIR.resolve():
    raise RuntimeError(
        "Backend tests must use their isolated temporary data directory; "
        "refusing to touch the local application database."
    )


@pytest.fixture(autouse=True)
def reset_storage() -> Iterator[None]:
    engine.dispose()
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    run_migrations()
    shutil.rmtree(settings.image_dir, ignore_errors=True)
    settings.image_dir.mkdir(parents=True, exist_ok=True)
    yield
    camera_manager.stop_all()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data() -> Iterator[None]:
    yield
    engine.dispose()
    shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
