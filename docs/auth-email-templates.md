# Authentication email templates

Minuto 106 maintains every Supabase Auth email from one data-driven catalogue in `scripts/auth-email-templates.mjs`. The renderer centralizes the layout, inline styles, product image, color tokens, security footer and hosted configuration keys. Generated HTML remains committed because Supabase consumes a complete standalone template for each flow and email clients do not reliably load shared stylesheets.

## Maintained catalogue

| Category | Supabase type | Repository source |
|---|---|---|
| Authentication | `confirmation` | `supabase/templates/confirmation.html` |
| Authentication | `recovery` | `supabase/templates/recovery.html` |
| Authentication | `magic_link` | `supabase/templates/magic-link.html` |
| Authentication | `invite` | `supabase/templates/invite.html` |
| Authentication | `email_change` | `supabase/templates/email-change.html` |
| Authentication | `reauthentication` | `supabase/templates/reauthentication.html` |
| Security notification | `password_changed` | `supabase/templates/notifications/password-changed.html` |
| Security notification | `email_changed` | `supabase/templates/notifications/email-changed.html` |
| Security notification | `phone_changed` | `supabase/templates/notifications/phone-changed.html` |
| Security notification | `mfa_factor_enrolled` | `supabase/templates/notifications/mfa-factor-enrolled.html` |
| Security notification | `mfa_factor_unenrolled` | `supabase/templates/notifications/mfa-factor-unenrolled.html` |
| Security notification | `identity_linked` | `supabase/templates/notifications/identity-linked.html` |
| Security notification | `identity_unlinked` | `supabase/templates/notifications/identity-unlinked.html` |

The signup confirmation, magic-link and reauthentication messages show the supported one-time code prominently. Confirmation preserves the application-owned `RedirectTo` plus `TokenHash` verification route. Other action templates use Supabase's `ConfirmationURL` so recovery, invitation and email-change semantics remain owned by Auth.

## Local workflow

Regenerate committed HTML after changing the catalogue:

```bash
pnpm build:auth-emails
```

Verify that every generated file is current:

```bash
pnpm check:auth-emails
pnpm test:auth-email-templates:coverage
```

`pnpm check` runs both contracts. `supabase/config.toml` maps every local Auth email and enables the security notifications. A local `supabase start` consumes these files directly.

## Hosted Supabase rollout

Repository files and `supabase/config.toml` do **not** mutate the hosted project's Auth configuration. After the pull request is approved and merged, an authorized operator must apply the maintained subjects, HTML bodies and notification flags in one of two ways.

### Dashboard

1. Open the hosted project.
2. Go to Authentication → Email Templates.
3. Copy each subject and generated HTML body from the corresponding repository file.
4. Enable the maintained security notifications.
5. Save and send real confirmation, recovery and security smoke emails.

### Management API payload

Generate the complete credential-free request body:

```bash
mkdir -p .tmp
pnpm auth:emails:hosted > .tmp/auth-email-config.json
```

Inspect the payload before applying it. Then use an operator-owned Supabase access token from a protected shell:

```bash
curl --fail-with-body --request PATCH \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/config/auth" \
  --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  --header "Content-Type: application/json" \
  --data-binary @.tmp/auth-email-config.json
```

Never commit `.tmp/auth-email-config.json`, an access token, SMTP key, secret key or service-role credential. The generated JSON contains no credentials, but it is still an operational configuration artifact and should be reviewed before use.

## Verification checklist

1. Confirm the hosted subject is Spanish and branded rather than the Supabase default.
2. Confirm the hero image loads from the canonical Pages asset and meaningful text remains when images are blocked.
3. Confirm signup displays both the OTP and verification button.
4. Confirm the button reaches `verificar-email.html` and a manual OTP succeeds.
5. Confirm recovery reaches `restablecer-clave.html` and cannot be replayed.
6. Confirm Gmail desktop/mobile and at least one non-Gmail client preserve hierarchy, contrast, wrapping and the plain-link fallback.
7. Confirm security notifications contain the expected event variable without exposing credentials.
8. Disable click tracking in the SMTP provider for Auth messages so verification links are not rewritten.

## Default-template fallback

A plain Supabase email after hosted synchronization is not acceptable evidence that the repository source is active. Check hosted Auth logs for template parse failures and verify that only supported Go-template variables are present. Supabase can fall back to a default message when the hosted template is missing or invalid.

## Rollback

Before changing hosted configuration, export its current `mailer_*` values. Restore that payload through the dashboard or Management API if delivery or rendering regresses. Repository changes and hosted Auth configuration are independent rollback boundaries.
