# Admin blank screen repair — 2026-09-11 UTC

The actual AdminControls renderer reproduced `entry.changes.map is not a function` with historic Gold settings `{old,next}` and credential event audit records. The admin endpoint returned these objects unchanged, while the UI assumed every event was an array. Closed audit details still render their children.

Changes:
- Normalize array, Gold settings, credential and unreadable audit records at the API and rendering boundaries. Keep original database records unchanged.
- Display distinct Arabic labels for Gold settings and credential updates; never return raw audit payloads or secret values.
- Contain future admin render failures within the admin section, with a retry button. The analysis page is not unmounted.
- No database migration, credential rotation, password/PIN change, portfolio mutation or forecast rewrite is part of this repair.

Verification:
- Baseline regression failed before repair: 109 passed, 1 failed, with the exact rendering exception above.
- Repaired suite: 112 tests passed, including actual admin login/load/save API responses rendered by AdminControls against a local SQLite fixture. Tests preserve encrypted provider credentials, the private PIN and historic raw audit records, and enforce owner/session checks.
- Browser preview: actual AdminControls loaded mixed legacy audit formats, opened readable audit history, and stayed functional after page reload.
- Browser preview: an intentional render error was contained; main-page content remained visible, and retry recovered the admin view after removing the fixture fault. The development-only error overlay was dismissed for this check.
- The browser rendering fixture used explicitly labeled artificial audit events and no real credentials. Its temporary route was removed before the release build. This does not claim a production owner-authenticated login test.
- Full owner login on the live site remains a user-session check; no owner password or provider API key was requested or inspected.
