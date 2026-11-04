# Real Slack demo

The public prototype works without a connection. The private presenter connection sends adjustments, approval notices, and revision requests to the marketing owner's channel in Charlie + Assistants. Acceptance, feedback, and acknowledgment send a separate update back to the compliance reviewer. A Cloudflare Worker + D1 stores the result; Relay polls it. Public preview mode sends no real messages.

| Simulated person | Role | Private Slack channel |
| --- | --- | --- |
| Sofia Patel | Marketing | [#relay-sofia-patel-marketing](https://charlie-assistants.slack.com/archives/C0CEC8VKLE5) |
| Maya Chen | Marketing | [#relay-maya-chen-marketing](https://charlie-assistants.slack.com/archives/C0CE5480NQ5) |
| Jordan Lee | Marketing | [#relay-jordan-lee-marketing](https://charlie-assistants.slack.com/archives/C0CF4PZ2KFA) |
| Alex Morgan | Compliance review | [#relay-alex-morgan-compliance](https://charlie-assistants.slack.com/archives/C0CEE463A04) |

Charlie is the sole human member and acts for these fictional people. The channels separate their roles, not their accounts. The existing narrated video and earlier GIFs still show the original `#relay-demo`; old messages there remain valid. No video re-recording was needed for this routing change.

Deployed backend: [clearpath-relay-demo.cfireborn.workers.dev](https://clearpath-relay-demo.cfireborn.workers.dev/health). The presenter's setup code is in the local ignored `backend/.dev.vars` (mode 0600); enter it in Relay's connection dialog. It is never part of the public build.

The app requests only `chat:write`; it does not read conversation history or create channels. Invite it to each destination channel. An allowlist and trusted `SLACK_OWNER_MAP` control the recipient and channel. Maya Chen, Jordan Lee, and Sofia Patel are fictional owners; all three route to Charlie. Every new message explicitly mentions Charlie and labels him as the demo proxy. Only that assigned Slack member can act on the message. Accept is one click; request changes opens a modal with required feedback. The first valid decision wins, and Slack cards are updated after the decision is saved.

## Present the existing demo

1. Open [Relay](https://cfireborn.github.io/marketingreview/) and click **Slack preview** at the top right. If you are in the full workspace, click the **relay.** logo first to return to the walkthrough.
2. Enter the private `DEMO_SETUP_KEY` from your local `backend/.dev.vars`, then click **Connect live Slack** and **Continue with live Slack**. The header should read **Live Slack connected**.
3. Keep that Relay tab open. In Slack, open the selected marketing owner's channel and **#relay-alex-morgan-compliance**, signed in as Charlie. Keep Alex as the reviewer for the configured return route.
4. Run the three cases. Clean approval sends an owner notice. A pre-approved fix offers **Accept adjustment** or **Request changes**; either response updates Relay and pings Alex. A revision request offers **Acknowledge request**; acknowledgment pings Alex and records receipt while the asset remains unapproved.
5. For a fresh submission, use **New submission**, upload a PNG/JPEG, record its intended use, and select Sofia, Maya, or Jordan as owner. Supplied text and local OCR are optional; the default reviewer inspects pixels with live AI. Use **Viewing as** to move between creative and compliance. The older registered examples remain available at `?prepared`. See [live AI setup](AI.md).

If you already finished the examples in preview, use **Restart walkthrough** at the bottom before presenting. It resets the three examples and preserves your other submissions. Connecting does not replay old messages. The connection lasts up to 72 hours in that browser tab; a new tab or browser may need the code again. Keep the setup code out of screen recordings and public files.

## Setup

```sh
cd backend
npm ci
npm test
npx wrangler login
npx wrangler d1 create relay-demo
```

Copy the returned database ID into `wrangler.jsonc`, then run `npm run db:remote`. Create a Slack app using `slack-manifest.json` (replace its request URL after deploying), install it in the demo workspace, and invite it to every configured owner/reviewer channel plus the legacy `#relay-demo` channel. Set these with `npx wrangler secret put NAME`:

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID` (legacy/fallback destination), `SLACK_ALLOWED_USER_IDS` (comma-separated)
- `DEMO_SETUP_KEY` (random, at least 32 URL-safe characters)
- `SLACK_OWNER_MAP`: JSON mapping each owner name to `{ userId, displayName, isProxy, channelId?, channelName? }`. User IDs must be allowlisted. For example: `{"Maya Chen":{"userId":"U12345678","displayName":"Demo recipient","isProxy":true,"channelId":"C12345678","channelName":"relay-maya-chen-marketing"}}`. Unmapped owners cannot send; clients cannot choose another recipient or channel.
- `SLACK_REVIEWER_MAP`: optional mapping with the same entry shape, keyed by reviewer name. A mapped reviewer receives acceptance, feedback, and acknowledgment updates in their channel. An unmapped reviewer still sees responses in Relay but gets no separate Slack update.
- `SLACK_CHANNEL_NAME`: optional display name for the fallback channel, without `#`.

Run `npm run deploy`, set Slack Interactivity's request URL to `https://WORKER/slack/interactions`, and verify both decision paths. No paid plan is needed for this demo's expected traffic. Secrets belong in Worker secret storage and local ignored files, never the frontend bundle or repository.

## Frontend contract

All browser requests use `Authorization: Bearer …`. Exchange the private setup code through `POST /v1/sessions`; the response is `{ token, expiresAt, channel, routing? }`. `channel` is the legacy fallback; `routing` contains `owners` and `reviewers` arrays of `{ name, channelId, channelName }` for the connection summary. Each delivered record remains the authority for its actual destination. Keep the returned random capability in `sessionStorage`, discard the setup code, and clear it on disconnect. Each connection has a separate namespace, lasts 72 hours, and allows 20 messages across proposals and notifications with at least five seconds between sends. Up to 25 connections can be active. The setup code is shared privately with the presenter, not shipped with the public demo.

`POST /v1/proposals` accepts:

```js
{
  clientRequestId, // generate once for a send; reuse it for retries
  submissionId, title, reviewer, owner,
  assetVersion: { id, content: { headline, body, disclosure, cta, art, image?, palette? },
    scope: { product, audience, channel, placement } },
  originalContent: { headline, body, disclosure, cta, art, image?, palette? },
  rationale,
  assetImage // optional PNG data URL; the app sends its rendered creative, max 500 KB decoded
}
```

The response and `GET /v1/proposals/:id` both return:

```js
{
  id, status, // pending | accepted | changes_requested | superseded
  delivery, // sending | sent | failed | uncertain
  sourceSnapshot: { submissionId, assetVersion },
  slackMessageUrl, recipient, // { owner, slackUserId, displayName, isProxy, channelId, channelName }
  reviewerNotification, // null, or { recipient, delivery, slackMessageUrl }
  createdAt, updatedAt, // UTC ISO timestamps
  feedback, decidedAt, decidedBy // null until a decision; decidedBy is the Slack member ID
}
```

Only show “sent” for `delivery === 'sent'`. Retry a failed POST with the **same** request ID to inspect its saved delivery result; it cannot create a second Slack message. An uncertain delivery needs checking in Slack before sending a new request. A signed button click from the assigned member can reconcile a pending proposal whose send timed out, binding the actual message timestamp before applying the decision. An explicit Slack image-download rejection gets one retry with the same payload; timeouts and other uncertain results are never automatically resent. Poll GET every few seconds while pending. Decision polling stops after a decision or disconnect; pending reviewer-return delivery can continue for up to 60 seconds. Apply a decision only when the current asset content **and** scope exactly match `sourceSnapshot`. A later edit requires a new review. Generated-image paths and palette are part of the snapshot; absent/empty image and absent/brand palette retain backward-compatible meaning.

The preview is captured before sending and kept unchanged on retries. Slack receives the rendered PNG alongside the full copy and scope. Its image-only URL contains a separate random 32-character token, with no listing endpoint or browser capability exposed. Anyone holding that URL can view the fictional demo image; it is cached for one day. This is deliberately a demo preview mechanism, not confidential asset storage.

`POST /v1/proposals/:id/supersede` with the same capability and `{}` retires a pending handoff and returns the full proposal. Repeat calls are safe; an existing acceptance or change request stays recorded. Call it when source content/scope changes or the browser discards a pending handoff. Slack loses its old decision buttons, and even a cached button or open feedback modal cannot decide a superseded proposal. The frontend still checks the exact snapshot if retiring the Slack card fails.

`POST /v1/notifications` uses the same request ID, owner, title, reviewer, assetVersion, and optional PNG, plus `kind: 'approved' | 'revision_requested'` and a required `note`. It has no `originalContent` or `rationale`. `GET /v1/notifications/:id` returns the same saved record: `{ id, kind, status, delivery, sourceSnapshot, slackMessageUrl, recipient, reviewerNotification, createdAt, updatedAt, acknowledgedAt, acknowledgedBy }`. Delivery states and same-ID retry rules match proposals.

Approval notices have status `noted` and no decision button. Revision requests start `awaiting_acknowledgment`; their **Acknowledge request** button changes only the notification to `acknowledged`. It records receipt, never asset approval. Both have an Open Relay link. The bridge binds notices to the exact asset, owner, and review event, so an old receipt cannot describe a newer review even if its version is unchanged. Notification polling never changes the asset's review status. Disconnect cannot unsend an already delivered notice; reconnecting creates a new namespace and does not resend previous requests.

Owner and reviewer destinations are copied into each saved record. Callback validation, card updates, and supersession use that saved channel, so changing a routing map cannot move an older decision. Older records use their saved Slack permalink or the original fallback channel.

`reviewerNotification` reports the separate return message after acceptance, required feedback, or acknowledgment: `delivery` is `not_sent`, `sending`, `sent`, `failed`, or `uncertain`. An atomic claim prevents repeated Slack callbacks from sending duplicate reviewer updates. Relay polls pending reviewer delivery for up to 60 seconds after the terminal response and shows its destination and confirmed link. Its failure never undoes the saved decision. This is bounded delivery, not a durable retry queue: failed or uncertain reviewer updates are not automatically resent. An approval notice has no marketing response, so it sends no return receipt.

Failures return `{ error }` with 400 (invalid input), 401 (bad or expired capability), 403 (origin/member not allowed), 404 (record outside this browser connection), 409 (conflicting request/message), 429 (demo limit), 502 (Slack delivery), or 503 (not configured).

The Worker verifies Slack's HMAC signature and five-minute timestamp window, configured workspace, saved destination channel, authorized member, and originating message timestamp. CORS permits only `https://cfireborn.github.io` and localhost/127.0.0.1 on ports 5173, 5174, and 4173. The private capability is still required: CORS alone is not authentication.

## Limits and verification

The person-channel configuration was deployed on November 2, 2026, with Worker `ff518d94-a637-4fdb-8360-a191a73b96d3` and migration `0005_person_channels.sql`. The authenticated session response was checked for all four configured routes; live message outcomes are recorded separately below.

This is a private demo integration, not a tenant or employee identity system. Browser disconnect clears local access; capabilities expire server-side after 72 hours. Existing records stay in D1 for inspection. Slack card refresh can fail after a decision is saved; the API record remains authoritative. Repeating a valid proposal button click can retry its card refresh without changing the saved decision. Repeated revision acknowledgments do not trigger another refresh. Production would need real team identity, scoped membership, retention, delivery reconciliation, and revocation controls.

Recorded verification reached 28 backend tests (`npm test` in `backend/`) against real in-memory SQLite with Slack's API mocked: private setup, isolation, expiry, CORS, idempotent sends, complete snapshots, replay/tamper rejection, member/message binding, first-decision wins, mandatory feedback, failed delivery, superseded buttons/modals, PNG validation/access, trusted owner routing/proxy mentions, notification delivery/idempotency/isolation, receipt-only acknowledgment, image/palette snapshot compatibility, saved owner channels, cross-channel callback rejection, legacy-card updates, one reviewer notification per decision, and reviewer-delivery failure isolation. Existing v1 databases need `migrations/0002_superseded.sql` followed by `0003_preview_image.sql`, `0004_notifications.sql`, and `0005_person_channels.sql`; fresh installs use the current schema directly.

Live verification on November 1, 2026: private channel delivery, a real Slack acceptance, and the required-feedback rejection modal all saved to D1 and were read back through the authenticated API. A local-browser CP-1042 v2 handoff completed the full loop: send from Relay, accept in real Slack, poll back to Approved with the actual Slack actor. CP-1041's actual rendered PNG was visually checked in Slack; its required feedback returned to Relay as Changes requested. Editing CP-1039 after sending created Needs review v3, retired its v2 handoff in D1, and removed the actual Slack buttons with an explanation that a newer revision needs review. The app has only `chat:write`; no paid plan or third-party AI call was used.

References: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Slack interactivity](https://docs.slack.dev/interactivity/handling-user-interaction/), [Slack image blocks](https://docs.slack.dev/reference/block-kit/blocks/image-block/), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Final hosted verification: CP-1042 v2 was sent from `cfireborn.github.io/marketingreview/` and accepted in actual Slack at 19:07:32 Pacific on November 1. The deployed app polled back to Approved, preserving v2 and the actual Slack member in its event history. The phase-five README GIF records this run.

Guided-flow verification on November 2, 2026 used the deployed app: CP-1040 v1 sent an informational approval notice at 09:41:33 Pacific; CP-1042 v2 sent at 09:41:39 and was accepted in actual Slack; CP-1041 v2 sent at 09:42:16 with its corrected photo creative (379 KB), remaining state/affiliate evidence requests, and a receipt-only acknowledgment button. An agent operated both actual Slack actions in Charlie’s signed-in browser. The hosted app finished with CP-1040 Approved v1, CP-1042 Approved v2, and CP-1041 Revision requested v2 with no approved version; state and affiliate findings remained unresolved. No browser runtime errors were recorded. All three messages mention real @Charlie and disclose the fictional-owner proxy. Migration `0004` and the trusted owner map are configured.

Fresh-upload verification on November 2 used the deployed app and the supplied Downloads PNG/TXT files. Sofia's new credit-card submission was approved at v1 and notified her marketing channel at 15:47:15 Pacific. Maya's new loan submission preserved its original, prepared an actual corrected-image v2, and was accepted in Slack at 15:47:47; Alex received the return update. Jordan's new mortgage submission sent its remaining evidence comments at 15:48:35 and was acknowledged at 15:49:15; Alex received that update too. It stayed Revision requested with no approved version and unresolved state/affiliate evidence. D1 and actual Slack cards confirmed the owner destinations and delivered reviewer updates. The Phase 6 GIF shows these fresh flows with idle waits removed; the existing narrated video is unchanged.
