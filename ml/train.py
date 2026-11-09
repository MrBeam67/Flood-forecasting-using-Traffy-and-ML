"""Train a YOLOv8 classification model on the flood-level dataset.

Usage:
    python ml/train.py                      # defaults
    python ml/train.py --model yolov8s-cls.pt --epochs 80 --imgsz 224

Output: ml/runs/flood_cls/weights/best.pt
"""
import argparse
from pathlib import Path

import torch
from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ML_DIR / "dataset"))
    ap.add_argument("--model", default="yolov8n-cls.pt", help="n (fast) / s / m (more accurate)")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--imgsz", type=int, default=224)
    ap.add_argument("--batch", type=int, default=32)
    args = ap.parse_args()

    device = 0 if torch.cuda.is_available() else "cpu"
    print(f"device: {'GPU ' + torch.cuda.get_device_name(0) if device == 0 else 'CPU (will be slow)'}")

    model = YOLO(args.model)  # downloads pretrained ImageNet weights the first time
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch if device == 0 else min(args.batch, 16),
        device=device,
        project=str(ML_DIR / "runs"),
        name="flood_cls",
        exist_ok=True,
        patience=15,       # stop early if val accuracy stops improving
        workers=0 if device == "cpu" else 4,  # Windows-friendly on CPU
        # light augmentation; flips are fine, big color shifts would change "water look"
        fliplr=0.5, hsv_h=0.01, hsv_s=0.3, hsv_v=0.3, erasing=0.2,
    )

    metrics = model.val()
    print(f"top1 acc = {metrics.top1:.3f}   top5 acc = {metrics.top5:.3f}")
    print("best weights:", ML_DIR / "runs" / "flood_cls" / "weights" / "best.pt")


if __name__ == "__main__":
    main()
