#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/server"
if [[ ! -x .venv/bin/uvicorn ]]; then
  UV_CACHE_DIR="$root/.local/uv-cache" uv sync --locked --python 3.13
fi
export FAIRBILL_DB="${FAIRBILL_DB:-$root/.local/fairbill.sqlite3}"
exec .venv/bin/uvicorn fairbill.api:app --host "${FAIRBILL_BIND:-127.0.0.1}" --port "${FAIRBILL_PORT:-8765}" --no-access-log
