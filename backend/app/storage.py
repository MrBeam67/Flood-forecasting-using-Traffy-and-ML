"""Image storage: local folder (dev) or Supabase Storage (production).

Every image is re-encoded as JPEG before saving. That strips EXIF metadata (including
the phone's GPS position) and caps the size at 1280 px.
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone

import httpx
from PIL import Image, ImageOps

from .config import get_settings

MAX_SIDE = 1280


def sanitize_image(img: Image.Image) -> bytes:
    img = ImageOps.exif_transpose(img)  # apply phone rotation before EXIF is dropped
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)  # no exif= argument -> metadata removed
    return buf.getvalue()


def save_image(data: bytes) -> str:
    """Save JPEG bytes and return a URL the browser can load."""
    s = get_settings()
    name = f"{datetime.now(timezone.utc):%Y/%m}/{uuid.uuid4().hex}.jpg"

    if s.storage_backend == "supabase":
        base = s.supabase_url.rstrip("/")
        r = httpx.post(
            f"{base}/storage/v1/object/{s.supabase_bucket}/{name}",
            content=data,
            headers={
                "Authorization": f"Bearer {s.supabase_service_key}",
                "apikey": s.supabase_service_key,
                "Content-Type": "image/jpeg",
            },
            timeout=30,
        )
        r.raise_for_status()
        return f"{base}/storage/v1/object/public/{s.supabase_bucket}/{name}"

    path = s.upload_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/uploads/{name}"
