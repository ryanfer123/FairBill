FROM ghcr.io/astral-sh/uv:0.11.0 AS uv
FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_NO_CACHE=1 UV_PYTHON_DOWNLOADS=never
RUN apt-get update \
    && apt-get install --no-install-recommends -y tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 fairbill
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY fairbill ./fairbill
USER fairbill
EXPOSE 10000
CMD ["sh", "-c", "exec .venv/bin/uvicorn fairbill.hosted_app:app --host 0.0.0.0 --port ${PORT:-10000} --no-access-log"]
