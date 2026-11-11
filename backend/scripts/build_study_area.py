"""Build the "study area" outline = Thung Khru district + every grid cell that has
a susceptibility score, and store it as an extra feature in tungkhru.geojson.

The QGIS grid extends ~1 km south of the OSM district line, so the official
boundary cut off part of the risk map. The study area is used for the thick
boundary on the map, the report boundary check, and TMD forecast sampling.
The official district / subdistrict features are kept unchanged.

Usage (repo root), re-run after re-exporting flood_grid.geojson:
    python -m backend.scripts.build_study_area
"""
import argparse
import json
from pathlib import Path

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "data"
M_PER_DEG = 111_320


def fill_holes(geom):
    parts = getattr(geom, "geoms", [geom])
    return unary_union([Polygon(p.exterior) for p in parts])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundary", type=Path, default=DATA / "tungkhru.geojson")
    ap.add_argument("--grid", type=Path, default=DATA / "flood_grid.geojson")
    ap.add_argument("--close-m", type=float, default=150,
                    help="morphological closing radius that bridges gaps between cells (m)")
    args = ap.parse_args()

    fc = json.loads(args.boundary.read_text(encoding="utf-8"))
    feats = [f for f in fc["features"] if not f["properties"].get("study_area")]
    district = shape(next(f for f in feats if f["properties"].get("admin_level") == 6)["geometry"])

    grid = json.loads(args.grid.read_text(encoding="utf-8"))
    cells = unary_union([
        shape(f["geometry"]) for f in grid["features"] if f["properties"].get("suscept") is not None
    ])

    base = unary_union([district, cells])
    e = args.close_m / M_PER_DEG
    area = base.buffer(e, join_style="mitre").buffer(-e, join_style="mitre")
    area = fill_holes(area).simplify(1 / M_PER_DEG)          # ~1 m tolerance
    area = fill_holes(unary_union([area, base]))             # guarantee full coverage
    if area.geom_type != "Polygon":
        raise SystemExit(f"outline is {area.geom_type}; raise --close-m")

    coords = [[round(x, 6), round(y, 6)] for x, y in area.exterior.coords]
    study = {
        "type": "Feature",
        "properties": {
            "study_area": True,
            "name": "พื้นที่ศึกษา (เขตทุ่งครุ + กริดความเสี่ยง)",
            "name_en": "Study area (Thung Khru district + risk grid)",
        },
        "geometry": {"type": "Polygon", "coordinates": [coords]},
    }
    fc["features"] = [study, *feats]
    args.boundary.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    km2 = lambda g: g.area * M_PER_DEG**2 / 1e6  # rough, fine for a log line
    print(f"study area {km2(area):.1f} km² (district {km2(district):.1f} km²), "
          f"{len(coords)} vertices -> {args.boundary}")
    print("bounds", [round(v, 5) for v in area.bounds])


if __name__ == "__main__":
    main()
