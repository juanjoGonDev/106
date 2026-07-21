# Gameplay, legal and branding hardening

## Request

- Run the production Supabase deployment only when backend-affecting files change.
- Make the legal, privacy and storage notices describe the currently deployed behavior.
- Remove internal campaign terminology from repository content.
- Remove keyboard finishing and require pointer-only canvas interactions.
- Add a server-validated numbered-football check before every attempt.
- Repair the favicon and strengthen the rivalry social preview.

## Evidence

- The Supabase workflow used the broad `supabase/**` path trigger.
- Public legal copy described optional analytics and advertising as later possibilities rather than current configuration.
- The README contained internal campaign terminology.
- The final control accepted Enter or Space and randomly alternated between press and release gestures.
- Turnstile was optional and there was no built-in one-time visual proof when its keys were absent.
- The home page did not declare a favicon or manifest, and the social preview used a low-contrast generic composition.

## Scope

### Included

- Production workflow path filters.
- Legal, privacy, cookie and technical documentation.
- Edge Function actions and additive PostgreSQL migration.
- Pointer-only canvas human check and finish control.
- Local Supabase integration tests and static security tests.
- Favicon, manifest, Open Graph metadata and social-preview artwork.

### Excluded

- User identity verification beyond the existing anonymous account key.
- Monetary prizes or fraud guarantees.
- Replacement of Cloudflare Turnstile.
- Official federation, club or national-team marks.

## Decision

- Keep Turnstile as an additional external check when configured.
- Require an internal four-ball canvas check for every attempt.
- Generate ball geometry on the Edge Function, persist it in PostgreSQL and validate ordered pointer coordinates server-side.
- Return a random proof token after successful completion, store only its peppered hash and consume it once during `start`.
- Issue current game challenges through pointer-only wrapper RPCs without rewriting applied migrations.
- Accept only trusted mouse, touch or pen `pointerdown` events for the final stop.
- Treat canvas and closed shadow roots as selector resistance, not as secrecy.
- Use original vector artwork without official crests or third-party assets.

## Risks

- Browser-controlled telemetry can be forged by a determined attacker; server checks reduce common automation but do not provide an absolute guarantee.
- The additional verification adds two API calls before each attempt.
- SVG Open Graph support varies by platform; the repository keeps a 1200×630 SVG until a binary social asset pipeline is added.
- Current legal text identifies the responsible project through the repository and is not a substitute for jurisdiction-specific professional advice if the service becomes commercial.

## Acceptance

- The Supabase workflow does not trigger for unrelated frontend or documentation changes.
- Current public copy states that Google Analytics and AdSense are not loaded when their IDs are absent.
- Repository source contains no internal campaign keyword prohibited by the content test.
- Every `start` request requires a completed, unexpired, unconsumed human proof bound to the device and IP hashes.
- Human proof and final stop accept pointer types `mouse`, `touch` or `pen` only.
- No keyboard event can finish an attempt.
- Ball positions are rendered on one canvas, do not overlap and maintain a server-defined minimum distance.
- RLS protects `game_human_checks`; browser roles have no table or RPC access.
- All public pages declare the new favicon and manifest.
- The home page publishes rivalry-focused Open Graph metadata.

## Validation

- `pnpm check:syntax`: passed in CI.
- `pnpm lint`: passed in CI with zero warnings.
- `pnpm knip`: passed in CI.
- `pnpm test`: passed in CI, including content and security contracts.
- Local Supabase stack: passed.
- All migrations applied from an empty database: passed.
- Edge Function and complete global/league API journey: passed.
- Pull Request Quality Pipeline run `29873682968`: passed.

## Rollback

- Revert the pull request.
- The migration is additive; if already applied, keep the table and functions unused rather than editing or deleting the applied migration.
- Restore the previous Edge Function entrypoints only through a new corrective deployment.

## Delivery

- Branch: `agent/harden-gameplay-legal-branding`
- Pull request: `#6` to `main`.
- No production deployment or merge without explicit approval.

## Status

Implemented and validated. Ready for review.
