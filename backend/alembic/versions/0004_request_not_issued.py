"""Add not-issued stock request outcome.

Revision ID: 0004_request_not_issued
Revises: 0003
Create Date: 2026-09-09
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_request_not_issued"
down_revision = "0003"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "stock_requests" not in inspector.get_table_names():
        return

    dialect = bind.dialect.name
    if dialect == "postgresql":
        op.execute("ALTER TYPE stock_request_status ADD VALUE IF NOT EXISTS 'NOT_ISSUED'")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE stock_requests MODIFY COLUMN status "
            "ENUM('PENDING','APPROVED','REJECTED','NOT_ISSUED','ISSUED','CLOSED') NOT NULL"
        )

    if not _has_column(inspector, "stock_requests", "not_issued_reason"):
        op.add_column("stock_requests", sa.Column("not_issued_reason", sa.Text(), nullable=True))
    if not _has_column(inspector, "stock_requests", "not_issued_by_user_id"):
        op.add_column("stock_requests", sa.Column("not_issued_by_user_id", sa.Integer(), nullable=True))
    if not _has_column(inspector, "stock_requests", "not_issued_at"):
        op.add_column("stock_requests", sa.Column("not_issued_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "stock_requests" not in inspector.get_table_names():
        return
    for column_name in ("not_issued_at", "not_issued_by_user_id", "not_issued_reason"):
        if _has_column(inspector, "stock_requests", column_name):
            op.drop_column("stock_requests", column_name)
