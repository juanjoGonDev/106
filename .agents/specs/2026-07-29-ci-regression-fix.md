# CI regression fix after authentication hardening

## Status

Implementation complete. Final delivery is gated by the new head CI and the canonical platform-evidence artifact.

## Request

Fix the failing CI on PR #39 without weakening validation, removing browser journeys, adding retries or increasing the three-minute browser job limit. Preserve the parallel Desktop/Mobile evidence architecture so feedback remains fast.

## Evidence

- ESLint rejected `tests/e2e/account-auth.e2e.js` because a RegExp constructor escaped `?` unnecessarily.
- The local Supabase journey sent a malformed SQL-like nickname to the read-only profile action. `game-api` called `get_game_player_profile` before structural validation, the RPC failed and the public boundary returned HTTP 500.
- Several independent Playwright shards timed out in their first `page.goto()` while the page was visibly rendered.
- `nickname-input-guard.js` observed `disabled` and `hidden`, then assigned those same properties on every observer callback. Reassigning an unchanged reflected boolean attribute retriggered the observer and continuously queued `applyHomeGate` microtasks.
- The browser workflow still uses eight shards per project, sixteen parallel jobs, two Playwright workers per shard and a three-minute job timeout. The observed failures do not require reducing that parallelism.

## Decisions

1. Keep the existing 16-shard browser matrix, `max-parallel: 16`, two Playwright workers and three-minute job limits unchanged.
2. Make the nickname gate idempotent: write `disabled` and `hidden` only when the desired boolean differs from the current state.
3. Add a deterministic VM regression that executes the real browser script with observed boolean properties and proves the queued mutation microtasks settle instead of feeding back indefinitely.
4. Validate `profile`, `public-profile` and `nick-status` through the shared structural nickname policy before invoking PostgreSQL.
5. Return HTTP 400 with the shared `nick_<reason>` code for malformed read-only nickname requests. Do not expose database errors or treat invalid input as an internal failure.
6. Tighten the real local Supabase regression to require the exact 400 response and `nick_invalid_characters` code.
7. Keep ESLint strict and replace the unnecessary escape with a character class rather than suppressing the rule.

## Acceptance criteria

- [x] The nickname observer cannot repeatedly mutate unchanged `disabled` or `hidden` attributes.
- [x] A deterministic regression fails against the previous observer implementation and settles against the fixed implementation.
- [x] SQL-like nickname input on the profile action returns HTTP 400 before the database boundary.
- [x] The profile rejection uses `nick_invalid_characters` and the shared user-facing validation message.
- [x] ESLint no longer reports `no-useless-escape` in the authentication journey.
- [x] No retry, skip, timeout increase, shard reduction or worker reduction is introduced.
- [ ] Pull Request Quality Pipeline is green on the final head.
- [ ] Player Pages and Social Cards is green on the final head.
- [ ] The final platform evidence ZIP is complete and bound to the final head.

## Validation

- `node --check public/nickname-input-guard.js`
- Vitest regression for the observed boolean-attribute feedback loop.
- Security contract assertions for shared profile nickname validation.
- Local Supabase input-security journey with real Edge Functions and PostgreSQL.
- ESLint over repository JavaScript.
- Full Desktop/Mobile Playwright shard matrix with no retries.
- Final workflow run IDs, job durations and evidence digest must be recorded after CI completes.

## Risks

- The browser fix changes only redundant DOM writes. If another script relies on receiving mutation notifications when the boolean value is unchanged, that reliance is invalid and must not be preserved.
- Structural validation now rejects malformed legacy profile URLs before PostgreSQL. Valid existing nicknames remain accepted by the same shared policy and database constraint used elsewhere.
- Sequential GitHub contents writes generated several small commits because the connected GitHub API does not expose an atomic patch operation. They remain on the existing task branch and PR; no additional branch or PR was created.

## Rollback

Revert the commits from this specification. Do not restore the observer feedback loop, suppress ESLint or weaken the security regression. If rollback is required, replace the observer with an equivalent idempotent state synchronizer and retain pre-RPC profile validation.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`
- Pull request: `#39`
- No merge, deployment, release, production migration or provider configuration is included.
