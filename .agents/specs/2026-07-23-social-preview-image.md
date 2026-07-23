# Social preview image

## Request

Use the supplied Spain-versus-Argentina promotional image as the default preview whenever the application URL is shared. Rename it to a stable repository asset and cover Open Graph, Twitter Card, and structured-data consumers.

## Evidence

- `public/index.html` already declared Open Graph and Twitter metadata, but all image fields referenced the previous remote Supabase card.
- The supplied source image is a wide football poster suitable for a large social card.
- Social crawlers require an absolute, publicly accessible image URL; a temporary ChatGPT download URL is not suitable for production metadata.

## Decision

- Store the optimized 1200×630 image at `public/assets/minuto-106-social-preview.jpg`.
- Use the GitHub Pages absolute URL for `og:image`, `og:image:url`, `og:image:secure_url`, `twitter:image`, `twitter:image:src`, and the Schema.org `VideoGame.image` property.
- Keep `summary_large_image`, explicit dimensions, MIME type, and descriptive alternative text.
- Add a version query to invalidate previously cached previews after deployment.

## Acceptance

- Sharing `https://juanjogondev.github.io/106/` resolves the new image from the application origin.
- Open Graph, Twitter Card, and JSON-LD all reference the same absolute image URL.
- The asset is 1200×630, uses a crawler-compatible JPEG format, and has a stable descriptive filename.
- Existing title, description, canonical URL, gameplay markup, and runtime scripts remain unchanged.

## Scope

- Home-page social metadata.
- One optimized static image asset.
- No dynamic player cards, gameplay, API, database, authentication, or deployment configuration changes.

## Risks

- Social networks cache previews independently; the versioned URL reduces stale-card risk, but each platform controls refresh timing.
- GitHub Pages must deploy the branch after merge before the public image URL becomes available.

## Validation

- Confirmed the source was normalized to 1200×630.
- Confirmed all social and structured-data image fields use `https://juanjogondev.github.io/106/assets/minuto-106-social-preview.jpg?v=20260723-2`.
- Confirmed the metadata declares `image/jpeg`, width `1200`, height `630`, and non-empty alternative text.

## Rollback

Revert the metadata and asset commits. No migration or persistent-data rollback is required.

## Delivery

- Branch: `agent/feat-social-preview-image`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation complete; pull-request checks pending.
