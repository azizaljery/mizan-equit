# Local Phase 1 compatibility evidence

Date: 2026-09-28. Source: `65b623639588f40eb73c5d76616308737ab33f33`; clean checkout. Human review: PENDING.
No production or engineering resources were modified.

## Focused regression
Node v24.19.0; existing tests from tests/calculations.test.mjs. The committed .tap filename contains the Node runner's default human-readable output, not strict TAP.
Run from the app source:
```sh
node_modules/.bin/esbuild tests/export.ts --bundle --jsx=automatic '--banner:js=import {createRequire} from "node:module"; const require=createRequire(import.meta.url);' --alias:cloudflare:workers=./tests/runtime-env.ts --platform=node --format=esm --outfile=/tmp/mizan-phase1-analysis.mjs
MIZAN_TEST_MODULE=file:///tmp/mizan-phase1-analysis.mjs node --test --test-name-pattern='Previously saved company layouts|Named paper portfolio|Research API saves a PIN|Portfolio capital, additional buy|Forecast journal appends immutable|Daily horizon uses delayed|Admin login, reload and save' tests/calculations.test.mjs
```
Result: 7 passed, 0 failed. Unselected tests are not credited as passes. These tests use synthetic fixtures; API reloads are not a real browser or database restart.

## Migration preservation
```sh
python verify-legacy-migrations.py /path/to/site-git-checkout
```
The checkout must contain baseline and target commits recorded in the script; a GitHub subtree snapshot alone may not contain Sites history.
Four appended SQL migrations preserve the six populated table snapshots through close/reopen. Existing migration SQL matches the baseline. Payloads are intentionally minimal; this check proves row preservation only, not full UI acceptance.
The migration-created legacy portfolio has timestamp fields, so whole-result hashes can differ on rerun; before/after/reopen equality within each run is the invariant.

Production D1, backup restoration, old application runtime and live user data were not tested. Local SQLite success does not establish production compatibility or database rollback safety.
