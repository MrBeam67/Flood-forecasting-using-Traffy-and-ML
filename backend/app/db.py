from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


def _engine_kwargs(url: str) -> dict:
    s = get_settings()
    kw: dict = {
        "pool_pre_ping": True,
        # Supabase free tier: the pooler allows only a few connections per client,
        # so keep the pool small (1 web instance needs only a handful).
        "pool_size": s.db_pool_size,
        "max_overflow": s.db_max_overflow,
        "pool_recycle": 300,  # pooler drops idle connections; recycle before that
    }
    # Supabase *transaction* pooler (port 6543) can't use server-side prepared statements.
    if make_url(url).port == 6543:
        kw["connect_args"] = {"prepare_threshold": None}
    return kw


_url = get_settings().sqlalchemy_url
engine = create_engine(_url, **_engine_kwargs(_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
