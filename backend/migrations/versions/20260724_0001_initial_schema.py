"""Create the Express-Derm local schema.

Revision ID: 20260724_0001
Revises:
Create Date: 2026-07-24
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260724_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "acquisition_setup",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("magnification_x", sa.Float(), nullable=True),
        sa.Column("orientation", sa.String(length=32), nullable=False),
        sa.Column("spacer_id", sa.String(length=128), nullable=True),
        sa.Column("illumination", sa.String(length=64), nullable=False),
        sa.Column("exposure", sa.Float(), nullable=True),
        sa.Column("gain", sa.Float(), nullable=True),
        sa.Column("white_balance", sa.Float(), nullable=True),
        sa.Column("focus_threshold", sa.Float(), nullable=False),
        sa.Column("min_brightness", sa.Float(), nullable=False),
        sa.Column("max_brightness", sa.Float(), nullable=False),
        sa.Column("thresholds_status", sa.String(length=32), nullable=False),
        sa.Column("scale_reference_path", sa.String(length=512), nullable=True),
        sa.Column("color_reference_path", sa.String(length=512), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "app_counters",
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("name"),
    )
    op.create_table(
        "patients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("birth_year", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_patients_patient_code",
        "patients",
        ["patient_code"],
        unique=True,
    )
    op.create_table(
        "lesions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("lesion_code", sa.String(length=32), nullable=False),
        sa.Column("body_part", sa.String(length=80), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("z", sa.Float(), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "patient_id",
            "lesion_code",
            name="uq_patient_lesion_code",
        ),
    )
    op.create_index(
        "ix_lesions_patient_id",
        "lesions",
        ["patient_id"],
        unique=False,
    )
    op.create_table(
        "observations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lesion_id", sa.Integer(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("microscope_image_path", sa.String(length=512), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=80), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("focus_score", sa.Float(), nullable=True),
        sa.Column("mean_brightness", sa.Float(), nullable=True),
        sa.Column("dark_fraction", sa.Float(), nullable=True),
        sa.Column("bright_fraction", sa.Float(), nullable=True),
        sa.Column("quality_status", sa.String(length=32), nullable=False),
        sa.Column("quality_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("ai_result_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["lesion_id"],
            ["lesions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_observations_lesion_id",
        "observations",
        ["lesion_id"],
        unique=False,
    )
    op.create_table(
        "model_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("observation_id", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=128), nullable=False),
        sa.Column("model_hash", sa.String(length=128), nullable=True),
        sa.Column("backend", sa.String(length=64), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("attention_level", sa.String(length=32), nullable=False),
        sa.Column("abstained", sa.Boolean(), nullable=False),
        sa.Column("abstention_reason", sa.Text(), nullable=True),
        sa.Column("validation_status", sa.String(length=64), nullable=False),
        sa.Column("domain_status", sa.String(length=64), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["observation_id"],
            ["observations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_model_runs_observation_id",
        "model_runs",
        ["observation_id"],
        unique=False,
    )
    op.create_table(
        "observation_acquisition",
        sa.Column("observation_id", sa.Integer(), nullable=False),
        sa.Column("protocol_revision", sa.Integer(), nullable=False),
        sa.Column("protocol_name", sa.String(length=128), nullable=False),
        sa.Column("protocol_status", sa.String(length=32), nullable=False),
        sa.Column("device_path", sa.String(length=255), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("pixel_format", sa.String(length=32), nullable=False),
        sa.Column("frame_rate", sa.Float(), nullable=True),
        sa.Column("exposure", sa.Float(), nullable=True),
        sa.Column("gain", sa.Float(), nullable=True),
        sa.Column("white_balance", sa.Float(), nullable=True),
        sa.Column("magnification_x", sa.Float(), nullable=True),
        sa.Column("orientation", sa.String(length=32), nullable=False),
        sa.Column("spacer_id", sa.String(length=128), nullable=True),
        sa.Column("illumination", sa.String(length=64), nullable=False),
        sa.Column("focus_threshold", sa.Float(), nullable=False),
        sa.Column("min_brightness", sa.Float(), nullable=False),
        sa.Column("max_brightness", sa.Float(), nullable=False),
        sa.Column("thresholds_status", sa.String(length=32), nullable=False),
        sa.Column("scale_reference_path", sa.String(length=512), nullable=True),
        sa.Column("color_reference_path", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["observation_id"],
            ["observations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("observation_id"),
    )


def downgrade() -> None:
    op.drop_table("observation_acquisition")
    op.drop_index(
        "ix_model_runs_observation_id",
        table_name="model_runs",
    )
    op.drop_table("model_runs")
    op.drop_index(
        "ix_observations_lesion_id",
        table_name="observations",
    )
    op.drop_table("observations")
    op.drop_index(
        "ix_lesions_patient_id",
        table_name="lesions",
    )
    op.drop_table("lesions")
    op.drop_index(
        "ix_patients_patient_code",
        table_name="patients",
    )
    op.drop_table("patients")
    op.drop_table("app_counters")
    op.drop_table("acquisition_setup")
