# Frontend visual evidence contract

This is a stable repository rule for every frontend pull request.

## Required media

For each affected page, component or interactive state, the pull request must show a matched evidence set:

1. **Desktop PNG** — the complete browser viewport at the configured desktop project resolution.
2. **Mobile PNG** — the complete browser viewport at the configured mobile project resolution.
3. **Animated GIF** — derived from a real browser video recording of the complete interaction, beginning before the changed state appears and ending after its animation or transition finishes.

Static screenshots and recordings must capture the page, not an isolated locator. The surrounding UI is part of the evidence because it proves positioning, overlap, responsive behavior and viewport containment.

## Quality rules

- Capture from the current PR head only.
- Use Playwright project viewports and native screenshot resolution.
- Use lossless PNG for static evidence.
- Record the complete Desktop and Mobile viewport in WebM.
- Never crop the changed element out of its page context.
- Never reuse evidence from another commit or pull request.
- Do not resize with nearest-neighbor or destructive compression.
- GIF conversion must preserve the complete video frame, keep aspect ratio, use Lanczos scaling and a full 256-color palette.
- Desktop and mobile evidence must show the same behavior and content.
- Reduced-motion behavior remains a separate automated assertion; the main GIF records the standard animation.

## Generation

Run:

```bash
pnpm preview:pr
```

The command clears and recreates `.tmp/pr-previews/`, runs the responsive browser suite, captures complete Desktop/Mobile screenshots, records the real interaction in WebM and encodes each recording into a looping GIF.

Expected files for a dynamic area named `example`:

```text
.tmp/pr-previews/example-desktop.png
.tmp/pr-previews/example-mobile.png
.tmp/pr-previews/example-desktop.webm
.tmp/pr-previews/example-mobile.webm
.tmp/pr-previews/example-desktop.gif
.tmp/pr-previews/example-mobile.gif
```

## Publication

Generated evidence must not be committed to the feature branch or `main`.

Preferred publication order:

1. Attach the generated PNG/GIF files directly to the pull request and keep WebM available as the full-quality recording.
2. When direct attachment is unavailable, publish the exact generated files to a dedicated `pr-evidence/<number>` branch and embed its immutable raw commit URLs in the pull request.
3. Include the GIF and full-quality PNG/WebM download links in the final user-facing report whenever the work is performed through an agent.

## CI enforcement

`scripts/pr-visual-evidence.mjs` requires a complete Desktop/Mobile/GIF set for every frontend evidence area in the pull request body. Missing, duplicated or placeholder media fails the visual-evidence workflow.

The browser workflow uploads `.tmp/pr-previews/` as an artifact. That artifact is the source of truth for evidence publication and must correspond to the final PR head.
