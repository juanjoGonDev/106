## What

- Add optional Supabase Auth with Google, Facebook and confirmed email/password.
- Preserve anonymous private-key accounts and recover all linked nicks on new devices.
- Add a service-role-only `account-auth` Edge Function and canonical multiple-credential account model.
- Preview, confirm, cancel and stale-check cross-account merges with exact competitive consequences.
- Reconcile invalid leagues, self-duels, self-referrals, derived trophies, achievements and bonus attempts.
- Store verified contact email privately for future transactional email features.
- Enforce complete `anon`/`authenticated` table, sequence and RPC isolation in local integration and CI.
- Add responsive account and password-recovery UI, real Playwright journeys and required platform evidence.

## Why

Users currently depend on one browser-held private key. Optional Supabase authentication must make progress recoverable without weakening anonymous play or allowing accounts that previously counted as different people to retain invalid competitive rewards after being linked.

## Impact and risk

- User impact: optional Google, Facebook and email access; anonymous play and existing private keys remain valid.
- Security/data impact: verified JWT UUID is the identity boundary; email is private contact data; service-role/provider/SMTP secrets never reach Pages; merges are locked, fingerprinted and audited.
- Compatibility or migration impact: additive credential, identity and merge-audit schema; existing account RPC signatures remain available; old keys resolve to the canonical account after merge.
- Rollback: revert frontend and Edge Function; additive tables may remain dormant. Applied database migrations are never rewritten.

## Validation

- [ ] Formatting / syntax
- [ ] Lint and dead-code analysis
- [ ] Unit, contract and security tests
- [x] Bug regression reproduces the verified failure or root cause
- [x] Relevant boundary, invalid, authorization, timeout, stale-data, retry and idempotency cases
- [x] Relevant concurrency, multi-tab or reordered-response cases
- [x] New isolated decision logic has 100% line/function/branch coverage, or the specification documents the justified exception and alternative proof
- [x] Real local backend/database integration for critical repository-owned flows
- [x] Clean database setup and production-shaped upgrade validation when migrations change
- [x] Complete Desktop Playwright journey
- [x] Complete Mobile Playwright journey
- [x] Persistence, reload, navigation or route restoration verified when relevant
- [x] Accessibility, keyboard and reduced-motion checks when relevant
- [x] No unexpected page errors, console errors, failed requests or horizontal overflow
- [x] No `.skip`, `.only`, retry-as-fix, weakened threshold or fixed sleep used as synchronization

## Full-platform visual evidence ZIP

Every frontend or UX pull request must run the complete maintained platform evidence suite from the final PR head:

```bash
pnpm preview:platform
```

GitHub Actions uploads all complete Desktop/Mobile PNG screenshots, real WebM recordings, derived GIFs and `manifest.json` as one downloadable artifact ZIP.

**Platform evidence:** [Download the complete platform evidence ZIP](PASTE_PLATFORM_EVIDENCE_ARTIFACT_URL)

Do not create or use `pr-evidence/*` branches. Generated media stays outside Git and is published only through the Actions artifact or direct PR attachments.

## Changed-area visual evidence

<!-- visual-evidence:start -->
<details>
  <summary>Account authentication · Desktop</summary>

  Final-head screenshot is included in the platform evidence artifact as `account-auth-desktop.png`.
</details>
<details>
  <summary>Account authentication · Mobile</summary>

  Final-head screenshot is included in the platform evidence artifact as `account-auth-mobile.png`.
</details>
<details>
  <summary>Account authentication · GIF</summary>

  Final-head recordings and GIFs are included as `account-auth-*.webm` and `account-auth-*.gif`.
</details>
<details>
  <summary>Merge integrity confirmation · Desktop and Mobile</summary>

  Final-head screenshots, recordings and GIFs are included as `account-merge-impact-*`.
</details>
<details>
  <summary>Password reset · Desktop and Mobile</summary>

  Final-head screenshots are included as `password-reset-*`.
</details>
<!-- visual-evidence:end -->

## Delivery

- [x] Exactly one task branch and one pull request
- [x] No temporary or evidence branches
- [ ] Platform evidence artifact linked
- [x] PR title follows Conventional Commits
- [x] Documentation/specification updated
- [ ] CI is green
