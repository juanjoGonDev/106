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

## Frontend visual evidence

Every frontend area changed must include **three matching pieces of evidence**:

1. A complete Desktop viewport PNG.
2. A complete Mobile viewport PNG.
3. A GIF recording the full interaction from before the change appears until it finishes.

Evidence must be generated from the current PR head at native project resolution. Do not use element-only/locator screenshots, cropped images, compressed thumbnails, stale images from another PR, or images that omit surrounding page context. The GIF must preserve the whole viewport and must not crop the animated element.

Generate all evidence outside Git with:

```bash
pnpm preview:pr
```

This creates lossless PNG screenshots, full-viewport frame sequences and responsive GIFs in `.tmp/pr-previews/`. Attach the generated media to the PR or publish it on a dedicated `pr-evidence/<number>` branch. Do not commit generated evidence to the feature branch or `main`.

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

- [ ] Generated evidence is attached to the PR or published on `pr-evidence/<number>`, not tracked by the feature branch
- [ ] PR title follows Conventional Commits
- [ ] Documentation/specification updated
- [ ] CI is green
