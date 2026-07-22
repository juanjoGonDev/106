# Chrome captcha and account bootstrap recovery

## Request

Fix the deployed game after PR #12 so a browser without saved site data can prepare an attempt automatically and an incorrect numbered-ball press always displays a newly generated captcha in Chrome mobile as well as Brave and desktop browsers.

## Evidence

- Production `game-ready-api` returns `400` with `Necesitas la clave privada de tu cuenta.` during `prepare-start`.
- `access.js` creates and forwards `x-account-token` for the legacy `start` action, but the new interceptor replaces that request with `prepare-start`, which is absent from the protected action set.
- The captcha server already returns a new check ID and materially different coordinates.
- The dialog reuses one canvas and stores a resize callback by value. Mobile Chrome can queue a resize frame for the old challenge while its browser chrome changes viewport height; that stale callback may repaint the previous ball layout after the replacement layout was drawn.
- Static API tests inject an account token directly and therefore did not exercise the browser fetch-wrapper chain.

## Decision

- Treat `prepare-start` as an account-protected action so the browser creates one account key and forwards it before the prepared challenge is authorized.
- Keep account creation automatic; do not require users to visit the account page before their first attempt.
- Introduce a revision-aware frame renderer in the covered readiness module.
- Invalidate pending captcha redraws whenever a challenge settles or reloads, and schedule resize rendering through the revision-aware renderer so callbacks captured for an old challenge cannot repaint it.
- Render every accepted replacement immediately and once on the next animation frame to cover Chrome layout/paint stabilization without closing the modal.
- Add a browser-wrapper test that executes `access.js` and verifies `prepare-start` receives a generated `x-account-token`.
- Keep the server requirement for account authorization; the defect is missing client bootstrap, not an authorization rule to remove.

## Acceptance criteria

- With empty local storage, `prepare-start` contains a newly generated 64-character hexadecimal `x-account-token`.
- Existing valid account keys continue to be reused rather than replaced.
- An incorrect captcha press requests a new check ID and materially different coordinates.
- A queued resize callback for the old captcha cannot repaint after the replacement challenge becomes current.
- The replacement is painted immediately and on the next animation frame while the same modal remains mounted.
- Chrome mobile, Brave mobile, desktop mouse and touch contracts remain supported.
- The readiness/frame module remains at 100% lines, functions and branches.
- Vitest, ESLint, Knip, security and local Supabase integration pass.

## Risks

- Automatic key creation persists a private account token in local storage, matching the existing account model and first-attempt behavior.
- Additional next-frame repaint performs one extra canvas draw only when a captcha challenge is installed; it does not add network delay.

## Rollback

Revert the pull request. No database migration, data mutation or Edge Function contract change is required.

## Delivery

- Branch: `agent/fix-chrome-captcha-account-bootstrap`
- Base: deployed `main` containing PR #12.
- Normal pull request to `main`; no merge or deployment without explicit approval.

## Status

Implementation in progress.
