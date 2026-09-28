# Mizan Council runtime

This file documents the production council wiring for the equity project.

- Runtime: Cloudflare Worker `mizan-equity`
- Database: D1 `mizan-equity-db`
- Council: `mizan-native-council-v2`
- Core markets: Saudi + US
- Provider secrets are supplied only through GitHub Actions secrets and synchronized to Cloudflare Worker secrets during deployment.
- Secret values must never be committed to this repository.
- Owner approval remains required for merge/deploy decisions proposed by agents.

Last verification trigger: 2026-09-25.
