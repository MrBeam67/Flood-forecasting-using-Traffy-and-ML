"""enable row level security on public tables

Supabase exposes every table in the `public` schema through its REST API (PostgREST)
to anyone holding the project's anon key, which is not a secret. Turning RLS on with
no policies blocks that path completely. The backend is unaffected: it connects as
the `postgres` role, which owns the tables and bypasses RLS.

Harmless on a plain local Postgres.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-11
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TABLES = ("reports", "alembic_version")


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for t in TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for t in TABLES:
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
