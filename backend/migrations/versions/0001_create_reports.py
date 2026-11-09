"""create reports table

Revision ID: 0001
Revises:
Create Date: 2026-11-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lng", sa.Float, nullable=False),
        sa.Column("h3_cell", sa.String(16), nullable=False),
        sa.Column("level", sa.SmallInteger, nullable=False),
        sa.Column("label", sa.String(32), nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("probs", sa.JSON, nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("image_url", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reports_h3_cell", "reports", ["h3_cell"])
    op.create_index("ix_reports_created_at", "reports", ["created_at"])


def downgrade():
    op.drop_table("reports")
