# CI regression fix after authentication hardening

## Status

In progress. Seven isolated Supabase domains remain bounded to three minutes. Edge Function warm-up is scoped to each domain. The first clean complete workflow set is green; two additional consecutive green sets are required.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards.
- Split Supabase integration into seven isolated domains: `security`, `ready-flow`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser` and `migrations`.
- The exact 30-second anti-abuse journey has its own stack; no timeout, assertion duration, coverage, retry or browser shard was weakened.
- A generic warm-up crashed `supabase-edge-runtime` with bus error exit 135 while `auth-browser` compiled unrelated game, player and league functions.
- Replaced generic warm-up with suite-specific probes: authentication compiles only `account-auth`; ready-flow compiles `game-ready-api`; other domains load only required boundaries.
- Controlled 4xx responses count as successful warm-up because they prove the function route is compiled and serving while preserving authorization behavior; 5xx and transport errors remain failures.
- Added CI contract regressions for the seven-domain matrix, exact journey assignment, ready-flow isolation and suite-specific warm-up.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] Ready-flow has an isolated local stack.
- [x] Edge Function warm-up is domain-specific.
- [x] All jobs remain bounded to three minutes or less.
- [x] Final stability execution 1/3 green.
- [ ] Final stability execution 2/3 green.
- [ ] Final stability execution 3/3 green.

## Validation history

### Rejected allocations and regressions

- Six-domain allocation: `security` completed assertions but crossed the three-minute boundary during cleanup.
- Initial seven-domain contract test: malformed Unicode regular expression rejected by ESLint/Vitest and replaced with deterministic string-boundary extraction.
- Generic seven-domain warm-up: `auth-browser` failed before Playwright because `supabase-edge-runtime` crashed with bus error while compiling unrelated functions.

### Final stability execution 1/3

Head `2eced462237420e5d20bb155616cd5a5ef171734`:

- Pull Request Quality Pipeline `30434509377`: success.
- Player Pages and Social Cards `30434509260`: success.
- Authentication Quality `30434509359`: success.
- Public Asset Audit `30434509161`: success.
- Pull Request Visual Evidence `30434509262`: success.

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
- Stability: `1/3` on the suite-specific warm-up candidate.
- No merge, deployment, release or production migration included.
