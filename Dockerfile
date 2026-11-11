FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

# Run as an unprivileged user; uploads/ is only used when STORAGE_BACKEND=local.
RUN useradd --create-home --uid 1000 app && mkdir -p uploads && chown app:app uploads
USER app

# Render provides $PORT. Run DB migrations, then start the API (exec -> gets SIGTERM).
# One worker: the free instance has 512 MB RAM and each worker loads the ONNX model.
CMD alembic -c backend/alembic.ini upgrade head && \
    exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} \
         --proxy-headers --forwarded-allow-ips="*" --timeout-keep-alive 30
