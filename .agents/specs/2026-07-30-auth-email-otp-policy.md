# Synchronize Supabase email OTP policy

## Status

Implementation in progress on `agent/fix-auth-otp-policy`. No merge, deployment or hosted configuration mutation is authorized.

## Request

Production confirmation emails currently contain an eight-digit one-time code while the verification page, browser controller and Supabase Auth client only accept six digits. The code length and expiry must be maintained once and propagated to local Supabase, hosted Supabase and the browser without duplicated policy values.

## Evidence

- `supabase/config.toml` configures email OTP expiry but omits `otp_length`, leaving local Auth on its default.
- Hosted Supabase currently emits eight-digit confirmation codes.
- `public/verificar-email.html`, `public/auth-page-controller.js` and `public/supabase-auth-client.js` independently hard-code six digits.
- The hosted Auth synchronization payload manages templates and notification settings but does not manage OTP length or expiry, so configuration drift is not detected or repaired.

## Decision

1. Use `[auth.email]` in `supabase/config.toml` as the only manually maintained source for `otp_length` and `otp_expiry`.
2. Add a narrow validated reader for that section and fail closed on missing, non-integer or unsupported values.
3. Derive the generated browser runtime configuration from that reader.
4. Derive the hosted Supabase Management API payload from the same reader, managing both `mailer_otp_length` and `mailer_otp_exp`.
5. Remove six-digit assumptions from HTML, browser behavior and the Auth client; consume the generated runtime policy instead.
6. Keep the email verification link path independent from numeric OTP entry.
7. Do not add an environment variable or second hand-maintained constant for the configured length or expiry.

## Acceptance criteria

1. `supabase/config.toml` explicitly declares an eight-digit OTP and the existing one-hour expiry.
2. Hosted Auth synchronization detects and repairs drift in OTP length and expiry using the same source.
3. The verification page dynamically exposes an eight-digit numeric input, placeholder, pattern, maximum length and explanatory copy.
4. Seven digits cannot submit, eight digits can submit, and additional or non-numeric input is safely normalized.
5. The Auth client accepts exactly the configured length and rejects missing, malformed, shorter or longer values before network I/O.
6. Invalid or missing generated OTP policy fails closed for code verification without breaking link verification, login, registration or password recovery.
7. The policy parser and new/changed decision logic have deterministic regression tests and 100% line, function and branch coverage where isolated.
8. Local Supabase loads the declared policy and the real browser verification journey remains valid.
9. Desktop and Mobile browser evidence shows the final verification state without overflow, console errors or failed requests.
10. The final PR head has green quality, authentication, Supabase and visual-evidence workflows.

## Validation plan

- Focused Node coverage for the Supabase Auth email policy reader.
- Existing `auth-account-state`, hosted Auth sync and Supabase Auth client 100% coverage suites.
- Contract tests for `supabase/config.toml`, generated runtime config, hosted payload and verification markup/controller wiring.
- Desktop and Mobile Playwright regression for the configured eight-digit input.
- Local Supabase authentication browser journey.
- Full repository quality pipeline and final-head platform evidence artifact.

## Risks

- A malformed source policy could otherwise disable all authentication. The implementation must scope fail-closed behavior to numeric code verification while preserving link verification and unrelated authentication flows.
- Hosted configuration changes occur only after merge through the existing protected production workflow; this task does not run that workflow or mutate production directly.
- Rolling deployment can briefly expose an older browser bundle. The hosted code length must only change through the same merge that publishes the compatible frontend.

## Rollback

Revert the pull request. The protected Supabase deployment workflow will then synchronize the previous managed OTP policy and templates. No database migration or persisted user-data transformation is involved.

## Delivery

- Branch: `agent/fix-auth-otp-policy`
- Base: current `main`
- One normal, non-draft pull request
- No merge, deployment, release or direct hosted Supabase mutation
