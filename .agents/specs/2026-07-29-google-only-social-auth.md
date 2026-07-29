# Google-only social authentication

## Request

Remove Facebook authentication from every maintained web surface and every current user-facing or operational text. Keep Google as the only social provider while preserving email/password and private-key recovery. Update the feature branch with current `main` and restore all CI checks.

## Evidence

- `login.html`, `registro.html` and `cuenta.html` exposed Facebook buttons and copy.
- Browser auth state, route experience and account controllers accepted both Google and Facebook.
- `account-auth` accepted Facebook identities at the server boundary.
- Current privacy/security documentation and integration tests described multi-provider Facebook linking.
- The original provider migrations may already be applied in production and must not be rewritten.
- The first Google-only visual test counted hidden DOM controls on `cuenta.html` and failed despite only one control being visible in each mutually exclusive panel.
- `scripts/test-verified-email-reward-local.mjs` still created a retired-provider identity and expected the new backend contract to accept it.
- The live `auth-browser` matrix job prepared Playwright only after Supabase startup and could cross the mandatory three-minute job limit on a cold runner.
- `main` advanced with the Dependabot major-update policy and workflow; those files did not overlap this feature.

## Decision

- Keep email/password and private-key recovery unchanged.
- Make Google the only supported OAuth provider in browser and Edge Function contracts.
- Remove Facebook controls, labels, reward copy and current operational documentation.
- Reject unsupported provider sessions instead of silently classifying them as email.
- Preserve historical migrations; use a new forward-only migration to restrict new provider/origin values without corrupting existing rows.
- Scan public assets, documentation, Edge Functions and operational scripts for any retired-provider reference.
- Assert the visible OAuth workflow rather than counting controls in hidden mutually exclusive account panels.
- Keep every CI job at three minutes or less. Prepare the Playwright runtime concurrently with the cold Supabase startup for `auth-browser`; disable only video for that live suite while retaining failure traces and screenshots.
- Merge current `main` into the feature branch with a normal two-parent merge commit; do not rebase or force-push.

## Acceptance criteria

- [x] Login, registration and account pages expose only Google as social authentication.
- [x] No maintained public HTML, runtime JavaScript, operational script or current authentication documentation contains Facebook copy.
- [x] Browser provider normalization accepts only Google.
- [x] Edge authentication accepts only `email` and `google`; unsupported provider sessions fail closed.
- [x] Existing Google and email account rewards remain unchanged and non-stackable.
- [x] Historical applied migrations are not rewritten; a forward migration enforces the new provider policy safely.
- [x] Live Supabase reward tests contain no retired-provider success path.
- [x] Desktop and Mobile Playwright assertions validate one visible Google control per active route state.
- [x] The branch contains current `main` without force-push or history rewrite.
- [x] CI keeps its maximum three-minute job contract and overlaps Playwright preparation with Supabase startup.
- [ ] Final pull-request head is green and the PR body references complete evidence generated from that exact head.

## Risks

- Existing Facebook-only sessions become unsupported. They must sign in through email or Google linked to the same canonical account.
- Tightening database constraints can fail if legacy Facebook rows exist. The forward migration uses `NOT VALID` constraints to preserve existing rows while preventing new unsupported origins.
- Removing a button without removing backend support would leave an undocumented path; frontend, server, migration, scripts and tests therefore change together.
- Counting all account-page OAuth nodes would regress because guest and authenticated panels intentionally coexist in the DOM. Tests constrain visibility and panel context instead.
- Cold GitHub-hosted runners can spend most of a three-minute budget pulling Supabase images. Playwright preparation must remain concurrent and its failure output must remain explicit.

## Tests

- Provider normalization and reward-message unit tests.
- OAuth client rejection for Facebook and other unsupported providers.
- Edge core rejection for unsupported provider metadata.
- Static contract scan across maintained public assets, auth documentation, Edge Functions and `scripts/**/*.mjs`.
- Playwright assertions for login, registration and account linking in Desktop and Mobile.
- Real local Supabase Google/email reward, concurrency and migration upgrade suites.
- CI architecture regression proving:
  - every job remains bounded to three minutes;
  - Playwright preparation begins before `supabase start`;
  - the live suite waits for preparation before execution;
  - video is disabled only through an explicit live-suite environment flag;
  - traces and screenshots remain enabled.

## Validation

- Branch synchronized with `main` through merge commit `cc8d07387635c2fb756e37df0d230cc4b6e4491c`.
- Authentication Quality passed after centralizing the canonical 100% coverage scripts.
- Public Asset Audit passed after removing privacy and security references.
- Player Pages and Social Cards passed after changing the OAuth assertion from all DOM nodes to visible controls.
- Supabase `auth-api` passed after replacing the retired-provider integration path with Google-only invariants.
- Final-head acceptance requires successful Quality, Authentication, Public Asset Audit, Player Pages/Social Cards and PR Visual Evidence workflows. Exact final run and artifact identifiers belong in the PR body because they are generated after this document commit.

## Rollback

Revert this branch before deployment. After the forward migration is applied, restore Facebook only through a new forward migration plus provider-contract changes; do not rewrite applied migrations. Reverting the CI overlap is independent from the authentication policy but would reintroduce cold-runner timeout risk.

## Delivery

- Branch: `agent/feat-google-only-auth`
- Base: `main`
- Pull request: `#50`
- Merge/deploy/remote migration: not authorized
- Main synchronization: normal merge commit, no force-push

## Status

Implementation and documentation complete. Awaiting final-head CI and exact-head visual-evidence metadata in the pull-request body before review delivery.