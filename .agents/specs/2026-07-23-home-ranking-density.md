# Home ranking density and redundant metrics removal

## Request

Refine the home page shown in the production screenshot:

1. Remove the entire global metrics strip below the Spain/Argentina score card.
2. Make each left-sidebar precision ranking row compact enough to keep the elapsed time on the same visual line.
3. Remove the visible country name from those ranking rows because the flag already communicates the team.
4. Preserve an accessible country fallback on every ranking flag.

## Evidence

- `public/index.html` renders a dedicated `.stats-strip` containing global players, verified attempts, and perfect attempts directly below the battle score.
- `public/app.js` writes into those three removed elements on every stats refresh.
- Both `public/app.js` and the delayed `public/v4.js` fallback render the player time inside secondary metadata, while `public/ranking-enhancements.js` injects the full country label through `player-ui.js`.
- The narrow left column makes that metadata wrap and increases every ranking-row height.
- Existing flags are decorative CSS spans with `aria-hidden="true"`; once the visible country label is removed, the ranking-specific flag must provide the country alternative itself.

## Decision

- Remove the metrics-strip markup and the corresponding DOM writes rather than hiding the section with CSS.
- Keep the API payload unchanged because the aggregate values may still be used by other pages and clients.
- Render sidebar ranking identity as one horizontal flex line: nickname, compact flag image, and elapsed time; keep the difference as the final grid column.
- Use repository-owned Spain and Argentina SVG flag assets with non-empty `alt` text and explicit dimensions.
- Apply the same markup contract to the primary stats renderer, delayed fallback renderer, and mutation enhancer.
- Add a final stylesheet override dedicated to the compact sidebar layout instead of changing unrelated historical style layers.

## Acceptance

- The home DOM contains no global metrics strip and no removed metric IDs.
- Stats refreshes do not query the removed elements or throw because they are absent.
- Every populated sidebar ranking row remains a single visual line at desktop and mobile test viewports.
- Sidebar rows show no visible `España` or `Argentina` text.
- Every sidebar flag is an `img` with `alt="España"` or `alt="Argentina"`, explicit width and height, and a valid local asset.
- Long nicknames truncate instead of forcing metrics onto another line or causing horizontal overflow.
- Primary and fallback ranking requests produce the same compact structure.
- Vitest, syntax, ESLint, Knip, public assets, desktop/mobile Playwright, visual-evidence policy, and the full quality pipeline pass.

## Scope

- Home page global score area.
- Home page top-10 precision sidebar.
- Ranking renderer/enhancer consistency, tests, assets, and PR visual evidence.
- No dedicated ranking-page layout, scoring, API, database, gameplay, captcha, account, award, or social-card behavior changes.

## Risks

- The sidebar is intentionally narrow; the nickname must be the only flexible/shrinkable segment.
- A fallback renderer can overwrite the primary renderer after load, so both implementations must share the same contract.
- Removing visible country text makes flag alternative text informational rather than decorative.

## Tests

- Static Vitest contracts for removed markup/DOM writes, identical compact renderer structure, accessible flag assets, and no country-name injection.
- Desktop and mobile Playwright checks for absent metrics, flag `alt`, one-line geometry, nickname truncation, and horizontal overflow.
- Deterministic desktop/mobile home-ranking screenshots for the pull request.

## Rollback

Revert the task commits. No migration, API, or persistent-data rollback is required.

## Delivery

- Branch: `agent/fix-player-card-radar`
- Pull request: `#17`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation in progress.
