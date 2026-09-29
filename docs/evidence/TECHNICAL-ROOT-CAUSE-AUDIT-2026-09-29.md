# Technical Root-Cause Audit — MIZAN_FINANCIAL — 2026-09-29

## Executive result

This is a read-only delegated investigation. It found a **high-risk failure of the identity proof path** and a confirmed divergence between the two production origins. It does not by itself prove that the analysis application is broken.

## Evidence reported by delegated code/runtime auditor

| Surface | Observed identity | Cache observation |
|---|---|---|
| https://mizan-equity.aljeryabod.workers.dev/mizan-deployment.json | `beb407536e7b5e2c40f879d23d389f4d5201f267`, generated 2026-09-27T20:34:08.219Z | `cf-cache-status: HIT` |
| https://mizan-equity.aljeryabod.chatgpt.site/mizan-deployment.json | `61ba1d1d325158e5b2b151bc79d273c0026f0372`, generated 2026-09-28T20:10:27.875Z | `cf-cache-status: HIT` |

The delegated auditor reported distinct ETags for the two responses. The root agent could not replay the HTTP request because its network proxy timed out; this is therefore recorded as delegated evidence, not independently replayed evidence.

## Why this matters

1. The two origins cannot both be accepted as the same release without reconciliation.
2. The application contains both `public/mizan-deployment.json` and `app/mizan-deployment.json/route.ts` for the same URL path. The dynamic route declares no-store, while the observed responses were cache hits, so the identity response may be a static CDN asset rather than proof of executing Worker code.
3. GitHub history contains a deploy workflow that triggers on a historical branch rather than ordinary `main` pushes and builds under `mizan-v45/`; the Sites version was saved from a separate Site checkout root. This makes “the GitHub source” ambiguous unless the authoritative root, branch and trigger are recorded.
4. The Site config declares three schedules: `0 */6 * * *`, `0 3 * * *`, and `*/5 * * * *`. The Worker dispatches seven handlers and uses locks, but the audit did not find scheduled events in the available logs. This is a configuration/observability gap, not proof that Cron is disabled.

## Required decision gates

- Keep `FIN-P1-REQ-SOURCE-DEPLOYMENT-PARITY` BLOCKED. The saved archive digest remains verified, but live-origin identity is unresolved and surfaces disagree.
- Do not switch production origins, delete a route, change cache headers, edit Cron, or deploy a fix as part of Phase 1 evidence collection.
- Select the official public origin and deployment authority before any future stability repair.
- A future repair should disambiguate the identity endpoint (for example, a distinct Worker-only diagnostic path) and prove the served HTML/bootstrap assets from the official origin.
- Reconcile the GitHub workflow trigger/root with Sites’ actual saved-version source.
- Obtain authoritative Cloudflare schedule records and runtime heartbeat evidence for each declared Cron.

## Safety

No source code, Site settings, Cloudflare configuration, database, production data, or engineering project was modified during this audit. AZIZ, Mizan Score, Response Dynamics and research remain frozen.
