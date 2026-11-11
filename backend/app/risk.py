"""Forecast flood risk per 100 m grid cell = static susceptibility x forecast rain.

A transparent lookup matrix, not ML: it is a placeholder until enough
(forecast rain, grid features, observed flood reports) data exists to train a
model. Each cell takes the rain of the nearest TMD model point (~3 km grid).
"""
from __future__ import annotations

import json
from functools import lru_cache

from shapely import STRtree
from shapely.geometry import Point, shape

from .config import get_settings
from .weather import rain_level

# Same quintile breaks as SUSCEPT_CLASSES in frontend/js/map.js (index 0..4)
SUSCEPT_BREAKS = (0.37, 0.44, 0.50, 0.56)
SUSCEPT_LABELS = ("ต่ำมาก", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก")

RAIN_INDEX = {"none": 0, "light": 1, "moderate": 2, "heavy": 3, "very_heavy": 4}

# RISK_MATRIX[rain_index][suscept_index] -> 0 ปกติ, 1 เฝ้าระวัง, 2 เสี่ยงท่วม, 3 เสี่ยงสูง
RISK_MATRIX = (
    (0, 0, 0, 0, 0),  # ไม่มีฝน
    (0, 0, 0, 0, 1),  # ฝนเล็กน้อย    0.1-10 mm
    (0, 0, 1, 1, 2),  # ฝนปานกลาง   10.1-35 mm
    (0, 1, 1, 2, 3),  # ฝนหนัก       35.1-90 mm
    (1, 1, 2, 3, 3),  # ฝนหนักมาก    > 90 mm
)
RISK_LABELS = ("ปกติ", "เฝ้าระวัง", "เสี่ยงท่วม", "เสี่ยงสูง")


def suscept_index(s: float) -> int:
    return sum(s >= b for b in SUSCEPT_BREAKS)


def risk_of(suscept: float, rain_mm: float) -> int:
    return RISK_MATRIX[RAIN_INDEX[rain_level(rain_mm)[0]]][suscept_index(suscept)]


@lru_cache
def _grid():
    """(ids, suscept values, centroids, STRtree of cell polygons) for cells with a score."""
    fc = json.loads(get_settings().flood_grid_path.read_text(encoding="utf-8"))
    feats = [f for f in fc["features"] if f["properties"].get("suscept") is not None]
    polys = [shape(f["geometry"]) for f in feats]
    return (
        [f["properties"]["id"] for f in feats],
        [f["properties"]["suscept"] for f in feats],
        [p.centroid for p in polys],
        STRtree(polys),
    )


def _nearest_point_index(points: list[dict], lat: float, lon: float) -> int:
    return min(range(len(points)), key=lambda i: (points[i]["lat"] - lat) ** 2 + (points[i]["lon"] - lon) ** 2)


def risk_grid(forecast: dict, day: int) -> dict:
    """Risk level for every grid cell on forecast day `day` (0 = today)."""
    pts = forecast["points"]
    ids, sus, cents, _ = _grid()
    cells: dict[int, int] = {}
    counts = [0, 0, 0, 0]
    for cid, s, c in zip(ids, sus, cents):
        rain = pts[_nearest_point_index(pts, c.y, c.x)]["rain"][day]
        r = risk_of(s, rain)
        counts[r] += 1
        if r:
            cells[cid] = r  # level 0 omitted to keep the payload small
    return {
        "date": forecast["days"][day]["date"],
        "day": day,
        "labels": RISK_LABELS,
        "counts": counts,            # number of 100 m cells (1 cell = 1 ha) per level
        "cells": cells,
    }


def risk_at(forecast: dict, lat: float, lon: float) -> dict | None:
    """Susceptibility + per-day forecast risk for the grid cell containing (lat, lon)."""
    ids, sus, cents, tree = _grid()
    hit = tree.query(Point(lon, lat), predicate="intersects")
    if len(hit) == 0:
        return None
    i = int(hit[0])
    s = sus[i]
    # Same rain lookup as risk_grid (by cell centroid) so the popup matches the map.
    pt = forecast["points"][_nearest_point_index(forecast["points"], cents[i].y, cents[i].x)]
    days = []
    for d, day in enumerate(forecast["days"]):
        rain = pt["rain"][d]
        r = risk_of(s, rain)
        days.append({"date": day["date"], "rain_mm": rain, "risk": r, "risk_label": RISK_LABELS[r]})
    return {
        "cell_id": ids[i],
        "suscept": s,
        "suscept_label": SUSCEPT_LABELS[suscept_index(s)],
        "days": days,
    }
