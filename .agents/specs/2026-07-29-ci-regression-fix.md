# CI regression fix after authentication hardening

## Status

In progress. The timed ready-flow journey now has an isolated seventh Supabase domain. Stability is reset to zero; three consecutive complete green workflow sets are required on the final allocation.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards.
- Split Supabase integration into isolated domains so each stack can run concurrently under the three-minute job limit.
- The exact 30-second anti-abuse journey first made `gameplay-sharing` reach three minutes during cleanup.
- Moving ready-flow to `security` passed once, but a slower Edge Function warm-up made that job finish its suite at 2:49 and get cancelled during cleanup.
- No existing domain has sufficient worst-case margin for the timed journey.
- Added the isolated `ready-flow` domain and increased only matrix fan-out from six to seven; no timeout, assertion duration, coverage, retry or browser shard was weakened.
- Added a CI contract regression requiring the seven-domain matrix, exact single assignment and separation from `security`.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] Ready-flow has an isolated local stack.
- [x] All jobs remain bounded to three minutes or less.
- [ ] Final allocation stability execution 1/3 green.
- [ ] Final allocation stability execution 2/3 green.
- [ ] Final allocation stability execution 3/3 green.

## Validation

### Rejected six-domain allocation

Head `774684886d3980a35d4f15becbd07ddf06c57256`:

- Authentication Quality `30429783408`: success.
- Public Asset Audit `30429781640`: success.
- Pull Request Visual Evidence `30429782051`: success.
- Player Pages and Social Cards `30429781433`: success.
- Pull Request Quality Pipeline `30429781442`: cancelled.
- `Supabase · security` completed every assertion and printed `Supabase security suite passed`, then was cancelled during cleanup at the unchanged three-minute boundary.

### Final seven-domain allocation

Candidate implementation head before documentation close: `a60c0cec5bdd02b96647cc31156f506c38adae72`.

The final documentation head must pass three complete consecutive workflow sets before delivery.

### Evidence artifact

- `platform-evidence-30427861063`, artifact ID `8714334100`.
- Size `157401387` bytes.
- SHA-256 `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.

## Risks

- A seventh isolated Supabase stack increases aggregate runner usage, but keeps wall-clock feedback fast and removes timing coupling between deterministic security checks and the exact-deadline journey.
- PR metadata remains part of CI and must retain its marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, install full FFmpeg, increase timeouts or recombine ready-flow with a domain that lacks cleanup margin.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `0/3` on the final seven-domain allocation.
- No merge, deployment, release or production migration included.
