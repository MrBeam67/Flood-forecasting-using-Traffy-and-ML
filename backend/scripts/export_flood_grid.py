"""Convert the QGIS flood-factor grid (EPSG:32647, UTM 47N) to a web-ready
WGS84 GeoJSON for Leaflet.

Usage (repo root):
    python -m backend.scripts.export_flood_grid
    python -m backend.scripts.export_flood_grid --src QGIS/product/grid_final.geojson \
        --dst frontend/data/flood_grid.geojson

Pure Python (no pyproj/GDAL needed). Coordinates are rounded to 6 decimals
(~0.1 m), numeric attributes to 4 decimals, to keep the file small.
"""
import argparse
import json
import math
from pathlib import Path

# WGS84 / UTM constants
_A = 6378137.0
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9996
_E1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))


def utm_to_lnglat(x: float, y: float, zone: int = 47, north: bool = True):
    x -= 500000.0
    if not north:
        y -= 10000000.0
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)

    m = y / _K0
    mu = m / (_A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256))
    phi1 = (
        mu
        + (3 * _E1 / 2 - 27 * _E1**3 / 32) * math.sin(2 * mu)
        + (21 * _E1**2 / 16 - 55 * _E1**4 / 32) * math.sin(4 * mu)
        + (151 * _E1**3 / 96) * math.sin(6 * mu)
        + (1097 * _E1**4 / 512) * math.sin(8 * mu)
    )
    s, c, t = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    n1 = _A / math.sqrt(1 - _E2 * s * s)
    t1 = t * t
    c1 = _EP2 * c * c
    r1 = _A * (1 - _E2) / (1 - _E2 * s * s) ** 1.5
    d = x / (n1 * _K0)

    lat = phi1 - (n1 * t / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720
    )
    lon = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120
    ) / c
    return round(math.degrees(lon), 6), round(math.degrees(lat), 6)


def _reproject(coords):
    if isinstance(coords[0], (int, float)):
        return list(utm_to_lnglat(coords[0], coords[1]))
    return [_reproject(c) for c in coords]


KEEP = [
    "id", "suscept", "bcr", "water_mean", "elev_mean", "canal_dist", "road_dens",
    "n_bcr", "n_dem", "n_road", "n_canal",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="QGIS/product/grid_final.geojson")
    ap.add_argument("--dst", default="frontend/data/flood_grid.geojson")
    args = ap.parse_args()

    src = json.loads(Path(args.src).read_text(encoding="utf-8"))
    crs = (src.get("crs") or {}).get("properties", {}).get("name", "")
    if "32647" not in crs:
        raise SystemExit(f"expected EPSG:32647 input, got {crs!r}")

    feats = []
    for f in src["features"]:
        p = f["properties"]
        props = {
            k: (round(p[k], 4) if isinstance(p.get(k), float) else p.get(k)) for k in KEEP
        }
        geom = f["geometry"]
        feats.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": geom["type"], "coordinates": _reproject(geom["coordinates"])},
        })

    out = {"type": "FeatureCollection", "name": "flood_grid", "features": feats}
    Path(args.dst).write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(feats)} features -> {args.dst} ({Path(args.dst).stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
