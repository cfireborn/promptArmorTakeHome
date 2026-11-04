# Live AI review

The public app calls the existing Cloudflare Worker. No provider credential is included in GitHub Pages. Workspace state stays in the browser; D1 keeps the request ledger, received usage metrics, completed assessments, generated image responses, and Slack handoffs.

## Setup

Use Node 22+, the existing Worker/D1 setup in [SLACK.md](SLACK.md), and the public URL in `.env.example`. Slack configuration is optional for AI review.

Add these Worker secrets with `npx wrangler secret put NAME` from `backend/`:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `AI_RATE_LIMIT_SALT`: a random value of at least 32 characters, used to hash IPs for rate limiting.

Local Wrangler development reads the same names from ignored `backend/.dev.vars`. Keep one `NAME=value` assignment per line; never put keys in a `VITE_` variable.

For an existing database, apply `backend/migrations/0006_ai.sql`, then `0007_ai_usage.sql` (only apply migrations not already present); for a new database, use `backend/schema.sql`. Deploy with `npm run deploy --prefix backend`. `/v1/ai/health` reports feature availability without exposing keys. Defaults are `claude-sonnet-5-5` and `gpt-image-1.5`; server-side overrides must be in the model allowlists in `backend/ai.mjs`.

## What a request does

1. The client sends actual image pixels, supplied copy, and six intended-use fields: product, audience, channel, placement, jurisdiction, and affiliate partner.
2. Claude receives the versioned rules in [`shared/reviewPolicy.mjs`](../shared/reviewPolicy.mjs). Its structured result identifies evidence and suggested corrections, including optional normalized rectangles around visible text. The Worker checks the shape and coverage, determines approval eligibility, and attaches trusted source links.
3. **Prepare correction** sends the same reviewed image, the findings, and the selected product/use to OpenAI. If review found unrelated content, the prompt uses it only as visual inspiration for a new ClearPath ad. There is no separate creation path.
4. The result becomes a new unapproved version. Claude reviews its actual pixels before the reviewer can pre-approve it. Creative then accepts the exact version or requests changes. Returning comments supports an uploaded revision instead.

Missing metadata, unsupported policies, unreadable/irrelevant inputs, refusal, malformed responses, and unresolved findings block clearance. New numeric, certification, and common speed/turnaround claims are screened out of proposed copy; saved proposals are screened again before image generation. Existing claims still require the reviewer’s evidence assessment. These controls bound model behavior; they do not prove every judgment correct.

## Correction canvas

GPT Image 1.5 offers square, 2:3 portrait, and 3:2 landscape canvases. A quick correction selects the closest ratio to the **reviewed pixels**, ignoring conflicting placement keywords, and requests high input fidelity for small copy corrections. Failed disclosure or affiliate-label checks instead use low input fidelity and reserve a disclosure panel, allowing the artwork to reflow. This trades some layout similarity for readable required text. The browser then fits the entire generated bitmap onto the exact reviewed working canvas using one scale, no enlargement, and cream padding where needed. It never crops or stretches the result. New replacement concepts still follow their intended placement.

Intake stores a working copy capped at 1,200 pixels on its long edge and 300 KB, sometimes smaller for detailed images; it does not retain the original full-resolution file. Corrections keep that working copy's dimensions, trying JPEG quality 94–82 without shrinking to meet the same storage limit. Extreme aspect ratios are rejected before paying for an edit; undersized or badly shaped outputs that would occupy less than 60% of the canvas, or outputs too large to save at that quality, leave the original unchanged. The prompt reserves disclosure space before decorative content, permits layout reflow, and requests 6% text margins. The model can still alter or omit content, so review checks the final fitted pixels and their legibility before pre-approval. These are review assets, not guaranteed print-resolution masters. [Supported image settings](https://developers.openai.com/api/docs/guides/image-prompting).

## Public spending limits

Before each provider call, D1 reserves **25¢ per review** or **$2 per image request** against the default **$20 demo cap**, shared by development and public requests. Running calls and calls without usable usage keep their full reserve. Once a call finishes, including a failed result with recorded usage, its protected amount becomes **2× its saved list-price estimate, rounded up to whole cents per call**. Unknown older calls and uncertain failures are never estimated or released.

