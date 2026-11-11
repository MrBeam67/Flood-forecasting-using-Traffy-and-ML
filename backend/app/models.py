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
    # When the photo was taken / the flood was seen. All map and time-window logic
    # uses this, not created_at (a photo may be uploaded hours later).
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    # Where observed_at came from: "exif" (photo metadata), "user" (picked in the form),
    # "now" (reporter ticked "ตอนนี้"), "server" (nothing given, upload time).
    observed_source: Mapped[str] = mapped_column(String(8), nullable=False, server_default="server")
