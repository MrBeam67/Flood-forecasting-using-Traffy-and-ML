"""App settings, read from environment variables (or a .env file at the repo root)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env", extra="ignore", protected_namespaces=("settings_",)
    )

    # --- Database ---
    # e.g. postgresql://postgres:password@localhost:5432/flood_tungkhru
    database_url: str = "postgresql://postgres:postgres@localhost:5432/flood_tungkhru"
    db_pool_size: int = 3
    db_max_overflow: int = 2

    # --- Model ---
    # Path to the exported ONNX model. If the file is missing, a dummy model is used.
    model_path: Path = ROOT_DIR / "backend" / "models" / "flood_cls.onnx"

    # --- Image storage: "local", "cloudinary" or "supabase" ---
    # cloudinary://<api_key>:<api_secret>@<cloud_name>  (Cloudinary Dashboard -> API Keys)
    cloudinary_url: str = ""
    cloudinary_folder: str = "flood-tungkhru"
    storage_backend: str = "local"
    upload_dir: Path = ROOT_DIR / "uploads"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "flood-images"
    max_upload_mb: float = 8.0

    # --- Geo ---
    boundary_path: Path = ROOT_DIR / "frontend" / "data" / "tungkhru.geojson"
    flood_grid_path: Path = ROOT_DIR / "frontend" / "data" / "flood_grid.geojson"
    enforce_boundary: bool = True     # reject reports outside Thung Khru
    boundary_buffer_m: float = 300.0  # allow a little slack around the edge
    hex_resolution: int = 9           # H3 res 9 ≈ 0.1 km² per cell (~170 m edge)
    decay_hours: float = 6.0          # weight = exp(-age_hours / decay_hours)

    # --- Rain forecast (TMD NWP API, data.tmd.go.th/nwpapi) ---
    tmd_opendata: str = ""            # access token; never sent to the browser
    rain_cache_minutes: float = 60.0

    # --- Abuse protection ---
    rate_limit_per_10min: int = 20

    @property
    def sqlalchemy_url(self) -> str:
        """Normalize postgres:// / postgresql:// URLs to use the psycopg3 driver."""
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
