"""Add immutable lesion edit and relocation audit events.

Revision ID: 20260724_0002
Revises: 20260724_0001
Create Date: 2026-07-24
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260724_0002"
down_revision: str | None = "20260724_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lesion_audit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lesion_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("previous_state", sa.JSON(), nullable=False),
        sa.Column("current_state", sa.JSON(), nullable=False),
        sa.Column("change_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["lesion_id"],
            ["lesions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_lesion_audit_events_lesion_id",
        "lesion_audit_events",
        ["lesion_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lesion_audit_events_lesion_id",
        table_name="lesion_audit_events",
    )
    op.drop_table("lesion_audit_events")
