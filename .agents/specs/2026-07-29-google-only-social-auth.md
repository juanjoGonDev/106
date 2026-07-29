# Google-only social authentication

## Request

Remove Facebook authentication from every maintained web surface and every current user-facing text. Keep Google as the only social provider while preserving email/password and private-key recovery.

## Evidence

- `login.html`, `registro.html` and `cuenta.html` expose Facebook buttons and copy.
- Browser auth state, route experience and account controllers accept both Google and Facebook.
- `account-auth` accepts Facebook identities at the server boundary.
- Current documentation and tests describe multi-provider Facebook linking.
- The original provider migrations may already be applied in production and must not be rewritten.

## Decision

- Keep email/password and private-key recovery unchanged.
- Make Google the only supported OAuth provider in browser and Edge Function contracts.
- Remove Facebook controls, labels, reward copy and current operational documentation.
- Reject unsupported provider sessions instead of silently classifying them as email.
- Preserve historical migrations; use a new forward-only migration to restrict new provider/origin values without corrupting existing rows.
- Add repository and browser regressions proving Facebook is absent from maintained public surfaces and cannot be started through the OAuth client.

## Acceptance criteria

- [ ] Login, registration and account pages expose only Google as social authentication.
- [ ] No maintained public HTML, runtime JavaScript or current authentication documentation contains Facebook copy.
- [ ] Browser provider normalization accepts only Google.
- [ ] Edge authentication accepts only `email` and `google`; unsupported provider sessions fail closed.
- [ ] Existing Google and email account rewards remain unchanged and non-stackable.
- [ ] Historical applied migrations are not rewritten; a forward migration enforces the new provider policy safely.
- [ ] Unit, security, Supabase integration and Desktop/Mobile Playwright checks pass.
- [ ] Final pull-request head is green and includes complete visual evidence.

## Risks

- Existing Facebook-only sessions become unsupported. They must sign in through email or Google linked to the same canonical account.
- Tightening database constraints can fail if legacy Facebook rows exist. The forward migration must preserve existing rows while preventing new unsupported origins.
- Removing a button without removing backend support would leave an undocumented path; frontend and server contracts must change together.

## Tests

- Provider normalization and reward-message unit tests.
- OAuth client rejection for Facebook and other unsupported providers.
- Edge core rejection for unsupported provider metadata.
- Static contract scan across maintained public/auth documentation.
- Playwright assertions for login, registration and account linking in Desktop and Mobile.
- Real local Supabase Google/email reward and migration upgrade suites.

## Rollback

Revert this branch before deployment. After the forward migration is applied, restore Facebook only through a new forward migration plus provider-contract changes; do not rewrite applied migrations.

## Delivery

- Branch: `agent/feat-google-only-auth`
- Base: `main`
- Merge/deploy/remote migration: not authorized

## Status

In progress.
