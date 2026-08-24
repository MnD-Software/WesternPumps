"""Add job approval workflow fields

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-18
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '0003'
down_revision = '0002_platform_hardening'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "jobs" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("jobs")}

    # Add approval workflow columns to jobs table (idempotent)
    if "approved_by_user_id" not in cols:
        op.add_column('jobs', sa.Column('approved_by_user_id', sa.Integer(), nullable=True))
    if "approved_at" not in cols:
        op.add_column('jobs', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    if "approval_notes" not in cols:
        op.add_column('jobs', sa.Column('approval_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "jobs" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("jobs")}
    if "approval_notes" in cols:
        op.drop_column('jobs', 'approval_notes')
    if "approved_at" in cols:
        op.drop_column('jobs', 'approved_at')
    if "approved_by_user_id" in cols:
        op.drop_column('jobs', 'approved_by_user_id')
