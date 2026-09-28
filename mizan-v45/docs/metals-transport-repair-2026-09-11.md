# Metals.dev transport diagnostics and retry — 2026-09-11

The user screenshot shows a stored credential and `تعذر الاتصال بالمصدر أو انتهت المهلة.`. This message comes from the server fetch catch, not from a provider response declaring an invalid key. Native production requests to the test endpoint returned HTTP 200 with application-level test results; those logs alone do not establish provider success.

The old fetch catch merged all transport exceptions. The repair distinguishes timeout, network, DNS, TLS, runtime restrictions, redirects, HTTP status, provider key/account/quota/parameter errors, and unreadable responses. Only sanitized classification, hostname, duration and HTTP status enter diagnostic logs; URLs, query strings, headers, raw provider messages and exception text are excluded.

One retry is permitted for transient transport failures and HTTP 408/502/503/504. Every attempt consumes the existing monthly budget, the lease covers both bounded attempts, cached errors prevent repeated rapid calls, and quota/auth/redirect errors are not retried. Credentials never follow redirects. The response body has a streaming size limit and the timeout covers body consumption.

The admin test returns diagnostic code, attempt count and timestamp in collapsed details. Gold source status retains these diagnostics for investigation. No key, PIN, password, historical forecast or portfolio data was changed.

Verification: 115 automated tests passed, including retry recovery, exhausted quota, cached failures, redirect protection, HTTP provider error codes, timeout/DNS/TLS differentiation and secret redaction. Preview browser test opened the actual diagnostic component by click; details initially collapsed. A locale hydration mismatch found in the isolated fixture was corrected with deterministic Saudi-time formatting. Temporary fixture route removed before release.

Limit: no successful live Metals.dev quote is claimed. A direct unauthenticated network probe from the development environment could not run because network approval was cancelled; it was not bypassed. The deployed owner test remains necessary to identify any continued upstream transport failure. No paid plan is required or purchased by this change.

Provider response contract checked against https://metals.dev/docs (Spot Metal Endpoint and Error Codes). Documentation and fixture responses are not market observations.
