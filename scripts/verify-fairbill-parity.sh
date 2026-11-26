#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
test_python="${FAIRBILL_TEST_PYTHON:-python3}"
compiled="$(mktemp -d)"
trap 'rm -rf "$compiled"' EXIT

(
  cd "$root/server"
  env -u GEMINI_API_KEY "$test_python" -m pytest -q
)
(
  cd "$root/mobile"
  npm run typecheck
  ./node_modules/.bin/tsc --target ES2022 --module commonjs --esModuleInterop \
    --resolveJsonModule --skipLibCheck --outDir "$compiled" src/case-intent.ts
  FAIRBILL_COMPILED_INTENT="$compiled/case-intent.js" node --test tests/*.test.cjs
)
if [[ -n "${FAIRBILL_SQL_TEST_TOOLS:-}" ]]; then
  node "$root/supabase/tests/report_links.mjs"
fi
