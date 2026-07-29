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

Repository files and `supabase/config.toml` do **not** mutate the hosted project's Auth configuration. Production synchronization is therefore part of the existing protected `Deploy Supabase backend safely` workflow.

On a push to `main` that changes maintained email sources, generated templates, Auth configuration or the synchronization scripts, the production workflow:

1. Reads the current hosted Auth configuration through the Supabase Management API.
2. Compares only the maintained `mailer_*` keys with the generated catalogue.
3. Skips PATCH when no managed value has drifted.
4. PATCHes the complete maintained payload when drift exists.
5. Reads the hosted configuration again and fails unless every managed key matches exactly.
6. Runs this gate before database migration or Edge Function deployment.

The workflow uses the protected `production` environment with:

- `SUPABASE_ACCESS_TOKEN` as an Actions secret;
- `SUPABASE_PROJECT_ID` as an Actions variable.

No HTML body, access token or SMTP credential is printed. Failures report managed key names, HTTP status and a bounded Management API response.

### Operator commands

Generate the complete credential-free hosted payload for review:

```bash
mkdir -p .tmp
pnpm auth:emails:hosted > .tmp/auth-email-config.json
```

Check whether the hosted project matches without modifying it:

```bash
SUPABASE_PROJECT_ID=your-project-ref \
SUPABASE_ACCESS_TOKEN=your-operator-token \
pnpm auth:emails:sync
```

Apply and verify manually only from an authorized protected shell:

```bash
SUPABASE_PROJECT_ID=your-project-ref \
SUPABASE_ACCESS_TOKEN=your-operator-token \
node scripts/sync-hosted-auth-email-templates.mjs --apply
```

Never commit `.tmp/auth-email-config.json`, an access token, SMTP key, secret key or service-role credential. The generated JSON contains no credentials, but it remains an operational configuration artifact.

### Supabase plan and SMTP restrictions

A newly created Free project using Supabase's default SMTP provider may reject custom Auth templates. In that case the synchronization gate fails instead of silently continuing with the old/default message. Configure custom SMTP or use an eligible plan, then rerun the protected production deployment. Minuto 106 currently expects its external SMTP provider to remain configured and healthy.

## Verification checklist

1. Confirm the protected Supabase deployment reports hosted Auth synchronization and exact post-PATCH verification.
2. Confirm the hosted subject is Spanish and branded rather than the Supabase default.
3. Confirm the hero image loads from the canonical Pages asset and meaningful text remains when images are blocked.
4. Confirm signup displays both the OTP and verification button.
5. Confirm the button reaches `verificar-email.html` and a manual OTP succeeds.
6. Confirm recovery reaches `restablecer-clave.html` and cannot be replayed.
7. Confirm Gmail desktop/mobile and at least one non-Gmail client preserve hierarchy, contrast, wrapping and the plain-link fallback.
8. Confirm security notifications contain the expected event variable without exposing credentials.
9. Disable click tracking in the SMTP provider for Auth messages so verification links are not rewritten.

## Default-template fallback

A plain Supabase email after a successful repository merge is expected until the protected Supabase production workflow has synchronized the hosted project. A plain email after that workflow reports successful post-PATCH verification is a defect.

Check hosted Auth logs for template parse failures, verify the project is using the intended SMTP provider and confirm that only supported Go-template variables are present. A hosted template that is missing, rejected or invalid can result in Supabase sending its default message.

## Rollback

Before changing hosted configuration manually, export its current `mailer_*` values. Restore that payload through the dashboard or Management API if delivery or rendering regresses. Repository changes and hosted Auth configuration remain independent rollback boundaries. A workflow rollback must use a normal revert and must not expose or rotate credentials in source.