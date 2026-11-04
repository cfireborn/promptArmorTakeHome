# Deployment

Source: [cfireborn/promptArmorTakeHome](https://github.com/cfireborn/promptArmorTakeHome), branch `main`.
Site: [cfireborn.github.io/marketingreview](https://cfireborn.github.io/marketingreview/).

Vite uses relative asset paths (`base: './'`), so the static build works in the hosting subdirectory. Workspace data stays in the browser. The prepared walkthrough needs no provider calls; live review and image correction use the configured Worker. See [AI setup](AI.md) and [Slack setup](SLACK.md).

## Publish the final product

Copy `.env.example` to `.env.local` for the public backend URL, run the checks, and build:

```sh
npm ci
npm test
npm test --prefix backend
node --test shared/reviewPolicy.test.mjs
npm run build
git push origin main
node scripts/deploy.mjs dist "$(git rev-parse HEAD)" --dry-run
node scripts/deploy.mjs dist "$(git rev-parse HEAD)"
```

The script requires working GitHub SSH authentication. Each run clones the current hosting `master` into a fresh temporary directory and replaces only `marketingreview/`. It checks every staged path before committing and pushing, and records the release repository and source commit in `marketingreview/release.json`. The dry run stages files for inspection without committing or pushing. Failed pushes retain the temporary checkout; rerun rather than forcing an update.

The hosting repository's Pages workflow publishes on `master` pushes. After it succeeds, open the live URL, check that `release.json` matches the intended release commit, and exercise the workflow in the browser. A successful local build or Git push alone is not deployment verification. Backend changes have their own deployment and migrations, described in [AI setup](AI.md).

## Recorded development verification

The [README](../README.md#technology-and-setup) records automated coverage. Frontend, backend, policy, and browser tests exercise exact-version decisions, image binding, generated corrections, stale requests, owner handoffs, and request limits. Provider and Slack calls in automated tests are mocked; these checks do not establish live provider behavior. [Live validation notes](live-validation-assets.md) record the separate paid runs and their limitations.

Separate deployed runs verified real Slack delivery, creative acceptance, incoming feedback, and receipt-only acknowledgment. The clean card received an exact-version approval notice. The corrected loan's acceptance approved only its proposed version. The mortgage revision was acknowledged while remaining unapproved with state and affiliate evidence unresolved. Later runs checked fresh image submissions, separate owner channels, and reviewer return notifications.

### Mobile adversarial review, November 2

Chromium checks covered the three prepared outcomes and workspace paths at 320×568, 390×844, and 844×390. WebKit checks covered the outcomes, guidelines navigation, and exported creative at 390×844. Review fixed clipped artwork, offscreen controls, focus loss, unexpected scroll positions, and blank raster exports. These are browser emulations; the iPhone screenshots show real Slack messages.

The AI follow-up adds live-workspace layout and canvas-preservation checks. Local OCR remains optional; extracted text needs comparison with the artwork. Live AI sends the reviewed image to the configured provider.

## Demo recordings

The historical walkthrough GIFs and linked overview video show the earlier prepared workflow and real Slack interactions. The current AI clips show fresh provider calls and reopened real results, as labeled in their captions. The development GIFs remain accurate recordings of their respective stages.
