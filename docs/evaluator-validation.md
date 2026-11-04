# Five evaluator examples

November 3, 2026 · deployed app · Claude Sonnet 5.5 · policy v3.3

The pack is in **Downloads/Relay Evaluator Examples** on my demo machine, with a ZIP beside it. `START_HERE.txt` gives the exact submission settings; `validation/results.json` contains 25 observed assessments without stored browser sessions or image payloads. The five originals are also in my private ChatGPT Library for forwarding from a phone.

These are new uploads through **All submissions**, not the prepared beginner walkthrough. Leave Creative copy blank initially: the model reads the image. Each image was reviewed twice with the pack's final settings.

| Image | Observed result in both runs |
| --- | --- |
| `01_clean_personal_loan.png` | All applicable checks passed; approval available. |
| `02_guaranteed_approval.png` | Visible guarantee failed the claims rule; correction available. |
| `03_homewise_missing_ad_label.png` | Homewise's missing paid-ad label failed the affiliate rule; correction available. |
| `04_california_missing_disclosure.jpg` | Missing CP-CA-01 sentence failed the California rule; correction available. |
| `05_unrelated_meal.jpg` | Rejected as unrelated; original cannot be approved. A responsible replacement concept may be offered. |

Another **15 live variations** checked accurate and partial transcription, the California image outside California, false guarantees added only to copy, visible guarantees omitted from copy, transcript-only affiliate/California disclosures, a meal with financial copy, prompt injection, invented APR, wrong product, unknown jurisdiction, inconsistent affiliate routing, contradictory California audience, and Homewise artwork submitted as direct marketing. All produced the expected clearance/blocking outcomes; the two contradictory-scope cases were also read manually. An extra preliminary meal run used inconsistent channel/placement metadata and is excluded from this 25-run matrix.

## What the tests changed

The first, pre-fix review acknowledged a false supplied guarantee but still cleared the clean image. Policy v3.3 now requires reconciliation of material transcript/artwork/use conflicts, explicitly attributes the evidence, and blocks correction while findings remain unresolved. Accurate, partial, and empty transcripts still work. The repeated counterexamples stayed blocked.

Adversarial review also found a new meal-inspired proposal saying “in minutes” without supporting facts. The reviewer prompt now forbids invented turnaround promises; a narrow server guard screens common timing phrases in new and previously saved proposals before generation. Mocked regression tests cover both generation modes. This guard supplements the model; it is not a complete language detector.

No invented transcript-only guarantee, APR, or missing disclosure was given a fake image rectangle in the inspected reports. Some rectangles covered only part of the quoted text: these remain approximate model locations requiring visual confirmation.

## California correction

Three generated attempts clipped the California sentence; all stayed blocked on re-review. Prompting alone did not resolve the cramped original footer. Disclosure and affiliate-label fixes now permit more layout change through low input fidelity, with a dedicated disclosure panel; small claim edits keep high fidelity. A fresh California submission then completed **review → correction → successful re-review**, with the full sentence visible and its original 800 × 1200 working dimensions preserved. This verifies one successful run with the revised setting, not a first-attempt guarantee for other images. No Slack acceptance was performed in this additional test.

The five selected images are unchanged from the curated assets in [the earlier validation notes](live-validation-assets.md); their hashes and source credits travel with the pack. CP-CA-01 is fictional company policy, not statutory wording. These results describe observed runs, not guaranteed future model outputs or a complete legal assessment.

## Current README recordings

Recorded on the deployed app on November 3, after the 25-run matrix. All clips show the current interface; raw recordings and browser sessions stay out of Git. Provider waits are shortened, and none of these four clips sends a live Slack message.

| Clip | What was recorded |
| --- | --- |
| [Upload and review](../media/videos/10-live-ai-review.gif) · 21s | New image-only submission as Maya, switch to Alex, a fresh Claude pass, numbered disclosure evidence, then approval. The handoff remains a labeled Slack preview. |
| [California correction](../media/videos/11-california-ai-correction.gif) · 13s | Reopens the earlier successful real correction: generated v2, full disclosure, and passed review. No new provider calls. |
| [Adversarial findings](../media/videos/12-adversarial-review.gif) · 19s | Reopens four real assessments: conflicting transcript, visible guarantee, missing Homewise label, and unrelated meal. Ends at the developer usage panel. No new AI calls. |
| [Generated clipping caught](../media/videos/13-generated-crop-blocked.gif) · 26s | A fresh California review, image generation, and re-review. This output clipped the disclosure again; it remains unapproved. |

The fresh clips add three Claude assessments and one OpenAI edit, separately from the 25-run matrix. The later clipping result shows why the successful earlier correction is not a guarantee that every generation will pass.
