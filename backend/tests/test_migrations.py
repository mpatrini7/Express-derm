from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.database import engine as app_engine
from app.migrations import (
    APP_TABLES,
    _legacy_baseline_metadata,
    run_migrations,
)
from app.models import Patient

REVISION = "20260901_0006"


def migration_engine(database_path: Path) -> Engine:
    return create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )


def current_revision(bind: Engine) -> str:
    with bind.connect() as connection:
        return connection.scalar(
            text("SELECT version_num FROM alembic_version")
        )


def test_fresh_database_upgrades_to_head_and_is_idempotent(tmp_path: Path) -> None:
    bind = migration_engine(tmp_path / "fresh.db")
    try:
        assert run_migrations(bind) == "upgraded"
        assert set(inspect(bind).get_table_names()) == APP_TABLES | {
            "alembic_version"
        }
        assert current_revision(bind) == REVISION
        confidence_column = next(
            column
            for column in inspect(bind).get_columns("model_runs")
            if column["name"] == "confidence"
        )
        assert confidence_column["nullable"] is True
        quality_score_column = next(
            column
            for column in inspect(bind).get_columns("observations")
            if column["name"] == "quality_score"
        )
        assert quality_score_column["nullable"] is True

        assert run_migrations(bind) == "upgraded"
        assert current_revision(bind) == REVISION
    finally:
        bind.dispose()


def test_current_unversioned_database_is_adopted_without_data_loss(
    tmp_path: Path,
) -> None:
    bind = migration_engine(tmp_path / "legacy-current.db")
    try:
        _legacy_baseline_metadata().create_all(bind)
        with bind.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE local_notes "
                "(id INTEGER PRIMARY KEY, note TEXT NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO local_notes (id, note) VALUES (1, 'keep me')"
            )
        with Session(bind) as session:
            patient = Patient(
                patient_code="P-000042",
                display_name="Legacy patient",
            )
            session.add(patient)
            session.commit()
            patient_id = patient.id

        assert run_migrations(bind) == "adopted"
        assert current_revision(bind) == REVISION

        with Session(bind) as session:
            preserved = session.get(Patient, patient_id)
            assert preserved is not None
            assert preserved.display_name == "Legacy patient"
        with bind.connect() as connection:
            assert connection.scalar(
                text("SELECT note FROM local_notes WHERE id = 1")
            ) == "keep me"
    finally:
        bind.dispose()


def test_older_unversioned_database_gets_only_missing_known_tables(
    tmp_path: Path,
) -> None:
    bind = migration_engine(tmp_path / "legacy-partial.db")
    legacy_metadata = _legacy_baseline_metadata()
    legacy_tables = [
        legacy_metadata.tables[table_name]
        for table_name in (
            "patients",
            "lesions",
            "observations",
            "model_runs",
        )
    ]
    try:
        legacy_metadata.create_all(bind, tables=legacy_tables)
        with Session(bind) as session:
            patient = Patient(
                patient_code="P-000007",
                display_name="Preserved patient",
            )
            session.add(patient)
            session.commit()
            patient_id = patient.id

        assert run_migrations(bind) == "adopted"
        assert set(inspect(bind).get_table_names()) == APP_TABLES | {
            "alembic_version"
        }
        with Session(bind) as session:
            assert session.get(Patient, patient_id) is not None
    finally:
        bind.dispose()


def test_divergent_unversioned_database_is_rejected(tmp_path: Path) -> None:
    bind = migration_engine(tmp_path / "divergent.db")
    try:
        with bind.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE patients (id INTEGER PRIMARY KEY)"
            )

        with pytest.raises(
            RuntimeError,
            match="does not match the supported legacy schema",
        ):
            run_migrations(bind)

        assert set(inspect(bind).get_table_names()) == {"patients"}
    finally:
        bind.dispose()


def test_versioned_database_with_schema_drift_is_rejected(
    tmp_path: Path,
) -> None:
    bind = migration_engine(tmp_path / "versioned-drift.db")
    try:
        run_migrations(bind)
        with bind.begin() as connection:
            connection.exec_driver_sql("DROP TABLE app_counters")

        with pytest.raises(
            RuntimeError,
            match="schema differs from the application models",
        ):
            run_migrations(bind)
    finally:
        bind.dispose()


def test_application_sqlite_connections_enforce_foreign_keys() -> None:
    with app_engine.connect() as connection:
        assert connection.exec_driver_sql(
            "PRAGMA foreign_keys"
        ).scalar_one() == 1
