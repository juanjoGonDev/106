# Repository agent instructions

This file applies to the entire repository. A more specific `AGENTS.md` may refine these rules for its directory, but must not weaken security, validation or delivery requirements.

## Before changing code

- Inspect the repository, current branch, relevant specifications, tests, workflows and runtime boundaries before editing.
- Create or update `.agents/specs/<YYYY-MM-DD>-<slug>.md` with the request, evidence, decision, acceptance criteria, validation, delivery and status.
- Prefer the smallest maintainable change that solves the verified problem. Preserve unrelated work.

## Git and delivery

- Use exactly one task branch and one normal, non-draft pull request.
- Do not create temporary, documentation, screenshot, video or `pr-evidence/*` branches.
- Do not open auxiliary pull requests for generated evidence.
- Use Conventional Commits and stage only task files.
- Do not merge, deploy, publish or run remote migrations unless the user explicitly authorizes it.

## Testing and runtime proof

Read `.agents/testing.md` before changing application behavior, APIs, database logic, deployment workflows or browser journeys.

- Derive tests from the specification and relevant success, boundary, failure, authorization, race, concurrency, expiry and compatibility cases.
- Bugs require a deterministic regression test when practical.
- New isolated decision logic, state machines, parsers, validators, security gates and controllers require 100% line, function and branch coverage.
- Critical repository-owned browser-to-backend behavior requires at least one real local integration journey; mocks may supplement rare failures and races but must not be the only end-to-end proof.
- Playwright acceptance tests must exercise complete user flows in Desktop and Mobile projects and verify final UI, accessibility, persistence or route restoration, console/page errors, failed requests and responsive overflow when relevant.
- Do not weaken thresholds, lint or security rules, and do not use skips, retries, fixed sleeps or snapshot replacement to conceal a failure.

## Quality

- Run the relevant syntax, format, lint, dead-code, security, unit, integration, coverage and browser checks.
- Do not claim success from expectation. Report only checks and runtime behavior that were actually verified.

## Mandatory frontend and UX evidence

Read `.agents/visual-evidence.md` before any frontend, responsive, animation, interaction or UX change.

A frontend task is not complete until the final pull-request head produces the full platform evidence artifact:

- every maintained screen or visual state has a complete Desktop PNG and Mobile PNG;
- every maintained animated action or event has Desktop/Mobile WebM recordings and GIFs derived from those recordings;
- the evidence includes `manifest.json` with file sizes and SHA-256 digests;
- GitHub Actions publishes one `platform-evidence-<run-id>` artifact, downloadable as a ZIP;
- the pull request links that artifact and embeds Desktop/Mobile/GIF evidence for each changed visual area;
- the final user report links the same artifact so it can be reviewed remotely without running the project.

Generate the full suite from the current branch with:

```bash
pnpm preview:platform
```

Never use cropped component-only screenshots, stale evidence, compressed thumbnails, synthetic GIFs, or media from another commit. Update the executable inventory and its Playwright coverage whenever a screen, state, action or event is added, renamed or removed.
