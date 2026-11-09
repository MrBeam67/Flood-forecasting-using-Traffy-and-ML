"""Split labeled images into train/val folders for YOLO classification.

Input (one folder per class, you label these by hand):
    raw/
      0_dry/     *.jpg
      1_low/     *.jpg
      2_medium/  *.jpg
      3_high/    *.jpg

Output:
    dataset/
      train/0_dry/ ...  (80%)
      val/0_dry/   ...  (20%)

Usage:
    python ml/split_dataset.py --src ml/raw --dst ml/dataset --val 0.2
"""
import argparse
import random
import shutil
from pathlib import Path

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="ml/raw")
    ap.add_argument("--dst", default="ml/dataset")
    ap.add_argument("--val", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    rng = random.Random(args.seed)
    classes = sorted(p.name for p in src.iterdir() if p.is_dir())
    print("classes:", classes)

    for cls in classes:
        files = sorted(f for f in (src / cls).iterdir() if f.suffix.lower() in IMG_EXT)
        rng.shuffle(files)
        n_val = max(1, int(len(files) * args.val))
        for split, subset in (("val", files[:n_val]), ("train", files[n_val:])):
            out = dst / split / cls
            out.mkdir(parents=True, exist_ok=True)
            for f in subset:
                shutil.copy2(f, out / f.name)
        print(f"  {cls:10s} total={len(files):5d} train={len(files) - n_val:5d} val={n_val:4d}")


if __name__ == "__main__":
    main()
