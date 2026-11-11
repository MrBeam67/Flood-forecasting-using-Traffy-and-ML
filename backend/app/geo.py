"""Geo helpers: district boundary check, H3 cells, time-decayed aggregation."""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache

import h3
from shapely.geometry import Point, shape
from shapely.prepared import prep

from .config import get_settings

DEG_PER_M = 1 / 111_320  # good enough at Bangkok's latitude for a small buffer


@lru_cache
def service_area():
    """Shapely geometry of the area we serve: the study-area outline (district + risk
    grid, see backend/scripts/build_study_area.py), else the district (admin_level 6)."""
    fc = json.loads(get_settings().boundary_path.read_text(encoding="utf-8"))
    feats = fc["features"]
    f = (next((f for f in feats if f["properties"].get("study_area")), None)
         or next((f for f in feats if f["properties"].get("admin_level") == 6), feats[0]))
    return shape(f["geometry"])


@lru_cache
def _district():
    """Prepared service-area polygon, buffered a little for the report boundary check."""
    s = get_settings()
    poly = service_area().buffer(s.boundary_buffer_m * DEG_PER_M)
    return prep(poly)


def in_district(lat: float, lng: float) -> bool:
    return _district().contains(Point(lng, lat))


def cell_of(lat: float, lng: float, res: int | None = None) -> str:
    return h3.latlng_to_cell(lat, lng, res or get_settings().hex_resolution)


def as_utc(dt: datetime) -> datetime:
    """DB timestamps are UTC; some drivers (e.g. SQLite) return them without tzinfo."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def decay_weight(created_at: datetime, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    created_at = as_utc(created_at)
    age_h = max((now - created_at).total_seconds() / 3600, 0.0)
    return math.exp(-age_h / get_settings().decay_hours)


def heat_points(rows, now=None, merge_res: int = 11) -> list[list[float]]:
    """[[lat, lng, intensity], ...] for leaflet.heat.

    intensity = score * time decay. Reports that fall in the same tiny H3 cell
    (res 11, ~25 m) are merged with max(), so 20 reports from one street corner
    don't look worse than 1 report of deep water.
    """
    best: dict[str, list[float]] = {}
    for r in rows:
        w = r.score * decay_weight(r.observed_at, now)
        key = h3.latlng_to_cell(r.lat, r.lng, merge_res)
        if key not in best or w > best[key][2]:
            best[key] = [r.lat, r.lng, w]
    return [[round(a, 6), round(b, 6), round(c, 4)] for a, b, c in best.values() if c > 0.01]


def hex_grid(rows, now=None) -> dict:
    """GeoJSON FeatureCollection, one hexagon per H3 cell that has reports.

    severity   = decay-weighted mean score (what the area looks like *now*)
    confidence = sum of decay weights (≈ number of recent reports), used for opacity
    """
    acc = defaultdict(lambda: {"wsum": 0.0, "wscore": 0.0, "n": 0, "max": 0.0, "latest": None})
    for r in rows:
        w = decay_weight(r.observed_at, now)
        a = acc[r.h3_cell]
        a["wsum"] += w
        a["wscore"] += w * r.score
        a["n"] += 1
        a["max"] = max(a["max"], r.score)
        if a["latest"] is None or r.observed_at > a["latest"]:
            a["latest"] = r.observed_at

    features = []
    for cell, a in acc.items():
        if a["wsum"] < 1e-3:
            continue
        ring = [[lng, lat] for lat, lng in h3.cell_to_boundary(cell)]
        ring.append(ring[0])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "cell": cell,
                "severity": round(a["wscore"] / a["wsum"], 4),
                "confidence": round(a["wsum"], 3),
                "max_score": round(a["max"], 4),
                "count": a["n"],
                "latest": as_utc(a["latest"]).isoformat(),
            },
        })
    return {"type": "FeatureCollection", "features": features}
