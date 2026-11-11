"""Export a trained YOLO .pt (classification or detection) to ONNX for the backend.

Classification: class folder names should start with the level number (0_dry, 1_low, ...).
Detection: class names are mapped to water levels with DETECT_LEVELS below
(none=0, ankle=1, knee=2, waist=3, neck_up=4, flood=2 because it has no depth info).

Usage:
    python ml/export_onnx.py                                   # uses ml/runs/flood_cls/weights/best.pt
    python ml/export_onnx.py --weights backend/best.pt --version v1-2026-11

Writes:
    backend/models/flood_cls.onnx
    backend/models/flood_cls.json   (task, class names, levels, image size, version)
"""
import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent
OUT_DIR = ML_DIR.parent / "backend" / "models"

# Water level for each detection class (max level = 4 -> score 1.0).
DETECT_LEVELS = {"none": 0, "ankle": 1, "knee": 2, "waist": 3, "neck_up": 4, "flood": 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(ML_DIR / "runs" / "flood_cls" / "weights" / "best.pt"))
    ap.add_argument("--imgsz", type=int, default=None, help="default: 224 for classify, 640 for detect")
    ap.add_argument("--version", default=f"yolo-{date.today():%Y%m%d}")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if model.task not in ("classify", "detect"):
        raise SystemExit(f"This is a '{model.task}' model; the backend supports classify or detect.")
    imgsz = args.imgsz or (224 if model.task == "classify" else 640)
    names = [model.names[i] for i in sorted(model.names)]

    meta = {"task": model.task, "names": names, "imgsz": imgsz, "version": args.version}
    if model.task == "detect":
        unknown = [n for n in names if n not in DETECT_LEVELS]
        if unknown:
            raise SystemExit(f"Add a water level for these classes to DETECT_LEVELS: {unknown}")
        meta["levels"] = [DETECT_LEVELS[n] for n in names]

    onnx_path = Path(model.export(format="onnx", imgsz=imgsz, dynamic=False, simplify=True))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(onnx_path, OUT_DIR / "flood_cls.onnx")
    (OUT_DIR / "flood_cls.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("task:", model.task, "classes:", names)
    print("saved:", OUT_DIR / "flood_cls.onnx")


if __name__ == "__main__":
    main()
