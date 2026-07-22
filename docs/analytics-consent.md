# Analytics and consent operations

## Installed container

The public pages load Google Tag Manager container `GTM-NKZK4DC5` near the start of `<head>` and include the standard no-script fallback immediately after `<body>`.

Consent Mode v2 is initialized before the container. `analytics_storage`, `ad_storage`, `ad_user_data`, and `ad_personalization` default to `denied` unless a non-expired saved choice grants the corresponding category. The site updates those values when a visitor accepts, rejects, changes, or withdraws consent.

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
- Google Consent Mode v2 website implementation documentation.
- Google Analytics 4 cookie and data-collection documentation.
- Spanish Data Protection Agency guidance requiring informed prior consent and equal prominence for accepting and rejecting optional cookies.
