from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import Engine, MetaData, create_engine, inspect

from . import models  # noqa: F401
from .database import Base, engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"
APP_TABLES = frozenset(Base.metadata.tables)
LEGACY_BASELINE_REVISION = "20260724_0001"


def _alembic_config(connection) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["connection"] = connection
    return config


def _schema_diffs(connection, metadata: MetaData) -> list[Any]:
    context = MigrationContext.configure(
        connection,
        opts={
            "compare_type": True,
            "compare_server_default": True,
        },
    )
    return compare_metadata(context, metadata)


@lru_cache(maxsize=1)
def _legacy_baseline_metadata() -> MetaData:
    baseline_engine = create_engine("sqlite://")
    metadata = MetaData()
    try:
        with baseline_engine.begin() as connection:
            command.upgrade(
                _alembic_config(connection),
                LEGACY_BASELINE_REVISION,
            )
            metadata.reflect(bind=connection)
    finally:
        baseline_engine.dispose()

    metadata.remove(metadata.tables["alembic_version"])
    return metadata


def _unexpected_legacy_diffs(
    diffs: list[Any],
    existing_tables: set[str],
    expected_tables: set[str] | frozenset[str],
    *,
    allow_missing_tables: bool,
) -> list[Any]:
    unexpected: list[Any] = []
    for difference in diffs:
        if not isinstance(difference, tuple):
            unexpected.append(difference)
            continue
        operation = difference[0]
        subject = difference[1]
        table_name = getattr(subject, "name", None)
        subject_table = getattr(subject, "table", None)
        if subject_table is not None:
            table_name = subject_table.name

        missing_app_table = (
            table_name in expected_tables
            and table_name not in existing_tables
        )
        unrelated_table = table_name not in APP_TABLES
        if (
            allow_missing_tables
            and operation in {"add_table", "add_index"}
            and missing_app_table
        ):
            continue
        if operation in {"remove_table", "remove_index"} and unrelated_table:
            continue
        unexpected.append(difference)
    return unexpected


def _assert_current_schema(connection) -> None:
    table_names = set(inspect(connection).get_table_names())
    unexpected = _unexpected_legacy_diffs(
        _schema_diffs(connection, Base.metadata),
        table_names,
        APP_TABLES,
        allow_missing_tables=False,
    )
    if unexpected:
        raise RuntimeError(
            "Database migration completed but the schema differs from the "
            f"application models: {unexpected}"
        )


def run_migrations(bind: Engine = engine) -> str:
    with bind.begin() as connection:
        table_names = set(inspect(connection).get_table_names())
        config = _alembic_config(connection)
        if "alembic_version" in table_names:
            command.upgrade(config, "head")
            _assert_current_schema(connection)
            return "upgraded"

        existing_app_tables = table_names & APP_TABLES
        if not existing_app_tables:
            command.upgrade(config, "head")
            _assert_current_schema(connection)
            return "upgraded"

        legacy_metadata = _legacy_baseline_metadata()
        legacy_tables = frozenset(legacy_metadata.tables)
        unexpected = _unexpected_legacy_diffs(
            _schema_diffs(connection, legacy_metadata),
            table_names,
            legacy_tables,
            allow_missing_tables=True,
        )
        if unexpected:
            raise RuntimeError(
                "Existing unversioned database does not match the supported "
                f"legacy schema: {unexpected}"
            )

        legacy_metadata.create_all(bind=connection)
        remaining = _unexpected_legacy_diffs(
            _schema_diffs(connection, legacy_metadata),
            set(inspect(connection).get_table_names()),
            legacy_tables,
            allow_missing_tables=False,
        )
        if remaining:
            raise RuntimeError(
                "Legacy database could not be reconciled safely: "
                f"{remaining}"
            )
        command.stamp(config, LEGACY_BASELINE_REVISION)
        command.upgrade(config, "head")
        _assert_current_schema(connection)
        return "adopted"
