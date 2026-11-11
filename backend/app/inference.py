"""Flood-level classifier.

Uses a YOLOv8 model exported to ONNX (see ml/export_onnx.py), either a classification
model (OnnxClassifier) or a detection model (OnnxDetector), chosen by "task" in
flood_cls.json. If no model file exists yet, falls back to DummyClassifier so the rest
of the system can be developed and demoed before the real model is trained.

Severity score = expected value over classes:
    score = sum_i P(class_i) * level_i / (n_classes - 1)
so with 4 classes the weights are 0, 0.33, 0.67, 1.0.
"""
from __future__ import annotations

import ast
import hashlib
import io
import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from .config import get_settings

log = logging.getLogger(__name__)

DEFAULT_CLASSES = ["0_dry", "1_low", "2_medium", "3_high"]


@dataclass
class Prediction:
    label: str
    level: int
    score: float
    probs: dict[str, float]
    model_version: str


def _level_of(name: str, idx: int) -> int:
    """'2_medium' -> 2. Falls back to the class index if the name has no numeric prefix."""
    head = name.split("_", 1)[0]
    return int(head) if head.isdigit() else idx


def _to_prediction(probs: np.ndarray, classes: list[str], version: str) -> Prediction:
    levels = [_level_of(c, i) for i, c in enumerate(classes)]
    max_level = max(levels) or 1
    score = float(sum(p * lv / max_level for p, lv in zip(probs, levels)))
    top = int(np.argmax(probs))
    return Prediction(
        label=classes[top],
        level=levels[top],
        score=round(min(max(score, 0.0), 1.0), 4),
        probs={c: round(float(p), 4) for c, p in zip(classes, probs)},
        model_version=version,
    )


class OnnxClassifier:
    def __init__(self, model_path: Path):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        shape = self.session.get_inputs()[0].shape  # [1, 3, H, W]
        self.imgsz = int(shape[2]) if isinstance(shape[2], int) else 224

        # Class names: from <model>.json written by export_onnx.py, else ONNX metadata.
        meta_file = model_path.with_suffix(".json")
        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            self.classes = list(meta["names"])
            self.version = meta.get("version", model_path.stem)
        else:
            names = self.session.get_modelmeta().custom_metadata_map.get("names")
            # Ultralytics stores names like "{0: '0_dry', 1: '1_low', ...}"
            self.classes = (
                [v for _, v in sorted(ast.literal_eval(names).items())] if names else DEFAULT_CLASSES
            )
            self.version = model_path.stem

    def _preprocess(self, img: Image.Image) -> np.ndarray:
        # Same as Ultralytics classify transforms: resize short side -> center crop -> /255
        img = ImageOps.fit(img.convert("RGB"), (self.imgsz, self.imgsz), Image.BILINEAR)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        return arr.transpose(2, 0, 1)[None]  # HWC -> 1CHW

    def predict(self, img: Image.Image) -> Prediction:
        out = self.session.run(None, {self.input_name: self._preprocess(img)})[0][0]
        probs = np.asarray(out, dtype=np.float64)
        if not np.isclose(probs.sum(), 1.0, atol=1e-3) or probs.min() < 0:  # raw logits
            e = np.exp(probs - probs.max())
            probs = e / e.sum()
        return _to_prediction(probs, self.classes, self.version)


class OnnxDetector:
    """YOLOv8 detection model whose classes are water levels (none/ankle/knee/...).

    Output [1, 4 + n_classes, n_anchors]. For each class we keep its best confidence over
    all anchors (no NMS needed, we only need "is this level in the picture and how sure").
    Classes above CONF_THRESHOLD are normalised into probabilities and the score is the
    expected level, like the classifier. Nothing detected -> level 0, score 0.
    """

    CONF_THRESHOLD = 0.25

    def __init__(self, model_path: Path, meta: dict):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.imgsz = int(meta.get("imgsz", 640))
        self.classes = list(meta["names"])
        self.levels = [int(v) for v in meta.get("levels", range(len(self.classes)))]
        self.version = meta.get("version", model_path.stem)

    def _preprocess(self, img: Image.Image) -> np.ndarray:
        # Ultralytics letterbox: keep aspect ratio, pad with gray (114) to imgsz x imgsz.
        img = img.convert("RGB")
        r = self.imgsz / max(img.size)
        w, h = max(1, round(img.width * r)), max(1, round(img.height * r))
        canvas = Image.new("RGB", (self.imgsz, self.imgsz), (114, 114, 114))
        canvas.paste(img.resize((w, h), Image.BILINEAR), ((self.imgsz - w) // 2, (self.imgsz - h) // 2))
        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        return arr.transpose(2, 0, 1)[None]

    def predict(self, img: Image.Image) -> Prediction:
        out = self.session.run(None, {self.input_name: self._preprocess(img)})[0][0]  # (4+nc, N)
        conf = out[4:].max(axis=1).astype(np.float64)  # best confidence per class
        probs_all = {c: round(float(p), 4) for c, p in zip(self.classes, conf)}

        keep = conf >= self.CONF_THRESHOLD
        if not keep.any():
            base = int(np.argmin(self.levels))
            return Prediction(self.classes[base], self.levels[base], 0.0, probs_all, self.version)

        w = np.where(keep, conf, 0.0)
        w /= w.sum()
        max_level = max(self.levels) or 1
        score = float(sum(p * lv / max_level for p, lv in zip(w, self.levels)))
        top = int(np.argmax(conf))
        return Prediction(
            label=self.classes[top],
            level=self.levels[top],
            score=round(min(max(score, 0.0), 1.0), 4),
            probs=probs_all,
            model_version=self.version,
        )


class DummyClassifier:
    """Placeholder until a real model is trained.

    Gives a deterministic (same image -> same result) but meaningless prediction.
    """

    classes = DEFAULT_CLASSES
    version = "dummy"

    def predict(self, img: Image.Image) -> Prediction:
        buf = io.BytesIO()
        img.convert("RGB").resize((32, 32)).save(buf, format="PNG")
        seed = int.from_bytes(hashlib.sha256(buf.getvalue()).digest()[:4], "little")
        probs = np.random.default_rng(seed).dirichlet(np.ones(len(self.classes)) * 0.6)
        return _to_prediction(probs, self.classes, self.version)


@lru_cache
def get_classifier() -> OnnxClassifier | OnnxDetector | DummyClassifier:
    path = get_settings().model_path
    if path.exists():
        meta_file = path.with_suffix(".json")
        meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
        if meta.get("task") == "detect":
            log.info("Loading ONNX detection model from %s", path)
            return OnnxDetector(path, meta)
        log.info("Loading ONNX classification model from %s", path)
        return OnnxClassifier(path)
    log.warning("Model not found at %s, using DummyClassifier (predictions are fake!)", path)
    return DummyClassifier()
