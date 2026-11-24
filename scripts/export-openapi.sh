#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/server"
exec .venv/bin/python -m fairbill.v1.openapi "$root/docs/openapi.json"
