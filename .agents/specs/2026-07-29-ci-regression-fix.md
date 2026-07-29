# CI regression fix after authentication hardening

## Status

In progress. Seven isolated Supabase domains remain bounded to three minutes. Edge Function warm-up is now scoped to each domain after an unrelated multi-function warm-up crashed the local runtime. Stability is reset to zero; three clean complete workflow sets are required on this final candidate.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards.
- Split Supabase integration into seven isolated domains: `security`, `ready-flow`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser` and `migrations`.
- The exact 30-second anti-abuse journey has its own stack; no timeout, assertion duration, coverage, retry or browser shard was weakened.
- A later `auth-browser` run crashed `supabase-edge-runtime` with bus error exit 135 while the generic warm-up compiled `game-api`, `player-context` and `league-api` before any browser test started.
- Replaced generic warm-up with suite-specific probes: authentication compiles only `account-auth`; ready-flow compiles `game-ready-api`; other domains load only their required boundaries.
- Controlled 4xx responses count as successful warm-up because they prove the function route is compiled and serving while preserving authorization behavior; 5xx and transport errors remain failures.
- Added CI contract regressions for the seven-domain matrix, exact journey assignment, ready-flow isolation and suite-specific warm-up.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] Ready-flow has an isolated local stack.
- [x] Edge Function warm-up is domain-specific.
- [x] All jobs remain bounded to three minutes or less.
- [ ] Final stability execution 1/3 green.
- [ ] Final stability execution 2/3 green.
- [ ] Final stability execution 3/3 green.

## Validation history

### Rejected allocations and regressions

- Six-domain allocation: `security` completed assertions but crossed the three-minute boundary during cleanup.
- Initial seven-domain contract test: malformed Unicode regular expression rejected by ESLint/Vitest and replaced with deterministic string-boundary extraction.
- Generic seven-domain warm-up: `auth-browser` failed before Playwright because `supabase-edge-runtime` crashed with bus error while compiling unrelated functions.

### Prior green evidence before final warm-up change

- Head `d6d849cfdce08d0f2805bcf14ec11140728e1292`: all five workflows green.
- Head `2b944231ef94c47c67325b7b920d7638385a1a20`: all five workflows green.
- These runs validate the seven-domain split but do not count for the final suite-specific warm-up candidate.

### Final candidate

Implementation and contract-test head before documentation close: `46d0f15863c9ad0cc208b7779534a56925b27124`.

### Evidence artifact

- `platform-evidence-30427861063`, artifact ID `8714334100`.
- Size `157401387` bytes.
- SHA-256 `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.

## Risks

- Seven isolated stacks increase aggregate runner usage, but minimize wall-clock feedback and state coupling.
- Domain-specific warm-up intentionally avoids compiling unrelated functions; each maintained journey still invokes its actual production boundaries.
- GitHub-hosted runner cancellations remain external and do not count toward the clean stability gate.
- PR metadata remains part of CI and must retain its marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, install full FFmpeg, increase timeouts, recombine ready-flow with another domain or restore generic multi-function warm-up for authentication jobs.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `0/3` on the suite-specific warm-up candidate.
- No merge, deployment, release or production migration included.
