# Clean public share URLs

## Request

Sharing from the application must expose only the public website URL. Supabase Edge Function URLs must never be copied into WhatsApp, X, Telegram, email or the native share sheet.

## Evidence

- The merged sharing flow passes `/functions/v1/social-share/...` URLs directly to `navigator.share` and desktop share destinations.
- Opening that URL exposes the Supabase project hostname and, on the reported Android browser, renders the metadata HTML as visible source text.
- The public application already has canonical routes for players, referrals, miniligas, direct challenges and persisted results.
- GitHub Pages is static and cannot server-render route-specific Open Graph metadata. Dynamic Edge-generated cards therefore cannot be used as the user-visible link without exposing the Edge hostname.

## Decision

1. Every visible sharing action uses the canonical GitHub Pages URL.
2. Edge functions remain internal card renderers only.
3. Native Web Share attaches the generated PNG when the browser supports file sharing, preserving the dynamic visual without exposing the renderer URL.
4. If image download or file sharing is unavailable, share the canonical URL without the attachment.
5. Browser metadata uses the canonical public URL for `og:url`; image metadata may continue to reference the Edge-rendered PNG.
6. Add regression coverage that rejects `supabase.co/functions/v1/social-share` in every user-visible sharing flow.

## Acceptance

- Player sharing copies `/106/player/<nick>[/section]`.
- Referral sharing copies the public root with `?ref=<uuid>`.
- League sharing copies `ligas.html?league=<code>`.
- Duel sharing copies the public root with `?duel=<uuid>`.
- Result sharing copies the public root with `?sharedResult=<uuid>`.
- No native or desktop share payload contains a Supabase hostname.
- Supported mobile browsers receive the dynamic PNG as a file attachment.
- Unsupported browsers retain the existing destination dialog with the clean public URL.
- Unit, coverage, lint, Knip, browser and CI checks pass.

## Risks

- GitHub Pages cannot provide dynamic route-specific crawler metadata. The clean public URL therefore receives the static site preview; the generated player/result card is attached only where Web Share file support exists.
- Some destination applications may ignore either the URL or attached image. The canonical URL remains the source of truth.

## Rollback

Revert the application commit. No database migration or production data change is involved.

## Delivery

- Branch: `agent/fix-clean-public-share-urls`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

In progress.
