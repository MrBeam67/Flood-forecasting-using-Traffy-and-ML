from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    h3_cell: Mapped[str] = mapped_column(String(16), nullable=False, index=True)

    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 0..3
    label: Mapped[str] = mapped_column(String(32), nullable=False)    # e.g. "2_medium"
    score: Mapped[float] = mapped_column(Float, nullable=False)       # 0.0..1.0
    probs: Mapped[dict] = mapped_column(JSON, nullable=False)         # {"0_dry": 0.1, ...}
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)

    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
