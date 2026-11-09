"""Insert fake reports inside Thung Khru so the map has something to show.

Usage (repo root):  python -m backend.scripts.seed_demo --n 120
Remove them again:  python -m backend.scripts.seed_demo --clear
"""
import argparse
import random
from datetime import datetime, timedelta, timezone

from shapely.geometry import Point, shape
import json

from backend.app import geo
from backend.app.config import get_settings
from backend.app.db import SessionLocal
from backend.app.models import Report

DEMO = "demo-seed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--clear", action="store_true")
    args = ap.parse_args()

    with SessionLocal() as db:
        if args.clear:
            n = db.query(Report).filter(Report.model_version == DEMO).delete()
            db.commit()
            print(f"deleted {n} demo reports")
            return

        fc = json.loads(get_settings().boundary_path.read_text(encoding="utf-8"))
        poly = shape(next(f for f in fc["features"] if f["properties"]["admin_level"] == 6)["geometry"])
        minx, miny, maxx, maxy = poly.bounds
        rng = random.Random(7)
        # a few flood "hotspots" so the map looks like real clustered reports
        spots = []
        while len(spots) < 5:
            p = (rng.uniform(miny, maxy), rng.uniform(minx, maxx))
            if poly.contains(Point(p[1], p[0])):
                spots.append((p, rng.uniform(0.3, 1.0)))

        now = datetime.now(timezone.utc)
        added = 0
        while added < args.n:
            (clat, clng), base = rng.choice(spots)
            lat, lng = rng.gauss(clat, 0.004), rng.gauss(clng, 0.004)
            if not poly.contains(Point(lng, lat)):
                continue
            score = min(max(rng.gauss(base, 0.15), 0), 1)
            level = min(int(score * 3 + 0.5), 3)
            label = ["0_dry", "1_low", "2_medium", "3_high"][level]
            db.add(Report(
                lat=lat, lng=lng, h3_cell=geo.cell_of(lat, lng), level=level, label=label,
                score=round(score, 3), probs={label: 1.0}, model_version=DEMO,
                image_url="https://placehold.co/400x300?text=demo",
                created_at=now - timedelta(hours=rng.uniform(0, 30)),
            ))
            added += 1
        db.commit()
        print(f"added {added} demo reports")


if __name__ == "__main__":
    main()
