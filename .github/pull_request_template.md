## What

<!-- Describe the behavior and files changed. -->

## Why

<!-- Explain the user or technical problem. -->

## Impact and risk

- User impact:
- Security/data impact:
- Compatibility or migration impact:
- Rollback:

## Validation

- [ ] Formatting / syntax
- [ ] Lint
- [ ] Unit and integration tests
- [ ] Coverage for changed behavior
- [ ] Desktop browser journey
- [ ] Mobile browser journey
- [ ] Accessibility and keyboard checks
- [ ] No console or network errors

## Full-platform visual evidence ZIP

Every frontend or UX pull request must run the complete maintained platform evidence suite from the final PR head:

```bash
pnpm preview:platform
```

GitHub Actions uploads all complete Desktop/Mobile PNG screenshots, real WebM recordings, derived GIFs and `manifest.json` as one downloadable artifact ZIP.

**Platform evidence:** [Download the complete platform evidence ZIP](PASTE_PLATFORM_EVIDENCE_ARTIFACT_URL)

Do not create or use `pr-evidence/*` branches. Generated media stays outside Git and is published only through the Actions artifact or direct PR attachments.

## Changed-area visual evidence

Every changed visual area must include three matching inline items:

1. A complete Desktop viewport PNG.
2. A complete Mobile viewport PNG.
3. A GIF derived from the real full-viewport WebM interaction recording.

Evidence must come from the current PR head at native project resolution. Do not use element-only screenshots, crops, compressed thumbnails, stale media, synthetic GIFs or evidence from another commit. Full-quality WebM files remain in the platform ZIP.

<!-- visual-evidence:start -->
<details>
  <summary>REPLACE AREA NAME · Desktop</summary>

  ![REPLACE AREA NAME complete desktop viewport](PASTE_DESKTOP_IMAGE_URL)
</details>

<details>
  <summary>REPLACE AREA NAME · Mobile</summary>

  ![REPLACE AREA NAME complete mobile viewport](PASTE_MOBILE_IMAGE_URL)
</details>

<details>
  <summary>REPLACE AREA NAME · GIF</summary>

  ![REPLACE AREA NAME complete interaction](PASTE_GIF_URL)
</details>
<!-- visual-evidence:end -->

## Delivery

- [ ] Exactly one task branch and one pull request
- [ ] No temporary or evidence branches
- [ ] Platform evidence artifact linked
- [ ] PR title follows Conventional Commits
- [ ] Documentation/specification updated
- [ ] CI is green
