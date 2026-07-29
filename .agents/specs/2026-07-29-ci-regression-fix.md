# CI regression fix after authentication hardening

## Status

In progress. Seven isolated Supabase domains remain bounded to three minutes. Cold Edge compilation uses bounded long-lived probes, migrations removes redundant pre-reset warm-up, and ephemeral GitHub runners omit unnecessary container shutdown. Stability is reset to zero; three clean complete workflow sets are required on this final candidate.

## Request

Fix PR #39 CI without weakening validation, removing journeys, adding behavioral retries, reducing browser coverage or increasing the three-minute job limit. Keep CI highly parallel and prove stability with at least three consecutive complete green executions.

## Evidence and decisions

- Fixed malformed-input HTTP 500 boundaries, nickname observer feedback, CAPTCHA/consent races, PostgREST readiness and GIF generation without system packages.
- Kept 16 Desktop/Mobile browser shards.
- Split Supabase integration into seven isolated domains: `security`, `ready-flow`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser` and `migrations`.
- The exact 30-second anti-abuse journey has its own stack; no timeout, assertion duration, coverage, retry or browser shard was weakened.
- Replaced generic Edge Function warm-up with suite-specific probes after `auth-browser` crashed the local runtime while compiling unrelated functions.
- Migrations performs only the authoritative post-reset warm-up and PostgREST readiness check.
- Ready-flow showed four consecutive 8-second client timeouts before cold compilation completed; aborting each request extended startup and left the successful suite at the job boundary.
- Cold compilation now receives up to 30 seconds per probe with three bounded attempts and a two-second connection timeout. 4xx responses prove a compiled, serving authorization boundary; 5xx and transport errors remain failures.
- Local executions still stop Supabase explicitly. GitHub-hosted jobs kill the function process and rely on ephemeral runner teardown for containers, avoiding roughly twelve seconds of non-functional shutdown after all assertions pass.
- CI contract regressions enforce the matrix, exact assignment, domain warm-up, post-reset migration ordering, bounded cold compilation and cleanup policy.
- The mandatory PR Desktop/Mobile/GIF marker block remains restored.

## Acceptance criteria

- [x] Functional and security regressions pass.
- [x] Every maintained Supabase journey is assigned exactly once.
- [x] Ready-flow has an isolated local stack.
- [x] Edge Function warm-up is domain-specific and permits uninterrupted cold compilation.
- [x] Migration warm-up runs only after database reset.
- [x] Local cleanup remains complete; ephemeral CI cleanup does not consume the assertion budget.
- [x] All jobs remain bounded to three minutes or less.
- [ ] Final stability execution 1/3 green.
- [ ] Final stability execution 2/3 green.
- [ ] Final stability execution 3/3 green.

## Validation history

### Rejected allocations and regressions

- Six-domain allocation: `security` completed assertions but crossed the three-minute boundary during cleanup.
- Generic seven-domain warm-up: `auth-browser` crashed `supabase-edge-runtime` while compiling unrelated functions.
- Double migration warm-up: migrations passed and was cancelled during cleanup.
- Short ready-flow probes: the suite passed its real 30-second deadline assertion but was cancelled during cleanup after repeated cold-compilation aborts.

### Final candidate

Implementation and contract-test head before documentation close: `51ecf99c3f8c0ffc85c2031c7a6ca15b1de296a1`.

### Evidence artifact

- `platform-evidence-30427861063`, artifact ID `8714334100`.
- Size `157401387` bytes.
- SHA-256 `5891e4308251196cb7914f06dca8d1dab91dc8196d9f09db3e6baf75cb1bfc54`.

## Risks

- Seven isolated stacks increase aggregate runner usage, but minimize wall-clock feedback and state coupling.
- Long-lived warm-up requests are infrastructure readiness probes, not behavioral retries; maintained assertions still execute once.
- Ephemeral GitHub runners are destroyed after the job, so retaining containers after the script exits cannot leak state into another job.
- PR metadata remains part of CI and must retain its marker block.

## Rollback

Revert the CI-hardening commits as a unit. Do not restore the observer loop, suppress validation, install full FFmpeg, increase timeouts, recombine ready-flow, restore generic warm-up, reintroduce redundant migration warm-up or spend CI budget stopping ephemeral containers.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `0/3` on the bounded cold-compilation candidate.
- No merge, deployment, release or production migration included.
