"""Add immutable operator longitudinal reviews.

Revision ID: 20260724_0003
Revises: 20260724_0002
Create Date: 2026-07-24
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260724_0003"
down_revision: str | None = "20260724_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "longitudinal_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lesion_id", sa.Integer(), nullable=False),
        sa.Column("baseline_observation_id", sa.Integer(), nullable=False),
        sa.Column("comparison_observation_id", sa.Integer(), nullable=False),
        sa.Column("change_flag", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "baseline_observation_id <> comparison_observation_id",
            name="ck_longitudinal_reviews_distinct_observations",
        ),
        sa.CheckConstraint(
            "change_flag IN "
            "('no_visible_change', 'change_observed', 'uncertain')",
            name="ck_longitudinal_reviews_change_flag",
        ),
        sa.ForeignKeyConstraint(
            ["baseline_observation_id"],
            ["observations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["comparison_observation_id"],
            ["observations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["lesion_id"],
            ["lesions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_longitudinal_reviews_lesion_id",
        "longitudinal_reviews",
        ["lesion_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_longitudinal_reviews_lesion_id",
        table_name="longitudinal_reviews",
    )
    op.drop_table("longitudinal_reviews")
