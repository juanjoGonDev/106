# Analytics and consent operations

## Shared implementation

Every content page loads `privacy-bootstrap.js` as the first script in `<head>`. That single module initializes Consent Mode v2, restores a non-expired first-party choice, and loads Google Tag Manager container `GTM-NKZK4DC5`. The full inline bootstrap is not duplicated across pages.

`layout.js` owns the shared privacy banner, preference dialog, footer entry point, privacy chip integration, shared stylesheet detection, and loading of `compliance.js`. Content pages contain no duplicated consent UI. The standard GTM `<noscript>` iframe remains in each HTML document because it must work when JavaScript—and therefore the client-side layout—is unavailable. Introducing a build-time template engine solely to remove that mandatory fallback would add more architecture than it removes.

Consent defaults are set before GTM. `analytics_storage`, `ad_storage`, `ad_user_data`, and `ad_personalization` are denied unless a saved choice made within the previous 24 months grants the category. The site updates those values when a visitor accepts, rejects, changes, or withdraws consent.

## Required GTM configuration

Repository code cannot inspect or publish the remote GTM workspace. Before treating analytics as operational, verify in Tag Manager and Tag Assistant that:

1. A GA4 Google tag exists for the intended property and web stream.
2. The tag requires `analytics_storage` consent and does not map nicknames, account keys, league codes, form values, challenge identifiers, or other user-provided values into events or user properties.
3. Advertising tags are absent unless the advertising category, policy text, provider list, and `ad_storage`, `ad_user_data`, and `ad_personalization` checks have been reviewed.
4. Enhanced measurement events are reviewed individually.
5. GA4 user and event retention is configured and recorded in the privacy notice.
6. Preview/Tag Assistant shows denied consent before interaction, no Analytics cookies before acceptance, granted analytics after acceptance, and denied analytics after withdrawal.

## Legal and product constraints

- Reject and accept controls have equal prominence.
- Rejecting analytics cannot block gameplay.
- The saved choice expires after at most 24 months.
- The privacy control remains available after the initial choice.
- Adding or changing tags in GTM is a production change even when the repository is unchanged. It requires the same privacy, security, QA, and documentation review as a code deployment.

## Primary references reviewed on 2026-07-22

- Google Tag Manager web-container installation documentation.
- Google Consent Mode v2 website implementation and Tag Assistant debugging documentation.
- Spanish Data Protection Agency cookie guidance requiring informed prior consent and equal prominence for accepting and rejecting optional cookies.