A single conditional INSERT checks the global and active provider protected totals plus the new reserve, rolling rate windows, and concurrency before allowing a call. Health and usage use the same calculation. The original reservation ledger stays intact and may eventually exceed $20; the protected total determines availability. These are conservative demo accounting controls, not measured provider bills.

For the evaluator window, `AI_DEMO_RATE_BOOST_UNTIL=2026-11-04T15:10:00Z` raises per-IP limits to **10 reviews/minute, 60/hour, 240 per rolling 24 hours**, and **2 image requests/minute, 10/hour, 40 per rolling 24 hours**. These rates expire November 4 at 7:10 AM Pacific. Separately, `AI_DEMO_BOOST_UNTIL=2026-11-05T03:10:00Z` permits **$15 protected per provider, $30 combined**, until November 4 at 7:10 PM Pacific. Historical costs/reserves count toward these ceilings; neither expiry resets the ledger. Each window is evaluated on every request, so no scheduled cleanup is needed. All calls using these API keys elsewhere remain outside this demo ledger.

After the rate window: 10 reviews/minute, 40 reviews/day, and 6 image requests/day. After the budget window: the original $20 combined cap applies, so already-spent protection may leave less room or stop new calls. At most 3 paid requests run concurrently across the demo. Requests have size/token/model/output limits, one image output, and no automatic paid retries. Reusing a request ID retrieves its existing attempt; a transport-uncertain browser retry retains that ID. An explicit new attempt can use another reservation.

Do not delete ledger rows to restore budget: that would lose lifetime accounting. Calls made directly to either provider are outside this ledger. The public allowance can be consumed by visitors; the separate [prepared walkthrough](https://cfireborn.github.io/marketingreview/?prepared) remains available without provider calls.

## Evidence and usage

Numbered red rectangles connect model-located wording to each finding, including valid disclosures and failing claims. The preview verifies the exact raster sent for review, so responsive template reflow cannot move the boxes; unavailable pixels hide the locations. The Worker keeps at most three normalized rectangles per check, requires positive dimensions within the image and a quote present in the finding's evidence, and drops invalid regions. Missing or unreadable text gets no location. These are model estimates of visible wording and location, not independent OCR verification. Editing the version or scope hides stale evidence.

The collapsed **Developer / demo review** section fetches `/v1/ai/usage` when opened or refreshed. It shows provider/model estimates from recorded token counts and published list prices, tracked and untracked call counts, and protected budget. The API retains the original reservation total separately. Earlier calls and timeouts without usable usage are excluded from estimated spend but retain their full budget holds. Usable metrics are saved before validating a received review or generated image, so malformed outputs can still be counted. The endpoint exposes aggregate demo figures, not account-wide spend, remaining provider credit, or individual job data.

Pricing references: [Claude](https://platform.claude.com/docs/en/about-claude/pricing), [GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5).

## Policy and privacy

The guidelines distinguish company policy, the fictional Homewise contract, and linked federal references. Since policy v3.2, California activates CP-CA-01 for all three supported products: the artwork must visibly say “California residents: this promotion is subject to ClearPath’s California offer terms.” This is fictional company policy, not statutory wording. Other US jurisdiction makes this rule inapplicable; unspecified jurisdiction blocks clearance. Homewise activates its example placement requirement. Changing the policy version invalidates older assessments. The guidelines page has a downloadable missing-disclosure example for the normal review/correction path.

Policy v3.3 also compares supplied transcription and recorded use with the artwork. Material contradictions require corrected inputs; actual visible violations still fail. An unresolved `needs-review` finding blocks image correction even if another rule has a repairable failure. Empty transcripts, harmless formatting differences, and noncontradictory partial copy remain valid.

Company use would require company-hosted models or providers approved for its privacy, retention, data-handling, and AI-use requirements. Live assessment sends images to Anthropic; requested image corrections send them to OpenAI. Optional Tesseract OCR runs locally.

API references: [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), [structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [OpenAI image edits](https://developers.openai.com/api/reference/resources/images/methods/edit), [GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5).
