#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/server"
if [[ ! -x .venv/bin/uvicorn ]]; then
  UV_CACHE_DIR="$root/.local/uv-cache" uv sync --locked --python 3.13
fi
export FAIRBILL_DB="${FAIRBILL_DB:-$root/.local/fairbill.sqlite3}"
export FAIRBILL_PROFILE="${FAIRBILL_PROFILE:-local}"
host="${FAIRBILL_BIND:-127.0.0.1}"
port="${FAIRBILL_PORT:-8765}"
.venv/bin/python - <<'PY'
import os
import shutil

from fairbill.sample import fixtures
from fairbill.v1.store import health

profile = os.environ["FAIRBILL_PROFILE"]
if profile not in {"local", "fixtures"}:
    raise SystemExit("FAIRBILL_PROFILE must be local or fixtures.")
if profile == "fixtures" and not os.environ.get("FAIRBILL_INVITE_CODE"):
    raise SystemExit("Set FAIRBILL_INVITE_CODE before serving the fixtures profile.")
health()
fixtures()
print("Planner:", "Gemini" if profile == "local" and os.environ.get("GEMINI_API_KEY") else "Offline")
print("Local OCR:", "available" if profile == "local" and shutil.which("tesseract") else "unavailable")
print("Sample fixtures are ready for new cases.")
PY
printf 'FairBill API: http://%s:%s/v1\n' "$host" "$port"
exec .venv/bin/uvicorn fairbill.api:app --host "$host" --port "$port" --no-access-log
