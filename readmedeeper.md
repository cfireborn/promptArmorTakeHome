# Relay — More on the Build

[![Watch Relay's product overview and live Slack demo on YouTube](https://i.ytimg.com/vi/hIxid1N2fyI/sddefault.jpg)](https://youtu.be/hIxid1N2fyI)

[**Watch the original product overview and live Slack demo →**](https://youtu.be/hIxid1N2fyI) · 6:15

[Back to the README and live demos](README.md)

The shorter README shows what the product does and how it changed. This keeps the reasoning, implementation details, and development notes that were useful but made that first read too long.

## Why this handoff

ClearPath is a fictional consumer finance company reviewing marketing for personal loans, credit cards, and mortgage prequalification. The brief names Excel and email as the existing process and asks for higher throughput. It does not tell us which step consumes the most time.

My starting hypothesis came from working on creative teams: documenting a fix, handing it back, and getting it into someone else's queue can take longer than making the fix. If compliance already knows the acceptable wording, another comment thread creates work for creative. Relay lets the reviewer offer a concrete version that creative can accept.

That is where the name comes from. Every submission should have a clear next move and someone responsible for it.

**Vikram confirmed:** an approval covers the exact version and its product, audience, channel, and placement. Changing the content or intended use requires review.

**Vikram left open:** the main bottleneck and target user. Missing context and annotations are also fair game; the objective is throughput. Choosing the compliance reviewer and focusing on waiting are my product bets, not confirmed customer findings.

The two original user stories still explain the product:

- As a reviewer, I want to correct copy or prepare an image adjustment during review, so I can send creative a concrete, pre-approved change.
- As a creative owner, I want to accept that adjustment or give useful feedback in Slack, so we can finish without another email thread.

The larger-revision path puts a boundary around those stories. Reviewers should not become the creative team. When a correction needs new evidence or substantial creative work, return it with useful instructions and clear ownership.

## What the workflow preserves

The guided demo goes from clean approval to a small fix to a larger revision. The beginner guide uses prepared results without paid AI; the submissions workspace uses live AI. `?prepared` also preserves the original deterministic workspace for historical regression checks. Each stage introduces one primary next action and shows the outgoing Slack message, plus acceptance or acknowledgment when required. The full workspace adds submissions, status and ownership, filters, launch-date sorting, manual edits, version-anchored comments, comparison, history, and CSV export of the filtered queue.

**Viewing as** switches between Alex Morgan’s compliance workspace and the creative workspaces of Sofia Patel, Maya Chen, and Jordan Lee. Creative sees their own submissions and can accept a proposal, give feedback, or resubmit returned work. With live Slack connected, its buttons remain the source of the creative response. These are demo personas sharing one browser, not authenticated accounts.

Three details matter more than the number of controls:

1. **Acceptance applies to the proposal, not the campaign forever.** Accepting an unchanged pre-approved version completes its approval. A counter-edit creates a new version for review. Changing an approved asset or its intended use withdraws its current approval while preserving earlier versions and decisions.
2. **Sent, received, and approved are different events.** An approval notice informs marketing. A proposed correction asks for acceptance or feedback. A revision request asks only for acknowledgment. Receiving the last message never approves the asset.
3. **The context travels with the decision.** Slack receives the creative, full copy, intended use, rationale, and owner. Creative can understand the proposed change without reconstructing the email thread.

## Technology choices

| Choice | Why I used it |
| --- | --- |
| React + TypeScript | Enough structure for explicit review states and interactive previews without a large application framework. |
| Vite + plain CSS | Quick iteration and a small static build; visual and interaction details stay easy to adjust. |
| Browser storage + GitHub Pages | A free public walkthrough with no account setup. Relative asset paths allow hosting under `/marketingreview/`. |
| Cloudflare Worker + D1 | Keeps provider keys off the browser, records AI requests and budget reservations, and stores optional Slack handoffs and decisions. |
| Claude Sonnet 5.5 + OpenAI GPT Image 1.5 | Multimodal assessment and proposed copy, followed by requested image corrections. Generated pixels require a new assessment. |
| Tesseract.js | English OCR in a lazily loaded browser worker; no paid API or image upload to an OCR service. |
| Vitest + Node test runner + Playwright | Exercise domain rules, Worker/provider boundaries and policy selection, then the workflow through browser controls. |

Icons use Lucide; DM Sans and Manrope are bundled locally. The prepared walkthrough requires no paid inference; live review and image generation use the configured server-side providers. Local setup and test commands are in the [README](README.md#technology-and-setup); the live connection has its own [Slack setup](docs/SLACK.md).

### A few implementation details worth opening

| File | What it owns |
| --- | --- |
| [`src/domain.ts`](src/domain.ts) | The review rules. `saveDraft`, `preapprove`, `acceptProposal`, `counterEdit`, and `returnForRevision` return updated submissions while preserving version and event history. |
| [`src/checker.ts`](src/checker.ts) | The original v2 five-spec report, editable feedback, and prepared generation request. `requireCurrentReport` rejects a report if the current content, use, evidence, or policy results no longer match. |
| [`src/generation.ts`](src/generation.ts) | In prepared mode, `generateSuggestedFix` asynchronously replays one of two outputs while retaining the actual source and reviewed feedback in the prompt. |
| [`shared/reviewPolicy.mjs`](shared/reviewPolicy.mjs) | Live v3 rule definitions, source links, and deterministic product/jurisdiction/partner applicability shared by browser and Worker. |
| [`backend/ai.mjs`](backend/ai.mjs) | Validates images and provider output, calls Claude/OpenAI, binds findings to the submitted snapshot, and reserves budget before paid requests. |
| [`src/ai.ts`](src/ai.ts), [`LiveReviewWorkspace`](src/components/LiveReviewWorkspace.tsx) | Run the live assessment, preserve its findings, request corrected artwork, and invalidate results after content or scope changes. |
| [`CreativeWorkspace`](src/components/CreativeWorkspace.tsx), [`PersonaSwitcher`](src/components/PersonaSwitcher.tsx) | Make the four demo identities and creative’s response/resubmission work visible. |
| [`src/components/GuidedReview.tsx`](src/components/GuidedReview.tsx) | The three-case walkthrough, progressive actions, comparison, and decision trail. [`src/App.tsx`](src/App.tsx) owns the full workspace and browser persistence. |
| [`src/slack.ts`](src/slack.ts) | The browser connection, send/retry/poll cycle, and exact-snapshot checks before a Slack decision can update the submission. |
| [`backend/worker.mjs`](backend/worker.mjs) | Private sessions, trusted owner routing, Slack messages and signed interactions, persisted decisions, and retirement of superseded buttons. |
| [`src/intake.ts`](src/intake.ts), [`src/ocr.ts`](src/ocr.ts), [`NewSubmission`](src/components/NewSubmission.tsx) | Preserve combined copy and run cancellable local OCR without overwriting newer edits. |
| [`src/demoAssets.ts`](src/demoAssets.ts) | Recognizes the three supplied demo PNGs by original-byte digest and matching copy/use. Only those exact registrations inherit sample evidence and prepared replacements. |
| [`src/uploads.ts`](src/uploads.ts) | Validates PNG/JPEG input, makes a bounded browser-local copy, and binds its bytes to a SHA-256 reference. Missing images prevent approval and rendered Slack export; transcription edits cannot silently replace the artwork. |
| [`src/renderAsset.tsx`](src/renderAsset.tsx) | Exports decoded raster images directly through canvas, preserving their proportions; HTML templates use the shared `Asset` renderer and html-to-image. Both paths check dimensions, size, and apparently blank output. |

The original v2 checker uses a canonical fingerprint containing the submission/version, content, intended use, review evidence, and policy-pack identifier. The fingerprint is a source comparison, not a security boundary. A stale report cannot clear a newer version just because the title looks the same.

The Slack bridge independently compares the returned asset snapshot with the current version and scope. Reusing a client request ID makes retries inspect the existing send instead of creating a duplicate message. Editing a pending proposal retires its Slack buttons; snapshot checks still protect the browser if that Slack update fails. The first valid decision is saved, and later clicks cannot overwrite it. A signed response from the assigned recipient can reconcile a proposal whose delivery timed out; repeated valid clicks can retry a failed Slack card refresh without changing that decision. Slack sometimes explicitly rejected an image download during recording. That narrow rejection now gets one retry with the same payload; uncertain requests are never automatically resent.

The private presenter code is exchanged for a temporary browser capability. Credentials stay in Worker secret storage and ignored local files. The bot has only `chat:write`, routes fictional owners to Charlie explicitly, and accepts actions only from the assigned demo member. Trusted maps choose each person’s channel; the saved destination stays attached to the handoff even if the map changes. Acceptance, feedback, and acknowledgment can send a separate update to the configured reviewer. An atomic claim prevents duplicate return messages; a delivery failure does not undo the decision. These are demo controls, not a production employee identity system. The [Slack contract](docs/SLACK.md#frontend-contract) contains the API and failure behavior.

## What live review does

The original submission used deterministic checks to test the handoff quickly. Vikram then asked why there was no AI assessment, tried an unfamiliar upload, and found the next steps unclear. That was useful evidence: a polished sample path was not enough. The follow-up adds a real reviewer while preserving the exact-version handoff.

1. **Create.** A creative owner supplies a PNG/JPEG and intended use. Copy is optional for an image: Claude reads its pixels. Tesseract OCR remains optional; local OCR itself does not send the image to a service. TXT import was removed once live multimodal review supported image-only intake.
2. **Select rules.** The Worker chooses applicability from explicit metadata using [`applicableRules`](shared/reviewPolicy.mjs). Missing routing information stays unresolved. The model cannot supply new rule IDs or source URLs.
3. **Review.** Claude Sonnet 5.5 receives the actual image, scope, supplied transcription, and bounded policy instructions. Structured output contains one result per rule, visible evidence, rationale, suggested feedback, and optional replacement copy. The Worker validates the response and attaches its own source links. Unreadable, unrelated, or mismatched creative cannot be approved merely because the supplied text looks acceptable.
4. **Decide or correct.** The reviewer can approve clean work, return comments, or request an OpenAI GPT Image 1.5 correction. An irrelevant upload can instead inspire a clearly new financial-ad concept; it does not become an approved original. Generation requires known scope and an explicit request.
5. **Review the result.** A generated image becomes a new version with provenance. Its actual pixels must be checked again before pre-approval. Creative can then accept the exact proposal or request changes; returned submissions can be revised and resubmitted.

### Five bounded, traceable requirements

| Requirement | Authority and scope |
| --- | --- |
| Brand palette and presentation | ClearPath company policy. Inspect brand graphics, legibility, unclipped content, and placement orientation; photography can contain other colors. |
| Claims and approval language | ClearPath’s no-unconditional-guarantee policy, with FTC substantiation guidance and a mortgage-specific reference to 12 CFR 1014.3(q). |
| Product disclosure | Company qualifying language is separate from Regulation Z’s conditional advertising-disclosure requirements. Missing financial terms cannot be invented. |
| California offer disclosure | Selecting **California** activates fictional company policy **CP-CA-01** for every supported product. Require “California residents: this promotion is subject to ClearPath’s California offer terms.” on the artwork. This is company policy, not California law; other jurisdictions are N/A. |
| Homewise advertising label | Selecting **Homewise** activates fictional contract HW-01: identify the publisher and clearly label ClearPath’s paid advertisement. FTC endorsement guidance is background, not the source of the contract. |

The [guidelines page](https://cfireborn.github.io/marketingreview/?guidelines) and each result link to the relevant policy or official reference. Other partners need their own requirements; choosing an unspecified jurisdiction cannot silently clear it. This is a deliberately small rule pack, not an exhaustive state-law or Regulation Z implementation. A valid schema and citation do not establish that the model’s interpretation is correct.

### Evidence, conflicting inputs, and correction dimensions

Numbered red rectangles connect a finding to wording in the actual reviewed image, whether that wording passes or fails a rule. Each location is a model estimate, not independently verified OCR. The Worker validates normalized bounds and their quoted evidence; missing text has no location. Changing the version or scope hides stale evidence, and the preview uses the exact reviewed raster so a responsive layout cannot move the boxes.

The evaluator tests found that a clean image could clear despite an unconditional approval guarantee supplied only in its transcript. Policy v3.3 now requires material image/copy/scope conflicts to be reconciled, with evidence attributed to its source. A relevant asset with unresolved findings cannot jump into image correction. Empty, accurate, or noncontradictory partial copy still works. Provider results and proposed copy remain untrusted: narrow guards also screen new financial, identity, and timing claims.

Quick corrections choose the nearest supported provider canvas, then fit the whole result onto the reviewed working dimensions without cropping, stretching, or enlargement. Small copy edits request high input fidelity. Disclosure and affiliate-label fixes permit more rearrangement and reserve a readable disclosure panel: three California generations clipped the sentence before that change. A successful corrected image retained its 800 × 1200 working dimensions and passed a fresh review. A later recording clipped the sentence again and stayed blocked; the setting improves layout freedom, not output certainty. Intake's working copy is capped at 1,200 pixels on its long edge; it is not the original full-resolution master. [Canvas limits and provider settings](docs/AI.md#correction-canvas).

### Cost, privacy, and failure behavior

The Worker protects a durable **$20 baseline demo budget**, with a separately expiring evaluator window of **$15 per provider / $30 combined** ([rates and expiry](docs/AI.md#public-spending-limits)), reserving **25¢ for a review** and **$2 for an image request** before calling a provider. Baseline per IP: 10 reviews/minute, 40 reviews/day, and 6 image requests/day; the evaluator window increases daily/hourly capacity while retaining burst caps. Globally, at most 3 requests run concurrently. The reservation uses a single conditional database insert, so concurrent Workers cannot independently spend the same remaining allowance. These amounts are conservative holds, not provider bills. Finished calls with priced usage count at twice the estimate, rounded up per call; in-flight and unpriced calls retain their full holds, including timeouts. The original reservation ledger is preserved. The collapsed developer panel separates measured estimates from this protected budget; it cannot show account-wide charges or direct calls made elsewhere.

Request IDs make repeated requests inspect the same stored attempt. A transport-uncertain retry retains its ID; there are no automatic paid retries. Reviews bind the submission/version, content, scope, policy version, and a hash of the image actually sent. Image generation must match a completed current assessment, and its result always requires review. Unknown scope, malformed output, refusal, or truncation never clears the asset. Guards also reject proposed numeric statements that change financial meaning and newly introduced licensure/certification claims; these checks supplement the model rather than proving factual accuracy.

The browser stores the queue and original upload copies. **Live review sends creative to Anthropic**, and requested image edits send it to OpenAI. D1 stores completed reports and generated images so an interrupted request can retrieve its result. Worker keys never enter the static bundle. Connected Slack handoffs send a rendered copy to Slack as before.

Real company assets would require company-hosted image-generation models or a provider/API approved under the company's privacy, data-handling, and AI-use policies. Provider choice would need to cover retention, training use, access controls, and any residency requirements before creative is sent for generation.

<details>
<summary>Historical v2 checker and prepared examples</summary>

The following describes the original submission and the still-available `?prepared` path, not live inference:

The checklist turns the imagined Excel columns into five inspectable results: brand palette, claims, product disclosure, state-review evidence, and affiliate identity/placement. Each result has evidence and, when appropriate, an editable suggested fix. A result can pass, fail, need review, or be inapplicable. Unknown coverage blocks auto-clear.

A fresh submission of a supplied demo PNG can reproduce these outcomes. Its original-byte digest, submitted copy, and intended use must match the registered example; filenames and similar-looking images do not qualify. Changing the scope or creative invalidates that coverage. Arbitrary uploads still require visual and policy review.

The rules are deliberately limited. Brand checks use declared template metadata, not image pixels. Claim checks recognize the prepared copy and a few problematic phrases; absence of a flagged phrase is not enough to clear unfamiliar copy. Numeric terms require expanded review. State and affiliate checks require evidence matching the recorded use; a partner's display name alone is insufficient.

The policy pack distinguishes fictional company requirements from linked federal references. Its wording, palette, and evidence requirements are illustrative. It is not a general legal clearance engine, a complete Regulation Z assessment, or an implementation of every state's rules.

Submitting failed checks preserves the original asset, failed specs, intended use, and reviewer comments in the generation request. There are exactly two prepared examples:

- **Loan copy:** remove the unconditional approval promise and supply qualified wording.
- **Mortgage image:** preserve the house, remove the guarantee, change the palette, and give the qualification its own readable panel. This before/after image pair was actually generated and edited during development. [Prompts and provenance](public/creative/provenance.json).

Runtime generation replays those outputs asynchronously. It preserves custom feedback but does not claim a live model interpreted it. The mortgage's missing state/affiliate evidence stays unresolved after its visual correction. A production generation provider would consume the recorded request, then have its output checked again.

</details>

## Development notes behind the phases

The [main README](README.md#development-progress) keeps the actual early recordings visible. I used AI for implementation and parallel adversarial reviews, with the product assumptions above setting the direction.

The earlier [/promptarmor prototype](https://cfireborn.github.io/promptarmor/) ([source](https://github.com/cfireborn/promptarmor-first-draft-not-final)) focused on complete submissions and checking returned revisions. I treated it as a dead end for my preferred handoff, then refined the prompt around waiting and a concrete adjustment creative could accept. I spent about **10 minutes writing the earlier prototype’s prompt**. Its agent session ran **24m 04s**, November 1, 17:42:29–18:06:33 Pacific, including verification and deployment. Those are separate human and elapsed-agent figures.

The first working Relay draft already had the queue, editing, comparison, and simulated handoff. The next passes established the workspace hierarchy and warmer creative previews, protected drafts, and made the proposed version, use, and rationale easier to read together. The mortgage example made disclosure presentation part of the actual creative rather than a detached warning.

Connecting real Slack made the handoff testable outside the app. The recipient saw the rendered creative and could respond there; Relay polled the saved result back into the submission's history. The following morning, the guided checklist organized the experience around three increasingly demanding decisions instead of opening with the full queue.

Adversarial review was useful when it produced a specific failure to fix. A comment-field choice could crash the editor. Scope changes could leave stale approval. Sidebar navigation could discard an unsaved draft. Later reviews exposed hidden incoming creative feedback, restart state that survived a reset, confusing event numbering, and a hover loop under reduced motion.

The mobile pass caught issues that a desktop screenshot hid: tall creative was clipped above its scrollable area; navigation could land halfway down the next screen; controls and form text were too small. Unicode arrows also became disruptive emoji on phones, so they became SVGs. WebKit testing then found rounded corners missing from exported Slack previews. Filtering its incompatible `corner-*` style serialization preserved the artwork in the PNG.

The final polishing pass extended the handoff into separate private channels for Sofia, Maya, and Jordan, with acceptance, feedback, and acknowledgment sent back to Alex’s compliance channel. Charlie still acts for every fictional person. This makes each role's inbox easier to follow during a live presentation without pretending there are four real user accounts. The earlier video remains unchanged and shows the original shared channel. A final WebKit pass caught uploaded images that displayed correctly but exported blank to Slack. Raster export now draws the decoded image directly to canvas and preserves its natural proportions; HTML templates keep their existing exporter.

Fresh-submission review exposed another gap: the walkthrough worked, but uploading the same supplied examples did not reproduce its clean and quick-fix outcomes. The correction recognizes the original sample bytes only when submitted copy and intended use also match. It preserves arbitrary-upload review requirements, the original image, and unresolved mortgage evidence. [Implementation details](src/demoAssets.ts) and [channel setup](docs/SLACK.md).

### November 3 follow-up: live review

The new work responds directly to Vikram’s questions: real image assessment, identifiable policy sources, clear user switching, and a usable path after an unfamiliar upload. An unrelated screenshot now stays rejected but can lead to a new, scoped financial concept. The same interaction prepares ordinary corrections; both create new pixels that must be reviewed.

The review also caught two subtle problems before release: a proposed number could keep its digits while acquiring a different financial meaning, and a provider failure message could imply that a new paid attempt was free. The implementation now treats numeric statements conservatively and distinguishes reusing an uncertain request from starting another attempt. Mocked tests cover the boundaries; live provider and deployment checks are separate evidence.

This follow-up is outside the original submission’s time estimate. The historical table below remains a record of the first delivery rather than retroactively counting this work into it.

### Phase 8: Five evaluator images and adversarial review

The [current README clips](README.md#live-demo) show a fresh upload and live review, an earlier successful California correction reopened in the current UI, and saved findings from adversarial uploads. Phase 8 adds a fresh generated correction whose clipped disclosure was blocked on re-review. Captions distinguish new calls from reopened results. The original prepared/Slack recordings remain available there separately, and Phases 1–6 retain the rough early versions.

I curated five distinct inputs: a clean loan ad, a visible guarantee, missing Homewise labeling, missing California disclosure, and an unrelated meal. Each was assessed twice with its final settings. Fifteen more variations challenged transcription, policy instructions, financial terms, product choice, and jurisdiction/affiliate routing. The **25 observations** matched their expected approval/blocking outcomes after the fixes; that is a finite test record, not a promise of flawless future model outputs. [Exact cases, earlier failures, and limitations](docs/evaluator-validation.md).

The testing also needed a practical demo allowance. I kept cost estimates in the collapsed developer panel and added separate rate/budget expiry times, per-provider ceilings, burst limits, and a shared concurrency limit. Historical reservations stay in the ledger. This lets the evaluator try unfamiliar work without making a temporary higher allowance permanent or implying that the app can read account-wide provider bills.

### Recorded time and effort windows

I reconstructed the estimate from the main Relay development chat, the earlier prototype chat, the short README follow-ups, and the release-preparation chat. Start/end intervals are merged so overlapping chats and parallel agents are counted once. Overnight and gaps between requests are excluded, while waits inside an active run remain included. The recorded **10-minute first-prompt estimate** is added separately; other time spent composing prompts or reviewing between messages is not fully logged.

The completed sessions through the submission cleanup total approximately **4h 25m**. Adding the original prompt-writing estimate gives **4h 35m** before this documentation pass. The morning work contributes about **1h 44m**, including work before the first guided-flow commit; the afternoon implementation/refinement sessions contribute about **1h 23m**. The rounded breakdown in the README also includes final repository preparation and this update. These are estimates of active project sessions, not measured individual labor or summed agent-hours.

My optimistic estimate for the original submission, including the abandoned draft and final delivery: **a little under 5 hours.**

## Verification and limits

The original submission’s recorded local verification reached **105 unit tests, 39 Chromium workflow tests, and 28 backend tests**. The tests cover exact-version approval, scope edits, stale decisions, preserved feedback, isolated resets, CSV handling, keyboard/draft behavior, signatures, trusted recipients, and idempotent delivery. Backend tests use in-memory SQLite and mocked Slack HTTP responses.

Separate deployed runs verified actual Slack delivery, acceptance, required feedback, and acknowledgment without approval. The three historical prepared-workflow GIFs record the deployed happy path, quick correction, and larger revision with real Slack responses. The last outcome leaves the mortgage unapproved with two evidence gaps open. A later live lap submitted all three PNG/TXT pairs as new work for Sofia, Maya, and Jordan, then confirmed owner-channel delivery, Maya’s acceptance, Jordan’s receipt-only acknowledgment, and both return updates to Alex. The Phase 6 GIF records that fresh-submission lap; the prepared walkthrough GIFs and narrated video retain their earlier shared-channel runs. The newer live-AI clips are labeled separately so a saved assessment, fresh provider call, and prepared result are not confused.

The mobile lap repeated all three preview outcomes and essential workspace paths at 320×568, 390×844, and 844×390 in Chromium. WebKit repeated the three outcomes and creative PNG export at 390×844. These are browser emulations, not physical-device usability tests; the supplied iPhone screenshots show the real Slack messages. Recorded verification details are in [deployment notes](docs/DEPLOYMENT.md).

The live-AI revision adds mocked provider tests for source binding, malformed or refused responses, irrelevant uploads, numeric/identity invention, exact-image generation, stale requests, repeat clicks, and atomic budget limits. Shared-policy tests cover California and partner applicability, including missing or inconsistent metadata. These automated checks run without sending creative to paid providers; they do not substitute for a deployed end-to-end run.

The public workspace remains browser-local. **Viewing as** is not authentication, and another browser does not share its queue. PNG/JPEG uploads are resized and bound to a version with a content hash. Local OCR is optional; live assessment now inspects pixels remotely, and requested image generation creates a reviewable replacement. There is no direct pixel editor. Production still needs shared authoritative records, team identity, maintained policies, and durable delivery/reconciliation. Neither version has measured a productivity gain.

## The Innovator's Dilemma and the next validation

I used [Christensen's framework](https://www.christenseninstitute.org/theory/disruptive-innovation/) as a constraint on scope. Rational requests from existing customers can pull a product toward more features and larger contracts, while simpler needs remain poorly served. For this build, the useful question was whether one short handoff could earn adoption before a broad compliance platform did.

Slack, a short explicit checklist, and one visible next action lower the effort to try that handoff. Excel and email alone do not establish a disruptive market or an underserved customer. I would still test why teams have not adopted alternatives, who pays, and whether reviewer effort falls alongside elapsed waiting time.

For B2B, I would distinguish the person using the product from the person buying it. The reviewer needs less chasing and rework; the buyer needs more completed approvals without losing control of what was approved. A good-looking queue is not evidence of either result. The AI follow-up should earn its place by reducing reviewer effort on unfamiliar work, not by adding a model call to the feature list.

My next measurements would be completed approvals, elapsed approval time, reviewer minutes per asset, percentage of corrections accepted unchanged, and repeat rounds. I would compare clean work, small fixes, and larger revisions separately so faster easy cases cannot hide a growing queue of difficult ones.

The misleading problem was “how do we leave better comments?” A clearer comment can leave the same person waiting on the same handoff. A concrete pre-approved correction changes the next person's job from interpreting a request to deciding whether it works.

That can make a second compliance review unnecessary when creative accepts unchanged. Keeping content, intended use, and rationale together also answers creative's questions while preserving the decision. But if reviewers spend their day doing everyone else's creative work, the product has moved the bottleneck. The return-for-revision path is part of the product judgment, not an unfinished automation.
