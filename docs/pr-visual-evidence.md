# Pull request visual evidence

Frontend pull requests must show every affected page or state in both desktop and mobile layouts. Generated evidence is review material, not application source, and must never be committed.

## Generate screenshots

```bash
pnpm preview:pr
```

The command runs the deterministic Playwright journeys in Chrome and writes paired images to:

```text
.tmp/pr-previews/
├── home-awards-desktop.png
├── home-awards-mobile.png
├── player-overview-desktop.png
├── player-overview-mobile.png
├── player-achievements-desktop.png
├── player-achievements-mobile.png
├── player-trophies-desktop.png
├── player-trophies-mobile.png
├── ranking-precision-desktop.png
├── ranking-precision-mobile.png
└── ...
```

The directory is ignored by Git. Attach the relevant images to the pull request and use the resulting GitHub attachment URLs inside the paired `<details>` blocks from `.github/pull_request_template.md`.

## Generate a GIF for dynamic behavior

```bash
pnpm preview:pr:gif
```

This runs the same screenshot journey, records deterministic frames for the player tabs, and uses the FFmpeg binary installed by the pinned Playwright runtime to create:

```text
.tmp/pr-previews/player-tabs-desktop.gif
```

A GIF supplements the mandatory desktop/mobile screenshots; it does not replace them.

## Add another page or state

Add a capture call to the relevant Playwright journey in `tests/e2e/player-pages.e2e.js`:

```js
await capture(page, testInfo, 'descriptive-area-name');
```

Both configured projects execute the same call, producing:

```text
.tmp/pr-previews/descriptive-area-name-desktop.png
.tmp/pr-previews/descriptive-area-name-mobile.png
```

For a focused component instead of the full page, pass a locator:

```js
await capture(page, testInfo, 'daily-awards', page.locator('#awardsCard'));
```

For deterministic animation frames, use `captureGifFrame`. Frames must follow actual state transitions and animation frames; do not add arbitrary sleeps.

## CI behavior

- `Player Pages and Social Cards` runs the desktop and Pixel 5 projects and uploads `.tmp/pr-previews` as a seven-day workflow artifact.
- `Pull Request Quality Pipeline` renders the real site and player PNG cards in local Supabase and uploads them as a separate seven-day artifact.
- `Pull Request Visual Evidence` reads the PR body and changed-file list without checking out or executing pull-request code. Frontend changes require matched `Desktop` and `Mobile` `<details>` entries with real Markdown image URLs.
- `check:public-assets` validates static public media that Knip cannot resolve through the JavaScript module graph.

## Review checklist

1. Open every desktop and mobile `<details>` block.
2. Confirm that text, flags, dates, cards, and controls are not clipped.
3. Confirm that there is no horizontal overflow.
4. Check loading, empty, success, and error states when the change affects them.
5. Inspect the optional GIF for layout jumps and delayed transitions.
6. Confirm that `.tmp/pr-previews` is absent from the Git diff.
