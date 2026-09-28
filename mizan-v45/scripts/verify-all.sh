#!/usr/bin/env bash
set -euo pipefail
# One execution only. Rendering happens even when checks report partial/failure.
# --run is optional and explicit; no swallowed exit statuses or duplicate POSTs.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
exec node scripts/run-all-checks.mjs --render "$@"
