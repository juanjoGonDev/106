# CI regression fix after authentication hardening

## Status

In progress. Seven isolated Supabase domains remain bounded to three minutes. Edge Function warm-up is domain-specific, and migrations now defers warm-up until after the database reset it validates. Stability is reset to zero; three clean complete workflow sets are required on this final candidate.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards.
- Split Supabase integration into seven isolated domains: `security`, `ready-flow`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser` and `migrations`.
- The exact 30-second anti-abuse journey has its own stack; no timeout, assertion duration, coverage, retry or browser shard was weakened.
- Replaced generic Edge Function warm-up with suite-specific probes after `auth-browser` crashed the local runtime while compiling unrelated functions.
- Migrations previously warmed functions before `supabase db reset` and again after reset. A slow first warm-up consumed roughly 51 seconds; the suite passed at 2:47 but was cancelled during cleanup at the three-minute boundary.
- Migrations now starts the function server, performs the reset, then executes the single authoritative post-reset warm-up and PostgREST readiness check.
- Controlled 4xx responses count as successful warm-up because they prove the function route is compiled and serving; 5xx and transport errors remain failures.
- CI contract regressions enforce the seven-domain matrix, exact journey assignment, ready-flow isolation, suite-specific warm-up and post-reset migration ordering.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] Ready-flow has an isolated local stack.
- [x] Edge Function warm-up is domain-specific.
- [x] Migration warm-up runs only after database reset.
- [x] All jobs remain bounded to three minutes or less.
- [ ] Final stability execution 1/3 green.
- [ ] Final stability execution 2/3 green.
- [ ] Final stability execution 3/3 green.

## Validation history

### Rejected allocations and regressions

- Six-domain allocation: `security` completed assertions but crossed the three-minute boundary during cleanup.
- Initial seven-domain contract test: malformed Unicode regular expression rejected by ESLint/Vitest.
- Generic seven-domain warm-up: `auth-browser` crashed `supabase-edge-runtime` with bus error while compiling unrelated functions.
- Double migration warm-up: migrations passed its reset, post-reset warm-up and PostgREST readiness, then was cancelled during cleanup at three minutes.

### Final candidate

Implementation and contract-test head before documentation close: `9a4bc7c05ee262034a39022e7804da528fac9a8b`.

### Evidence artifact

- `platform-evidence-30427861063`, artifact ID `8714334100`.
- Size `157401387` bytes.
- SHA-256 `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.

## Risks

- Seven isolated stacks increase aggregate runner usage, but minimize wall-clock feedback and state coupling.
- Domain-specific warm-up avoids compiling unrelated functions; every journey still invokes its actual production boundaries.
- Migration validation retains the authoritative post-reset function and PostgREST checks while removing only redundant pre-reset work.
- GitHub-hosted runner cancellations remain external and do not count toward the clean stability gate.
- PR metadata remains part of CI and must retain its marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, install full FFmpeg, increase timeouts, recombine ready-flow with another domain, restore generic authentication warm-up or restore redundant pre-reset migration warm-up.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `0/3` on the post-reset migration warm-up candidate.
- No merge, deployment, release or production migration included.
