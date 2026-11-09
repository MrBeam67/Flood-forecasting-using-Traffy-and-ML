"""Try a trained .pt model on one or more images and print the severity score.

Usage:
    python ml/predict.py path/to/image.jpg [more.jpg ...]
    python ml/predict.py --weights ml/runs/flood_cls/weights/best.pt img.jpg
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent


def severity_score(probs, names) -> float:
    """Expected level / max level: 0.0 (dry) .. 1.0 (high). Same formula as the backend."""
    levels = [int(names[i].split("_")[0]) if names[i][0].isdigit() else i for i in range(len(names))]
    top = max(levels) or 1
    return float(sum(p * lv / top for p, lv in zip(probs, levels)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--weights", default=str(ML_DIR / "runs" / "flood_cls" / "weights" / "best.pt"))
    args = ap.parse_args()

    model = YOLO(args.weights)
    for res in model.predict(args.images, verbose=False):
        probs = res.probs.data.tolist()
        name = res.names[res.probs.top1]
        score = severity_score(probs, res.names)
        detail = ", ".join(f"{res.names[i]}={p:.2f}" for i, p in enumerate(probs))
        print(f"{Path(res.path).name}: {name}  score={score:.3f}  ({detail})")


if __name__ == "__main__":
    main()
