# Social preview image

## Request

Use the supplied Spain-versus-Argentina promotional image as the default preview whenever the application URL is shared. Rename it to a stable repository asset and cover Open Graph, Twitter Card, and structured-data consumers.

A review of the first compressed asset found severe visual corruption: the lower section rendered white and the remaining image lost unacceptable detail. The final asset must preserve the complete poster while reducing transfer size.

## Evidence

- `public/index.html` already declared Open Graph and Twitter metadata, but all image fields referenced the previous remote Supabase card.
- The supplied source image is a 1731×909 football poster suitable for a large social card.
- Social crawlers require an absolute, publicly accessible image URL; a temporary ChatGPT download URL is not suitable for production metadata.
- The first repository JPEG was visually incomplete and therefore not acceptable despite its lower weight.
- The public-asset audit requires every repository-owned media file to have a local ownership reference.

## Decision

- Store the corrected optimized image at `public/assets/minuto-106-social-preview.jpg`.
- Crop and resample from the original PNG directly to the exact 1200×630 Open Graph canvas with Lanczos resampling; do not resize or recompress the broken intermediate asset.
- Export as progressive JPEG at quality 80 with optimized Huffman tables and 4:2:0 chroma subsampling. This keeps the complete composition and produces a 220,484-byte asset.
- Use the GitHub Pages absolute URL for `og:image`, `og:image:url`, `og:image:secure_url`, `twitter:image`, `twitter:image:src`, and the Schema.org `VideoGame.image` property.
- Keep `summary_large_image`, explicit dimensions, MIME type, and descriptive alternative text.
- Add a version query to invalidate previously cached previews after deployment.
- Register the same image as a wide PWA manifest screenshot so the repository asset has an explicit local reference and remains discoverable by compatible install surfaces.

## Acceptance

- Sharing `https://juanjogondev.github.io/106/` resolves the new image from the application origin.
- Open Graph, Twitter Card, and JSON-LD all reference the same absolute image URL.
- The asset is exactly 1200×630, uses a crawler-compatible JPEG format, and has a stable descriptive filename.
- The full lower CTA section renders correctly with no white or blank band.
- Text, faces, trophy, crests, and high-contrast effects remain legible at social-preview size.
- The optimized file remains below 250 KB.
- Existing title, description, canonical URL, gameplay markup, and runtime scripts remain unchanged.

## Scope

- Home-page social metadata.
- One optimized static image asset.
- PWA manifest ownership reference for that asset.
- No dynamic player cards, gameplay, API, database, authentication, or deployment configuration changes.

## Risks

- Social networks cache previews independently; the versioned URL reduces stale-card risk, but each platform controls refresh timing.
- GitHub Pages must deploy the branch after merge before the public image URL becomes available.
- JPEG chroma subsampling can soften saturated edges; visual inspection confirms the selected quality remains acceptable for this 1200×630 poster.

## Validation

- Rebuilt the JPEG from the original 1731×909 PNG rather than the corrupt intermediate file.
- Confirmed output dimensions are exactly 1200×630.
- Confirmed output weight is 220,484 bytes.
- Visually inspected the final file: the image fills the entire canvas, the CTA remains intact, and there is no white lower band.
- Confirmed all social and structured-data image fields use `https://juanjogondev.github.io/106/assets/minuto-106-social-preview.jpg?v=20260723-2`.
- Confirmed the metadata declares `image/jpeg`, width `1200`, height `630`, and non-empty alternative text.
- Confirmed `public/site.webmanifest` references the repository asset as a 1200×630 wide screenshot.

## Rollback

Revert the metadata, manifest, and asset commits. No migration or persistent-data rollback is required.

## Delivery

- Branch: `agent/feat-social-preview-image`
- Base: `main`
- Pull request: `#20`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Corrected asset and ownership reference committed; pull-request checks pending.
