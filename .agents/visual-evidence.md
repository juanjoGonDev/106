# Visual evidence workflow

## Purpose

Visual evidence is a required acceptance artifact for frontend and UX work. It must let a reviewer inspect the final pull-request head from a phone without cloning the repository or starting the application.

The browser evidence has two layers:

1. **Full-platform baseline:** all maintained browser screens and visual states are captured in Desktop and Mobile PNG files on every browser frontend PR.
2. **Changed-area evidence:** each changed browser interaction or visual area is embedded in the PR as Desktop PNG, Mobile PNG and GIF, while the corresponding WebM remains in the platform artifact.

Supabase Auth email templates are non-browser delivery surfaces. They are excluded from the browser viewport/GIF metadata contract because they are rendered by external email clients after hosted Auth configuration. Email changes instead require deterministic generated HTML, template-variable and layout contracts, local Supabase startup, and real hosted smoke messages in Gmail desktop/mobile plus at least one non-Gmail client before production activation. This exception does not apply to web pages that preview or manage emails.

## Canonical command

Run from the final branch head:

```bash
pnpm preview:platform
```

`pnpm preview:pr` remains a compatibility alias. Both commands clear stale output, execute the real Playwright suite, generate GIFs from real full-viewport WebM recordings, validate the platform inventory and write the integrity manifest under `.tmp/pr-previews/`.

## Executable inventory

`scripts/platform-evidence.mjs` is the source of truth for required evidence IDs.

- `REQUIRED_PLATFORM_SNAPSHOTS` contains every maintained screen or visual state. Each ID requires exactly:
  - `<id>-desktop.png`
  - `<id>-mobile.png`
- `REQUIRED_PLATFORM_INTERACTIONS` contains animated actions and events. Each ID additionally requires exactly:
  - `<id>-desktop.webm`
  - `<id>-mobile.webm`
  - `<id>-desktop.gif`
  - `<id>-mobile.gif`

When a route, modal, state, animation, notification, game phase, share flow or competition phase is introduced or removed, update the Playwright capture and executable inventory in the same PR. A missing or duplicate required file is a blocking failure.

The current inventory covers:

- application shell and primary browser surface;
- game readiness, countdown, awards and post-attempt behavior;
- home statistics, rankings, awards and competition selection;
- account actions;
- precision, trophy and achievement rankings;
- player overview, navigation, profile states, achievements, trophies and honours progress;
- duel and shared-result surfaces;
- league directory, public, waiting, scheduled and active states;
- achievement unlock and daily-award animations;
- legal, privacy, cookies and privacy-settings surfaces.

## Capture rules

- Capture the complete viewport or complete page; do not capture only the changed component.
- Use the repository Desktop and Mobile Playwright projects.
- Capture realistic surrounding content and the full lifecycle of animated behavior.
- Start recordings before the user action or event and end after the resulting state is stable.
- GIFs must be derived from the corresponding real WebM recording.
- Do not reuse evidence from another branch, commit or PR.
- Do not manually resize, crop, recreate, recompress or replace generated evidence.
- Inspect browser console, page errors, network failures, overflow and responsive layout during the journey.

## Artifact contract

After Playwright and GIF generation, `scripts/package-platform-evidence.mjs` validates the inventory and writes `.tmp/pr-previews/manifest.json`.

The manifest records:

- schema version;
- generation timestamp;
- commit SHA when available;
- screen and interaction inventories;
- every file path;
- file size;
- SHA-256 digest.

GitHub Actions uploads `.tmp/pr-previews/` as `platform-evidence-<run-id>` with 14-day retention. GitHub exposes that artifact as one downloadable ZIP. Generated media and ZIP contents must remain outside Git.

## Pull-request requirements

For a browser frontend PR:

1. Wait for the browser workflow to create the platform artifact.
2. Update the same PR body with the canonical artifact URL.
3. Add one `<details>` group per changed area containing matching Desktop, Mobile and GIF evidence.
4. Keep the WebM recordings and complete platform inventory in the artifact ZIP.
5. Verify the PR metadata workflow, full browser workflow and quality pipeline are green.

For an email-template-only visual change:

1. Keep all templates generated from one reviewed renderer and enforce zero stale generated files.
2. Validate local Supabase can load every configured authentication and security-notification template.
3. Document the hosted configuration boundary and rollback payload.
4. After hosted activation approval, send and inspect real messages in Gmail desktop/mobile and at least one non-Gmail client before production completion.
5. Do not fabricate browser screenshots or static GIFs for an external email-client surface.

Do not create `pr-evidence/*` branches or a second PR. Evidence URLs from such branches are rejected.

## Final report

The user-facing completion report must include:

- the PR URL;
- the final commit SHA;
- verified checks;
- a link to the downloadable platform evidence ZIP for browser frontend changes;
- the hosted email-client smoke status for email-template changes;
- exact blockers when any check or artifact is incomplete.

A browser frontend task is not complete without the final-head artifact and a green evidence contract. An email-template task is not production-complete until the hosted templates and real-client smoke checks are explicitly approved and executed.
