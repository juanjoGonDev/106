# CI regression fix after authentication hardening

## Status

In progress. Stability count reset after `gameplay-sharing` completed every assertion and artifact upload but reached the three-minute limit during post-job cleanup. The exact 30-second anti-abuse journey has been moved to the measured lower-load `security` domain. Three consecutive complete green workflow sets are required from this final allocation.

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
- `gameplay-sharing` with ready-flow finished all tests and uploaded evidence, but its total job duration was exactly three minutes and GitHub cancelled it during cleanup.
- Measured `security` duration was approximately two minutes including cleanup; moving the 39-second ready-flow journey there preserves a practical margin without adding runners.
- The mandatory PR visual-evidence marker block is restored and validated.

## Decisions

1. Keep 16 Desktop/Mobile browser shards and three-minute limits.
2. Generate WebM and GIF evidence inside the matching shard without OS package installation.
3. Use Chrome/Canvas for WebM decoding and deterministic Node GIF encoding.
4. Keep nickname-gate writes idempotent and preserve ownership of competition/quota disabled state.
5. Validate malformed nicknames and league searches before RPC execution.
6. Use a bounded PostgREST readiness barrier; do not retry behavioral assertions.
7. Keep six isolated Supabase domains: `security`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser`, `migrations`.
8. Treat ready-flow as an anti-abuse/timing security journey and execute it in `security`.
9. Keep `gameplay-sharing` dedicated to trophies and social-card generation.
10. Require three consecutive complete green workflow sets from the final allocation.

## Acceptance criteria

- [x] Observer feedback loop removed with regression coverage.
- [x] External quota/competition disabled state cannot be overridden.
- [x] Invalid nickname and league-search inputs return controlled HTTP 400 responses before PostgreSQL.
- [x] CAPTCHA and consent browser races removed without sleeps or retries.
- [x] GIF generation uses no apt/system dependency installation.
- [x] Supabase domain jobs are parallel and bounded to three minutes.
- [x] No skip, retry-as-fix, timeout increase or coverage reduction.
- [x] Mandatory PR visual-evidence marker block restored.
- [ ] Final allocation stability execution 1/3 green.
- [ ] Final allocation stability execution 2/3 green.
- [ ] Final allocation stability execution 3/3 green.

## Validation

### Timing evidence

- Previous `gameplay-sharing`: started `06:40:19`, suite finished `06:43:03`, artifact and cleanup finished near `06:43:18`; GitHub cancelled at the three-minute boundary.
- Previous `security`: started `06:40:23`, completed cleanup near `06:42:24`.
- Ready-flow assertions consume approximately 39 seconds because they intentionally verify the real two-second lower bound and exact 30-second deadline.

### Evidence artifact

- Artifact: `platform-evidence-30427861063`.
- Artifact ID: `8714334100`.
- Size: `157401387` bytes.
- SHA-256: `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.
- Evidence head: `f1dc1edd2a85942ca1c264d54e4384d950d45b97`.

## Risks

- The security domain becomes longer but remains below the three-minute limit based on measured timings.
- The anti-abuse ready-flow mutates isolated test data and remains assigned exactly once.
- PR metadata is part of the quality contract and must retain a complete Desktop/Mobile/GIF marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, increase timeouts, install full FFmpeg or recombine Supabase into a monolithic journey.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Current final-allocation stability: `0/3`.
- No merge, deployment, release, production migration or provider configuration is included.
