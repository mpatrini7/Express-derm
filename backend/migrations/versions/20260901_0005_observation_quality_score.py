"""Persist the advisory microscope-image quality score.

Revision ID: 20260901_0005
Revises: 20260821_0004
Create Date: 2026-09-01
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260901_0005"
down_revision: str | None = "20260821_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("observations") as batch_op:
        batch_op.add_column(
            sa.Column("quality_score", sa.Float(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("observations") as batch_op:
        batch_op.drop_column("quality_score")
