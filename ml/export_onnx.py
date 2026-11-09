"""Export a trained YOLO classification .pt to ONNX for the backend.

Works for your own best.pt or any downloaded YOLOv8/YOLO11 *classification* model.
Class folder names should start with the level number (0_dry, 1_low, ...); for a
2-class model use e.g. 0_dry / 1_flood.

Usage:
    python ml/export_onnx.py                                   # uses ml/runs/flood_cls/weights/best.pt
    python ml/export_onnx.py --weights some_model.pt --version v1-2026-11

Writes:
    backend/models/flood_cls.onnx
    backend/models/flood_cls.json   (class names, image size, version)
"""
import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent
OUT_DIR = ML_DIR.parent / "backend" / "models"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(ML_DIR / "runs" / "flood_cls" / "weights" / "best.pt"))
    ap.add_argument("--imgsz", type=int, default=224)
    ap.add_argument("--version", default=f"yolo-cls-{date.today():%Y%m%d}")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if model.task != "classify":
        raise SystemExit(f"This is a '{model.task}' model; the backend expects a classification model.")

    onnx_path = Path(model.export(format="onnx", imgsz=args.imgsz, dynamic=False, simplify=True))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(onnx_path, OUT_DIR / "flood_cls.onnx")

    names = [model.names[i] for i in sorted(model.names)]
    meta = {"names": names, "imgsz": args.imgsz, "version": args.version}
    (OUT_DIR / "flood_cls.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("classes:", names)
    print("saved:", OUT_DIR / "flood_cls.onnx")


if __name__ == "__main__":
    main()
