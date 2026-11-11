"""FastAPI app: flood report API + serves the static frontend.

Run locally (from the repo root):
    uvicorn backend.app.main:app --reload
"""
from __future__ import annotations

import io
import logging
import mimetypes
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import geo, risk, weather
from .config import ROOT_DIR, get_settings
from .db import get_db
from .inference import get_classifier
from .models import Report
from .storage import parse_cloudinary_url, sanitize_image, save_image

# Windows can map .js to text/plain in the registry, which breaks ES module loading.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/geo+json", ".geojson")

logging.basicConfig(level=logging.INFO)
settings = get_settings()
if settings.storage_backend == "cloudinary":
    parse_cloudinary_url(settings.cloudinary_url)  # fail at deploy, not at the first upload
app = FastAPI(title="Thung Khru Flood Map", version="0.1.0")

FRONTEND_DIR = ROOT_DIR / "frontend"
MAX_HOURS = 24 * 30


# ---------------------------------------------------------------- helpers
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(request: Request) -> None:
    """Simple in-memory limit per client IP (fine for a single instance)."""
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")
    q, now = _hits[ip], time.monotonic()
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= settings.rate_limit_per_10min:
        raise HTTPException(429, "ส่งรายงานบ่อยเกินไป กรุณารอสักครู่")
    q.append(now)


def _recent(db: Session, hours: float) -> list[Report]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return list(db.scalars(select(Report).where(Report.observed_at >= since, Report.observed_at <= _now_slack())))


def _report_json(r: Report) -> dict:
    return {
        "id": r.id, "lat": r.lat, "lng": r.lng, "level": r.level, "label": r.label,
        "score": r.score, "probs": r.probs, "model_version": r.model_version,
        "image_url": r.image_url, "created_at": geo.as_utc(r.created_at).isoformat(),
        "observed_at": geo.as_utc(r.observed_at).isoformat(), "observed_source": r.observed_source,
    }


BKK = timezone(timedelta(hours=7))
MAX_REPORT_AGE_DAYS = 30
FUTURE_SLACK = timedelta(minutes=10)  # phone clocks drift a little


def _now_slack() -> datetime:
    return datetime.now(timezone.utc) + FUTURE_SLACK


def _exif_taken_at(img: Image.Image) -> datetime | None:
    """DateTimeOriginal (+ OffsetTimeOriginal) from the photo; local Thai time if no offset."""
    try:
        exif = img.getexif()
        sub = exif.get_ifd(0x8769)  # Exif sub-IFD
        raw = sub.get(0x9003) or exif.get(0x0132)  # DateTimeOriginal, else DateTime
        if not raw:
            return None
        dt = datetime.strptime(str(raw).strip("\x00 ")[:19], "%Y:%m:%d %H:%M:%S")
        off = str(sub.get(0x9011) or "").strip("\x00 ")
        if len(off) == 6 and off[0] in "+-":
            sign = 1 if off[0] == "+" else -1
            tz = timezone(sign * timedelta(hours=int(off[1:3]), minutes=int(off[4:6])))
        else:
            tz = BKK
        return dt.replace(tzinfo=tz)
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


# ---------------------------------------------------------------- API
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "model": get_classifier().version}


@app.get("/api/config")
def config():
    return {
        "model_version": get_classifier().version,
        "hex_resolution": settings.hex_resolution,
        "decay_hours": settings.decay_hours,
        "enforce_boundary": settings.enforce_boundary,
        "max_upload_mb": settings.max_upload_mb,
    }


