# Curated live-review assets

I made two ClearPath personal-loan ads and paired each with one intentional error: an unconditional approval headline, or a missing Homewise paid-ad label. The four unrelated images check whether the reviewer asks for usable financial creative instead of approving arbitrary uploads.

The eight original inputs and two final corrected images are in `Downloads/Relay Live AI Test Assets` on my demo machine; working evidence stays in the ignored `.capture/curated-validation/` directory. `manifest.json` records exact scope, expected outcomes, sources, dimensions, and SHA-256; `generation-prompts.json` preserves the selected prompts. The manifest records expectations. The original results below come from real calls to the deployed Claude/OpenAI backend through the local product UI on November 3, 2026 **under policy v3.1**; they are observations, not guaranteed future model outputs.

| Input | Observed initial result | What the reviewer found |
| --- | --- | --- |
| `01-personal-loan-clean.png` | Passed applicable checks | Visible loan qualifier; ordinary invitation to explore options. |
| `02-personal-loan-guarantee.png` | Blocked: claims rule | Replace “Guaranteed approval.” with “Make room for what’s next.” |
| `03-homewise-clean.png` | Passed applicable checks | Visible Homewise identity and “Paid advertisement by ClearPath Financial”. |
| `04-homewise-missing-paid-label.png` | Blocked: affiliate rule | Add that exact paid-ad label below Homewise. |
| `05-unrelated-game.jpg` | Unrelated; approval blocked | Request financial creative; game scores are not loan terms. |
| `06-unrelated-adult-portrait.jpg` | Unrelated; approval blocked | A standalone portrait supplies no financial advertisement. |
| `07-unrelated-receipt.jpg` | Unrelated; approval blocked | Receipt totals are not an advertised credit offer. |
| `08-unrelated-steak.jpg` | Unrelated; approval blocked | Natural food colors do not establish a brand-graphics violation. |

All four ads are 1024 × 1536 portrait images with readable product identity, CTA, and the qualifier: “Subject to credit approval. Rates and terms depend on your credit profile.” They contain no rates, APR, payment terms, numeric promises, or licensing representations. The direct pair uses US adult prospecting, Paid social, Instagram portrait feed, Other US jurisdiction, and no affiliate. The Homewise pair uses California adult prospecting, Affiliate partner, Homewise portrait feed, California, and Homewise. Under v3.1 its licensure-wording rule was not applicable because neither image claimed licensure. **Policy v3.2 replaces that rule with CP-CA-01: these earlier California assets now need the new company disclosure and another review.**

I visually inspected every selected asset and ran local OCR on the four ads. No text or control is cropped. The direct-loan footer has a 43 px detected bottom margin; its original bytes were preserved once live review began. Homewise text has at least 48 px detected margins. OCR is a curation aid, not the live compliance decision.

Both quick fixes completed the real path: prefilled feedback → OpenAI correction → Claude review of the generated pixels → reviewer pre-approval → Slack handoff → creative acceptance. The Homewise correction passed at v2. The loan's first correction introduced two typos and a poor disclosure margin; re-review blocked it, and v3 passed. Maya and Jordan accepted their respective exact versions in Slack, with responses returned to Alex. The original problems and intermediate correction feedback travel with the pre-approved asset.

The clean loan's approval reached Sofia. The game screenshot was returned with comments; an initial send hit the connection's rate limit, and checking the same request delivered it without a duplicate. Sofia acknowledged receipt, which leaves the asset unapproved. These are fictional demo decisions, with Charlie acting for the named owners.

All four unrelated images were rejected as non-advertising material. The existing correction action offered a scoped replacement concept; these four did not trigger image generation. A separate earlier Hacker News test exercised that generation path. The paired clean images illustrate target wording; they do not approve new generated pixels.

The ads were generated with the built-in imagegen tool, using no paid product-backend calls and no external portrait inputs. The downloaded images are unmodified and used only as unrelated-image tests:

| File | Source and credit | License |
| --- | --- | --- |
| `05-unrelated-game.jpg` | [SuperTux.jpg](https://commons.wikimedia.org/wiki/File:SuperTux.jpg), SuperTux Development Team. [Source project](https://github.com/SuperTux/supertux). | [GPL 2.0 or later](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |
| `06-unrelated-adult-portrait.jpg` | [Outdoors-man-portrait.jpg](https://commons.wikimedia.org/wiki/File:Outdoors-man-portrait.jpg), Abhi Puthenpurackal, via Good Free Photos / Wikimedia Commons. | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `07-unrelated-receipt.jpg` | [Chinese Swedish rounding.jpg](https://commons.wikimedia.org/wiki/File:Chinese_Swedish_rounding.jpg), Wikimedia Commons user Smyth. Existing source crop of supermarket totals/change. | Public domain; factual receipt text lacks original authorship, per source page. |
| `08-unrelated-steak.jpg` | [Steak (1).jpg](https://commons.wikimedia.org/wiki/File:Steak_(1).jpg), Renee Comet / National Cancer Institute, image 2668. | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/), released by its author. |

The receipt was visually checked for customer and payment details. The selected crop shows totals/change without a customer name, address, account/card number, voucher PIN, or payment credential. An earlier prepaid-voucher candidate was replaced before validation. The public stock portrait was not sent to image generation and implies no endorsement.

## California disclosure example · policy v3.2

The [downloadable example](../public/examples/california-missing-disclosure.jpg) reuses the clean personal-loan artwork above, exported from its existing browser-normalized JPEG (800 × 1200, 185 KB). It intentionally lacks the new CP-CA-01 sentence. This is generated demo creative, with no new source photograph or claimed endorsement.

Submit it with Personal loans, California adults, Paid social, Instagram portrait feed, California, and no affiliate. CP-CA-01 requires: “California residents: this promotion is subject to ClearPath’s California offer terms.” The expected correction adds that sentence while retaining the product qualifier. It is a fictional company policy, not statutory wording. The same image for Other US jurisdiction does not activate it. The guidelines page exposes the download and these steps; the three prepared beginner cases remain unchanged and make no paid calls.

On November 3 at 18:59 PST, the **deployed v3.2 app and live Claude** passed the brand, claims, and product checks, failed only CP-CA-01, and marked Homewise inapplicable. It supplied the exact missing sentence in both feedback and proposed disclosure. [Recorded review](../media/screenshots/california-live-review.png). The subsequent image request returned HTTP 429 at the existing public limit; no California image correction or re-review completed in this run. Mocked backend/browser tests cover the unchanged correction path, required prompt content, fresh re-review, and scope invalidation; they do not establish a live image outcome.

The later [five-image evaluator validation](evaluator-validation.md) records the expanded allowance, repeated v3.3 reviews, adversarial transcription/scope tests, and subsequent California image-generation attempts separately.
