# Three-minute browser evidence pipeline

## Status

Implementation complete. Final-head CI and the head-bound evidence artifact are the authoritative remaining delivery checks.

## Request

Keep the complete Desktop/Mobile Playwright and visual-evidence contract while reducing every browser workflow job to a maximum of three minutes. Parallelize capture and media processing rather than increasing timeouts or removing journeys. Leave PR #39 fully green.

## Evidence

- The previous monolithic browser job combined every Desktop/Mobile journey, WebM capture, GIF encoding, inventory validation and artifact upload. It reached the 15-minute job timeout.
- The first sharded implementation still had a separate GIF matrix, hidden-only fragment uploads that GitHub ignored, and a diagnostic module whose CLI branches broke its 100% coverage gate.
- Successful Playwright shards were reported as failed when `.tmp/pr-previews` contained only a hidden completion marker because `upload-artifact` excludes hidden files by default.
- Multiple unrelated journeys timed out while their first `page.goto()` waited for the window `load` event. `privacy-bootstrap.js` loaded production Google Tag Manager on localhost, making deterministic local tests depend on an external analytics request.
- The local Supabase runner started Edge Functions and immediately invoked `player-context`; cold startup exceeded the request's 15-second boundary even though migrations, permissions and the database were healthy.
- Email OTP paste sanitization was constrained by HTML `maxlength` before JavaScript could remove separators and non-digits.

## Decisions

1. Use 16 Playwright shards per browser project: 32 independent Desktop/Mobile capture jobs with `max-parallel: 32`.
2. Keep every coverage, capture and aggregation job at `timeout-minutes: 3`; do not use retries, skipped tests or weakened assertions.
3. Encode a shard's GIF files in the same runner immediately after its Playwright journey. This removes an entire dependent matrix and avoids downloading/uploading raw WebM twice.
4. Upload one complete fragment per shard, including a hidden completion marker with `include-hidden-files: true`, so shards without required visual areas remain explicit and valid.
5. Merge fragments with collision detection, validate the full PNG/WebM/GIF inventory, generate the SHA-256 manifest and publish one canonical artifact in a final three-minute job.
6. Keep failure fingerprinting as a pure covered module and move filesystem/CLI adaptation to a thin executable boundary.
7. Preserve production telemetry, but never load Google Tag Manager on `localhost` or `127.0.0.1`. Local runtime and browser tests must not depend on third-party analytics availability.
8. Allow individual complete journeys up to 60 seconds while the containing shard remains capped at three minutes. This is a test boundary, not a retry or fixed sleep.
9. Warm `game-api`, `player-context` and `league-api` explicitly before local integration requests and after a database reset. Fail immediately if the Edge runtime exits.
10. Remove the HTML OTP length clamp so the controller can normalize pasted codes to exactly six digits.

## Acceptance criteria

- [x] No browser/evidence job has a timeout above three minutes.
- [x] Desktop and Mobile execution is divided across 32 independent capture jobs.
- [x] GIF generation remains mandatory and executes inside the owning capture shard.
- [x] Empty evidence shards upload a completion marker rather than failing or silently disappearing.
- [x] The final job rejects duplicate paths and incomplete PNG/WebM/GIF inventories.
- [x] Failure fingerprint logic has 100% line, function and branch coverage.
- [x] Localhost never requests production Google Tag Manager; production host behavior remains covered and unchanged.
- [x] Pasted OTP values are normalized before the six-digit validation boundary.
- [x] Local Supabase tests wait for all required Edge Functions to answer before integration begins.
- [ ] Every final-head workflow is green.
- [ ] The final evidence artifact is bound to the final PR head and contains a valid manifest.

## Validation

- Node coverage: failure summary, platform inventory and fragment merge at 100% lines/functions/branches.
- Vitest: workflow structure, local telemetry isolation, authentication and security contracts.
- Playwright: complete production browser journeys in Desktop and Mobile shards, no retries.
- Supabase: clean stack, warmed Edge Functions, full API/auth journey, database reset and post-reset smoke.
- Final validation must record the latest workflow run IDs, durations and canonical artifact after the head stops changing.

## Risks

- GitHub-hosted runner availability can queue matrix jobs even when each job itself finishes below three minutes. Queue time is external to the job timeout and is reported separately from execution duration.
- More shards consume more runner-minutes and artifact operations. The two-stage design avoids the former separate GIF matrix and minimizes repeated media transfer.
- Disabling GTM on localhost means local analytics debugging requires an explicit production-like host rather than loopback. This is intentional to keep local development private and deterministic.

## Rollback

Revert the browser workflow, diagnostic split, local telemetry guard, OTP input adjustment and Edge warm-up. Restore the previous monolithic evidence command only if the repository also restores its larger timeout policy; otherwise the old workflow will deterministically time out.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`
- Pull request: `#39`
- One branch and one PR remain in use.
- No merge, production deployment, remote migration or provider-secret change is authorized.
