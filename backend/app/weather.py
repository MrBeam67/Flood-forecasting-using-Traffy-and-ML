"""3-day rain forecast for Thung Khru from the TMD NWP API (data.tmd.go.th/nwpapi).

The TMD model grid is ~3 km, so the whole district covers only a handful of model
points. We sample a 3x3 grid over the district bbox, de-duplicate by the model
point TMD snaps each request to, and cache the result in memory. The access
token stays on the server; the frontend only sees `/api/forecast/rain`.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import httpx

from .config import get_settings
from .geo import service_area

log = logging.getLogger(__name__)

TMD_DAILY_URL = "https://data.tmd.go.th/nwpapi/v1/forecast/location/daily/at"
BKK = timezone(timedelta(hours=7))
FORECAST_DAYS = 10  # TMD daily forecast covers today + 9 days

# TMD 24-hour rainfall criteria (mm): (upper bound, key, Thai label)
RAIN_LEVELS = [
    (0.1, "none", "ไม่มีฝน"),
    (10.1, "light", "ฝนเล็กน้อย"),
    (35.1, "moderate", "ฝนปานกลาง"),
    (90.1, "heavy", "ฝนหนัก"),
    (float("inf"), "very_heavy", "ฝนหนักมาก"),
]


class ForecastUnavailable(Exception):
    """No token configured, or TMD failed and there is nothing cached."""


def rain_level(mm: float) -> tuple[str, str]:
    for upper, key, label in RAIN_LEVELS:
        if mm < upper:
            return key, label
    return RAIN_LEVELS[-1][1], RAIN_LEVELS[-1][2]


@lru_cache
def sample_points() -> list[tuple[float, float]]:
    """3x3 (lat, lon) grid over the service-area bbox (~2.5-4 km spacing)."""
    minx, miny, maxx, maxy = service_area().bounds
    steps = (0.0, 0.5, 1.0)
    return [
        (round(miny + (maxy - miny) * fy, 4), round(minx + (maxx - minx) * fx, 4))
        for fy in steps for fx in steps
    ]


async def _fetch_point(client: httpx.AsyncClient, lat: float, lon: float, start: str) -> dict:
    r = await client.get(TMD_DAILY_URL, params={
        "lat": lat, "lon": lon, "fields": "rain", "date": start, "duration": FORECAST_DAYS,
    })
    r.raise_for_status()
    return r.json()["WeatherForecasts"][0]


async def _fetch() -> dict:
    s = get_settings()
    if not s.tmd_opendata:
        raise ForecastUnavailable("ยังไม่ได้ตั้งค่า TMD_OPENDATA")

    start = datetime.now(BKK).date().isoformat()
    headers = {"accept": "application/json", "authorization": f"Bearer {s.tmd_opendata}"}
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        results = await asyncio.gather(
            *(_fetch_point(client, lat, lon, start) for lat, lon in sample_points())
        )

    # De-duplicate: several samples snap to the same TMD model point.
    points: dict[tuple[float, float], list[dict]] = {}
    for res in results:
        loc = res["location"]
        points[(loc["lat"], loc["lon"])] = res["forecasts"]

    days = []
    for i in range(FORECAST_DAYS):
        vals = [float(fc[i]["data"].get("rain") or 0) for fc in points.values() if len(fc) > i]
        if not vals:
            continue
        date = next(fc[i]["time"] for fc in points.values() if len(fc) > i)[:10]
        rain_max = max(vals)
        key, label = rain_level(rain_max)
        days.append({
            "date": date,
            "rain_max": round(rain_max, 1),           # worst model point in the district
            "rain_mean": round(sum(vals) / len(vals), 1),
            "rain_min": round(min(vals), 1),
            "level": key,
            "level_label": label,
        })

    return {
        "source": "TMD NWP",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "points": [
            {"lat": lat, "lon": lon, "rain": [round(float(f["data"].get("rain") or 0), 1) for f in fc]}
            for (lat, lon), fc in points.items()
        ],
        "days": days,
    }


_cache: dict | None = None
_cache_at = 0.0
_lock = asyncio.Lock()


async def get_rain_forecast() -> dict:
    """Cached forecast. If TMD fails, serve the last good copy marked `stale`."""
    global _cache, _cache_at
    ttl = get_settings().rain_cache_minutes * 60
    if _cache and time.monotonic() - _cache_at < ttl:
        return {**_cache, "stale": False}
    async with _lock:
        if _cache and time.monotonic() - _cache_at < ttl:  # another request refreshed it
            return {**_cache, "stale": False}
        try:
            _cache, _cache_at = await _fetch(), time.monotonic()
            return {**_cache, "stale": False}
        except ForecastUnavailable:
            raise
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
            log.warning("TMD forecast fetch failed: %r", e)
            if _cache:
                return {**_cache, "stale": True}
            raise ForecastUnavailable("ดึงพยากรณ์จากกรมอุตุฯ ไม่สำเร็จ") from e
