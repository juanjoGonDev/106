# CI regression fix after authentication hardening

## Status

In progress. The final Supabase allocation has completed one full green workflow set. Two additional consecutive complete green sets are required, followed by a green documentation-close head.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards and six isolated Supabase domains.
- The exact 30-second anti-abuse journey made `gameplay-sharing` reach three minutes during cleanup.
- Measured `security` had approximately 59 seconds of margin, so ready-flow now runs there; `gameplay-sharing` remains dedicated to trophies and social cards.
- No timeout, assertion duration, coverage, retry or shard count was weakened.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] All jobs remain bounded to three minutes or less.
- [x] Final allocation stability execution 1/3 green.
- [ ] Final allocation stability execution 2/3 green.
- [ ] Final allocation stability execution 3/3 green.
- [ ] Documentation-close head green.

## Validation

### Final allocation execution 1/3

Head: `410f3bd9bd1bfd9c17b781fde006f1331e3ea17d`.

- Pull Request Quality Pipeline `30429466608`: success.
- Player Pages and Social Cards `30429466793`: success.
- Authentication Quality `30429466534`: success.
- Public Asset Audit `30429466619`: success.
- Pull Request Visual Evidence `30429466621`: success.

### Evidence artifact

- `platform-evidence-30427861063`, artifact ID `8714334100`.
- Size `157401387` bytes.
- SHA-256 `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.

## Risks

- `security` is longer but passed with measured margin under the unchanged three-minute limit.
- PR metadata remains part of CI and must retain its marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, install full FFmpeg, increase timeouts or recombine the Supabase journey.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `1/3`.
- No merge, deployment, release or production migration included.