@app.post("/api/reports", status_code=201)
async def create_report(
    request: Request,
    image: UploadFile = File(...),
    lat: float = Form(..., ge=-90, le=90),
    lng: float = Form(..., ge=-180, le=180),
    observed_at: datetime | None = Form(None),   # ISO 8601; naive = Thai local time
    observed_source: str = Form("user"),         # exif | user | now
    db: Session = Depends(get_db),
):
    _rate_limit(request)

    if settings.enforce_boundary and not geo.in_district(lat, lng):
        raise HTTPException(422, "พิกัดอยู่นอกเขตทุ่งครุ")

    raw = await image.read(int(settings.max_upload_mb * 1024 * 1024) + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"ไฟล์ใหญ่เกิน {settings.max_upload_mb:g} MB")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(415, "ไฟล์นี้ไม่ใช่รูปภาพ")

    # When was it? Prefer what the browser sent (it read EXIF or the user picked),
    # then EXIF read here, then the upload time.
    now = datetime.now(timezone.utc)
    source = observed_source if observed_source in ("exif", "user", "now") else "user"
    if observed_at is None:
        observed_at = _exif_taken_at(img)
        source = "exif" if observed_at else "server"
    if observed_at is None:
        observed_at = now
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=BKK)
    if observed_at > now + FUTURE_SLACK:
        raise HTTPException(422, "วันเวลาที่ถ่ายรูปอยู่ในอนาคต กรุณาตรวจสอบ")
    if observed_at < now - timedelta(days=MAX_REPORT_AGE_DAYS):
        raise HTTPException(422, f"รูปเก่าเกิน {MAX_REPORT_AGE_DAYS} วัน ไม่สามารถใช้แจ้งได้")

    clean = sanitize_image(img)
    pred = get_classifier().predict(Image.open(io.BytesIO(clean)))
    url = save_image(clean)

    report = Report(
        lat=lat, lng=lng, h3_cell=geo.cell_of(lat, lng),
        level=pred.level, label=pred.label, score=pred.score, probs=pred.probs,
        model_version=pred.model_version, image_url=url,
        observed_at=observed_at, observed_source=source,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _report_json(report)


@app.get("/api/reports")
def list_reports(hours: float = Query(24, gt=0, le=MAX_HOURS), db: Session = Depends(get_db)):
    rows = sorted(_recent(db, hours), key=lambda r: r.observed_at, reverse=True)
    return [_report_json(r) for r in rows[:500]]


@app.get("/api/heatmap")
def heatmap(hours: float = Query(24, gt=0, le=MAX_HOURS), db: Session = Depends(get_db)):
    """[[lat, lng, intensity], ...]  (intensity = score x time decay)"""
    return geo.heat_points(_recent(db, hours))


@app.get("/api/hexgrid")
def hexgrid(hours: float = Query(24, gt=0, le=MAX_HOURS), db: Session = Depends(get_db)):
    """GeoJSON of H3 hexagons with severity / confidence / count."""
    return geo.hex_grid(_recent(db, hours))


@app.get("/api/area")
def area(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    hours: float = Query(24, gt=0, le=MAX_HOURS),
    db: Session = Depends(get_db),
):
    """'Is my area flooded?': summary for the hexagon containing (lat, lng)."""
    cell = geo.cell_of(lat, lng)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = list(db.scalars(
        select(Report).where(Report.h3_cell == cell, Report.observed_at >= since,
                             Report.observed_at <= _now_slack())
    ))
    feats = geo.hex_grid(rows)["features"]
    return {
        "cell": cell,
        "in_district": geo.in_district(lat, lng),
        "summary": feats[0]["properties"] if feats else None,
    }


@app.get("/api/forecast/rain")
async def rain_forecast():
    """3-day rain forecast for the district (TMD NWP, cached server-side)."""
    return await _forecast()


async def _forecast() -> dict:
    try:
        return await weather.get_rain_forecast()
    except weather.ForecastUnavailable as e:
        raise HTTPException(503, str(e)) from e


@app.get("/api/forecast/risk")
async def risk_forecast(day: int = Query(0, ge=0, le=weather.FORECAST_DAYS - 1)):
    """Forecast flood risk (0-3) per 100 m grid cell for one day. Level-0 cells are omitted."""
    f = await _forecast()
    if day >= len(f["days"]):
        raise HTTPException(404, "ไม่มีพยากรณ์ของวันนี้")
    return {**risk.risk_grid(f, day), "fetched_at": f["fetched_at"], "stale": f["stale"]}


@app.get("/api/forecast/risk/at")
async def risk_forecast_at(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    """Susceptibility + 3-day forecast risk for the grid cell containing (lat, lng)."""
    return {"cell": risk.risk_at(await _forecast(), lat, lng)}


# ---------------------------------------------------------------- static files
settings.upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(FRONTEND_DIR / "index.html")
