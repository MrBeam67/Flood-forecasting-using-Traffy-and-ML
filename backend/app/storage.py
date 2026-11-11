"""Image storage: local folder (dev), Cloudinary or Supabase Storage (production).

Every image is re-encoded as JPEG before saving. That strips EXIF metadata (including
the phone's GPS position) and caps the size at 1280 px.
"""
from __future__ import annotations

import hashlib
import io
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

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


def parse_cloudinary_url(url: str) -> tuple[str, str, str]:
    """cloudinary://<api_key>:<api_secret>@<cloud_name> -> (cloud_name, key, secret)."""
    u = urlparse(url.strip())
    if u.scheme != "cloudinary" or not (u.hostname and u.username and u.password):
        raise ValueError("CLOUDINARY_URL ต้องอยู่ในรูป cloudinary://<api_key>:<api_secret>@<cloud_name>")
    return u.hostname, u.username, u.password


def cloudinary_signature(params: dict[str, str], api_secret: str) -> str:
    """Cloudinary signed-upload signature: sha1('a=1&b=2' + secret), keys sorted."""
    to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.sha1((to_sign + api_secret).encode()).hexdigest()


def _save_cloudinary(data: bytes, public_id: str) -> str:
    s = get_settings()
    cloud, key, secret = parse_cloudinary_url(s.cloudinary_url)
    params = {"folder": s.cloudinary_folder, "public_id": public_id, "timestamp": str(int(time.time()))}
    r = httpx.post(
        f"https://api.cloudinary.com/v1_1/{cloud}/image/upload",
        data={**params, "api_key": key, "signature": cloudinary_signature(params, secret)},
        files={"file": ("image.jpg", data, "image/jpeg")},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["secure_url"]


def _save_supabase(data: bytes, name: str) -> str:
    s = get_settings()
    base = s.supabase_url.rstrip("/")
    key = s.supabase_service_key
    headers = {"apikey": key, "Content-Type": "image/jpeg"}
    # Legacy service_role keys are JWTs and go in Authorization too. New-style
    # secret keys (sb_secret_...) are not JWTs: send them only as `apikey`.
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.post(
        f"{base}/storage/v1/object/{s.supabase_bucket}/{name}",
        content=data,
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    return f"{base}/storage/v1/object/public/{s.supabase_bucket}/{name}"


def save_image(data: bytes) -> str:
    """Save JPEG bytes and return a URL the browser can load."""
    s = get_settings()
    month, uid = f"{datetime.now(timezone.utc):%Y/%m}", uuid.uuid4().hex

    if s.storage_backend == "cloudinary":
        return _save_cloudinary(data, f"{month.replace('/', '-')}-{uid}")
    if s.storage_backend == "supabase":
        return _save_supabase(data, f"{month}/{uid}.jpg")

    name = f"{month}/{uid}.jpg"
    path = s.upload_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/uploads/{name}"
