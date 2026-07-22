# Mobile gameplay viewport, account link, analytics and consent

## Request

Replace the large account-protection form on the game screen with one accessible link to the account/profile page. Fix the mobile transition from numbered-ball verification to gameplay so the timer is visible without manual scrolling. Install GTM container `GTM-NKZK4DC5`, add consent-aware analytics support, and update cookie, privacy and legal notices.

## Evidence

- The deployed game kept all panels in one grid area while hiding inactive panels with `visibility`; the tall setup panel determined game-card height.
- The browser preserved the scroll position of the lower start action after the verification overlay closed, leaving the timer above the visual viewport.
- `v9.css` contained captcha stability rules but was not linked directly by the game page.
- Account key copy/import controls duplicated the dedicated account page.
- Existing analytics code loaded a direct Google tag only after consent, but the requested GTM container was not installed site-wide.
- Google requires the consent default before measurement commands and Consent Mode v2 includes analytics, advertising user-data and personalization states.
- AEPD guidance requires informed prior consent and accept/reject actions at the same level.

## Decision

- Remove inactive panels from layout participation.
- Observe only activation of the playing panel, center the timer synchronously with `visualViewport`, then verify its position for two animation frames without smooth scrolling.
- Replace the account card with one descriptive keyboard-focusable link and assistive status text.
- Install GTM on every content page, initialize Consent Mode v2 before the container, persist choices for at most 24 months and update consent through the existing privacy UI.
- Remove direct GA script loading to prevent duplicate page views; remote GA4 tag publication remains an explicit GTM operational step.
- Create consent UI on pages that did not previously contain it and keep accept/reject controls equally prominent.
- Update user-facing legal notices and operational documentation.

## Acceptance criteria

- One account/profile link replaces all key controls on the game page.
- Inactive panels cannot determine active game-card height.
- Gameplay activation centers the timer before the first rendered timer frame and stabilizes it across portrait, landscape, tablet and desktop dimensions.
- Captcha action rows remain stable on short and narrow viewports.
- GTM and its no-script fallback are present on every content page.
- Analytics and advertising consent default to denied and can be accepted, rejected or withdrawn.
- No second direct Google Analytics loader exists.
- Legal notices disclose purposes, providers, cookies, retention, withdrawal and transfers.
- Automated tests and the complete PR quality pipeline pass.

## Risks

- Re-centering on unrelated class mutations could distract during gameplay. Mitigation: observe only the playing panel's own class.
- Browser chrome changes visual viewport dimensions. Mitigation: use `visualViewport` and two bounded post-activation frames.
- GTM can be changed remotely without a repository commit. Mitigation: document remote-container changes as production changes and require consent checks in Tag Assistant.
- The standard no-script GTM fallback cannot display an interactive consent UI. Mitigation: tags in the container must require their corresponding consent state; this must be verified before publication.

## Validation

- Unit matrix covers 320×568 through 1440×900, landscape offsets and document-boundary clamping.
- Static contracts cover panel flow, source order, focus without scroll, no smooth scrolling, captcha short-height layout and accessible account markup.
- GTM contracts cover placement, container ID, Consent Mode v2 defaults/updates, no duplicate GA loader, equal accept/reject prominence and legal disclosures.
- CI must run syntax, Vitest, ESLint, Knip, security and Supabase integration.

## Rollback

Revert the pull request. No database or API changes are involved. Remote GTM publication must be rolled back separately in Tag Manager if it has already changed.

## Delivery

- Branch: `agent/fix-mobile-viewport-analytics`
- Base: deployed `main` commit `4a3cff093226540a128d4f86ac9eda26cf2995d7`.
- Normal PR to `main`; no merge, deployment or remote GTM publication without explicit approval.

## Status

Implementation prepared; validation pending.
