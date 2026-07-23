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

Frontend changes must include one **Desktop** and one **Mobile** screenshot for every affected area. Add another matched pair when several pages or states changed. Dynamic behavior may also include a GIF, but the GIF does not replace the required screenshots.

Generate evidence outside Git with:

```bash
pnpm preview:pr
pnpm preview:pr:gif # also creates the configured animation GIF
```

Attach the generated files from `.tmp/pr-previews/` to this PR. Do not commit them.

<!-- visual-evidence:start -->
<details>
  <summary>REPLACE AREA NAME · Desktop</summary>

  ![REPLACE AREA NAME desktop](PASTE_DESKTOP_IMAGE_URL)
</details>

<details>
  <summary>REPLACE AREA NAME · Mobile</summary>

  ![REPLACE AREA NAME mobile](PASTE_MOBILE_IMAGE_URL)
</details>

<details>
  <summary>Optional dynamic behavior · GIF</summary>

  ![Optional dynamic behavior](PASTE_GIF_URL)
</details>
<!-- visual-evidence:end -->

## Delivery

- [ ] No generated screenshots, videos, or GIFs are tracked by Git
- [ ] PR title follows Conventional Commits
- [ ] Documentation/specification updated
- [ ] CI is green
