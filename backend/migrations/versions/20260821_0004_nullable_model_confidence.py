"""Make removed model confidence nullable.

Revision ID: 20260821_0004
Revises: 20260724_0003
Create Date: 2026-08-21
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260821_0004"
down_revision: str | None = "20260724_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("model_runs") as batch_op:
        batch_op.alter_column(
            "confidence",
            existing_type=sa.Float(),
            nullable=True,
        )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE model_runs SET confidence = 0.0 "
            "WHERE confidence IS NULL"
        )
    )
    with op.batch_alter_table("model_runs") as batch_op:
        batch_op.alter_column(
            "confidence",
            existing_type=sa.Float(),
            nullable=False,
        )
