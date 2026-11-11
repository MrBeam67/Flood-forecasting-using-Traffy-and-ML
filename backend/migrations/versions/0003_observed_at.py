"""add reports.observed_at / observed_source (when the photo was taken)

Existing rows get observed_at = created_at and observed_source = 'server'.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reports", sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reports", sa.Column(
        "observed_source", sa.String(8), nullable=False, server_default="server"))
    op.execute("UPDATE reports SET observed_at = created_at WHERE observed_at IS NULL")
    op.alter_column("reports", "observed_at", nullable=False, server_default=sa.func.now())
    op.create_index("ix_reports_observed_at", "reports", ["observed_at"])


def downgrade():
    op.drop_index("ix_reports_observed_at", table_name="reports")
    op.drop_column("reports", "observed_source")
    op.drop_column("reports", "observed_at")
