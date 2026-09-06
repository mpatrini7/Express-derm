"""Add multi-lesion clinical photo candidate workflow.

Revision ID: 20260901_0006
Revises: 20260901_0005
Create Date: 2026-09-01
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260901_0006"
down_revision: str | None = "20260901_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "clinical_photos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("image_path", sa.String(length=512), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=80), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("focus_score", sa.Float(), nullable=False),
        sa.Column("mean_brightness", sa.Float(), nullable=False),
        sa.Column("dark_fraction", sa.Float(), nullable=False),
        sa.Column("bright_fraction", sa.Float(), nullable=False),
        sa.Column("quality_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clinical_photos_patient_id", "clinical_photos", ["patient_id"])
    op.create_table(
        "clinical_photo_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("clinical_photo_id", sa.Integer(), nullable=False),
        sa.Column("candidate_index", sa.Integer(), nullable=False),
        sa.Column("crop_image_path", sa.String(length=512), nullable=False),
        sa.Column("bbox_x", sa.Integer(), nullable=False),
        sa.Column("bbox_y", sa.Integer(), nullable=False),
        sa.Column("bbox_width", sa.Integer(), nullable=False),
        sa.Column("bbox_height", sa.Integer(), nullable=False),
        sa.Column("detection_score", sa.Float(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("focus_score", sa.Float(), nullable=False),
        sa.Column("mean_brightness", sa.Float(), nullable=False),
        sa.Column("dark_fraction", sa.Float(), nullable=False),
        sa.Column("bright_fraction", sa.Float(), nullable=False),
        sa.Column("quality_reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("assigned_lesion_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'assigned', 'dismissed')",
            name="ck_clinical_photo_candidate_status",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_lesion_id"], ["lesions.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["clinical_photo_id"], ["clinical_photos.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "clinical_photo_id", "candidate_index", name="uq_clinical_photo_candidate_index"
        ),
    )
    op.create_index(
        "ix_clinical_photo_candidates_clinical_photo_id",
        "clinical_photo_candidates",
        ["clinical_photo_id"],
    )
    op.create_index(
        "ix_clinical_photo_candidates_assigned_lesion_id",
        "clinical_photo_candidates",
        ["assigned_lesion_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_clinical_photo_candidates_assigned_lesion_id",
        table_name="clinical_photo_candidates",
    )
    op.drop_index(
        "ix_clinical_photo_candidates_clinical_photo_id",
        table_name="clinical_photo_candidates",
    )
    op.drop_table("clinical_photo_candidates")
    op.drop_index("ix_clinical_photos_patient_id", table_name="clinical_photos")
    op.drop_table("clinical_photos")
