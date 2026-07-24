# Clean public share URLs

## Request

Sharing from the application must expose only the public website URL. Supabase Edge Function URLs must never be copied into WhatsApp, X, Telegram, email or the native share sheet.

## Evidence

- The merged sharing flow passed `/functions/v1/social-share/...` URLs directly to `navigator.share` and desktop share destinations.
- Opening that URL exposed the Supabase project hostname and, on the reported Android browser, rendered the metadata HTML as visible source text.
- The public application already has canonical routes for players, referrals, miniligas, direct challenges and persisted results.
- GitHub Pages is static and cannot server-render route-specific Open Graph metadata. Dynamic Edge-generated metadata therefore cannot be used as the user-visible link without exposing the Edge hostname.

## Decision

1. Every visible sharing action uses the canonical GitHub Pages URL.
2. Edge functions remain internal metadata and card renderers only.
3. Browser player metadata uses the canonical public URL for `og:url`; image metadata and card preview/download may continue to reference the Edge-rendered PNG.
4. The clean public URL is authoritative even though static GitHub Pages can only provide the repository-owned site preview to crawlers.
5. Add regression coverage that rejects Supabase hostnames in every user-visible sharing flow.
6. Assert the Edge metadata response remains `text/html`, independently of the public sharing contract.

## Acceptance

- Player sharing copies `/106/player/<nick>[/section]`.
- Referral sharing copies the public root with `?ref=<uuid>`.
- League sharing copies `ligas.html?league=<code>`.
- Duel sharing copies the public root with `?duel=<uuid>`.
- Result sharing copies the public root with `?sharedResult=<uuid>`.
- No native or desktop share payload contains a Supabase hostname.
- Unsupported native sharing retains the existing destination dialog with the same clean public URL.
- Edge metadata responses declare `text/html` and card endpoints remain internal.
- Unit, coverage, lint, Knip, browser and CI checks pass.

## Risks

- GitHub Pages cannot provide route-specific server-rendered metadata. Clean links therefore use the static repository-owned social preview rather than a dynamic player/result preview.
- Exposing a clean and trustworthy public URL takes precedence over route-specific Edge metadata in the share payload.

## Validation

- Pull Request Quality Pipeline #485: passed, including syntax, Vitest, ESLint, Knip, security policy and the full local Supabase journey.
- Player Pages and Social Cards #217: passed, including 100% focused module coverage and desktop/mobile Playwright journeys.
- Public Asset Audit #158: passed.
- Pull Request Visual Evidence #184: passed.
- Regression tests validate canonical player, referral, league, duel and result URLs and reject `supabase.co` in user-visible share payloads.
- The local Edge integration asserts `Content-Type: text/html` for metadata documents and validates generated PNG cards separately.

## Rollback

Revert the application commit. No database migration or production data change is involved.

## Delivery

- Branch: `agent/fix-clean-public-share-urls`
- Base: `main`
- Pull request: #27
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Completed and ready to merge.
