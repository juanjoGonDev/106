# CI regression fix after authentication hardening

## Status

In progress. The functional implementation and PR metadata contract are fixed. Two consecutive complete final-head workflow sets are green after restoring the mandatory visual-evidence marker block. One additional consecutive complete green set is required, followed by a green validation of the final documentation head.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence

- ESLint rejected an incorrect RegExp escape in the authentication journey.
- Malformed nickname and league-search inputs crossed the API boundary and could cause PostgreSQL-backed HTTP 500 responses.
- A self-observing nickname gate continuously rewrote reflected boolean attributes and blocked `DOMContentLoaded`.
- Authentication tests raced CAPTCHA readiness and persisted incomplete consent state.
- Playwright recordings passed but GIF generation failed because bundled FFmpeg lacked required muxing; installing full FFmpeg exhausted the job budget.
- PostgREST can briefly reconnect after direct permission probes and requires an explicit readiness boundary.
- The original Supabase integration was sequential and exceeded six minutes.
- The first parallel `gameplay-core` allocation completed all assertions but reached the three-minute limit during cleanup.
- Moving the exact-deadline ready-flow journey into `gameplay-sharing` balanced both domain jobs without modifying assertions or timeouts.
- A documentation closure removed the mandatory PR visual-evidence marker block. The metadata check correctly failed; the block and complete Desktop/Mobile/GIF evidence area were restored.

## Decisions

1. Keep 16 Desktop/Mobile browser shards and three-minute limits.
2. Generate WebM and GIF evidence inside the matching shard without OS package installation.
3. Use Chrome/Canvas for WebM decoding and deterministic Node GIF encoding.
4. Keep nickname-gate writes idempotent and preserve ownership of competition/quota disabled state.
5. Validate malformed nicknames and league searches before RPC execution.
6. Use a bounded PostgREST readiness barrier; do not retry behavioral assertions.
7. Run Supabase as six isolated parallel domains: `security`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser`, `migrations`.
8. Install pnpm only for the live-auth browser domain and use `node scripts/serve.mjs` directly.
9. Require three consecutive complete green workflow sets after the final metadata contract is restored.

## Acceptance criteria

- [x] Observer feedback loop removed with regression coverage.
- [x] External quota/competition disabled state cannot be overridden.
- [x] Invalid nickname and league-search inputs return controlled HTTP 400 responses before PostgreSQL.
- [x] CAPTCHA and consent browser races removed without sleeps or retries.
- [x] GIF generation uses no apt/system dependency installation.
- [x] Supabase domain jobs are parallel and bounded to three minutes.
- [x] No skip, retry-as-fix, timeout increase or coverage reduction.
- [x] Mandatory PR visual-evidence marker block restored.
- [x] Final-head stability execution 1/3 green.
- [x] Final-head stability execution 2/3 green.
- [ ] Final-head stability execution 3/3 green.

## Validation

### Final-head stability execution 1/3

Head: `7ad55950c1e897eb94e5aaacc45d046bedeba864`.

- Pull Request Quality Pipeline `30428298906`: success.
- Player Pages and Social Cards `30428298968`: success.
- Authentication Quality `30428299030`: success.
- Public Asset Audit `30428298901`: success.
- Pull Request Visual Evidence `30428475565`: success.

### Final-head stability execution 2/3

Head: `e8fdca5d381d308fd25236fa1c5fab2db17c99c0`.

- Pull Request Quality Pipeline `30428616702`: success.
- Player Pages and Social Cards `30428616651`: success.
- Authentication Quality `30428616674`: success.
- Public Asset Audit `30428616680`: success.
- Pull Request Visual Evidence `30428616652`: success.

### Evidence artifact

- Artifact: `platform-evidence-30427861063`.
- Artifact ID: `8714334100`.
- Size: `157401387` bytes.
- SHA-256: `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.
- Evidence head: `f1dc1edd2a85942ca1c264d54e4384d950d45b97`.

## Risks

- Isolated Supabase domains use more concurrent runners but reduce wall-clock time and state coupling.
- RGB332 GIF evidence is intentionally bounded; PNG and WebM remain the full-quality sources.
- PR metadata is part of the quality contract and must retain a complete Desktop/Mobile/GIF marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, increase timeouts, install full FFmpeg or recombine Supabase into a monolithic journey.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Current final-head stability: `2/3`.
- No merge, deployment, release, production migration or provider configuration is included.
