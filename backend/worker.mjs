import { handleAi } from './ai.mjs';

const SITE_URL = 'https://cfireborn.github.io/marketingreview/';
const WORKER_URL = 'https://clearpath-relay-demo.cfireborn.workers.dev';
const ALLOWED_ORIGINS = new Set([
  'https://cfireborn.github.io',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://127.0.0.1:5174',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]);
const SESSION_HOURS = 72;
const MAX_SENDS = 20;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function bearer(request) {
  return request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1] ?? '';
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function equalSecret(left, right) {
  const a = await digest(left);
  const b = await digest(right);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function readBody(request, limit = 32768) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, 'Request is too large.');
  const text = await request.text();
  if (encoder.encode(text).length > limit) throw new HttpError(413, 'Request is too large.');
  return text;
}
function text(value, name, max = 250, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new HttpError(400, `${name} is missing or too long.`);
  return value;
}
function assetContent(value) {
  if (!value || !['sunrise', 'home', 'card'].includes(value.art)) throw new HttpError(400, 'Asset artwork is invalid.');
  if (value.palette !== undefined && !['brand', 'off-brand'].includes(value.palette)) throw new HttpError(400, 'Asset palette is invalid.');
  const image = value.image === undefined ? '' : text(value.image, 'Asset image', 2000, true);
  return {
    headline: text(value.headline, 'Headline', 300, true),
    body: text(value.body, 'Body', 2000, true),
    disclosure: text(value.disclosure, 'Disclosure', 2000, true),
    cta: text(value.cta, 'CTA', 150, true),
    art: value.art,
    ...(image ? { image } : {}),
    ...(value.palette === 'off-brand' ? { palette: value.palette } : {}),
  };
}
function assetImage(value) {
  if (value == null) return null;
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 700000) throw new HttpError(400, 'Creative preview must be a PNG under 500 KB.');
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) throw new HttpError(400, 'Creative preview is not valid PNG data.');
  let bytes;
  try { bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); } catch { throw new HttpError(400, 'Creative preview is not valid PNG data.'); }
  if (bytes.length > 500 * 1024) throw new HttpError(400, 'Creative preview must be a PNG under 500 KB.');
  if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((byte,index) => bytes[index] !== byte) || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') throw new HttpError(400, 'Creative preview is not valid PNG data.');
  return value;
}
function proposalPayload(body) {
  const version = body?.assetVersion;
  if (!Number.isInteger(version?.id) || version.id < 1 || version.id > 1000000) throw new HttpError(400, 'Asset version is invalid.');
  const scope = version.scope ?? {};
  return {
    clientRequestId: text(body.clientRequestId, 'Request ID', 100),
    submissionId: text(body.submissionId, 'Submission ID', 100),
    title: text(body.title, 'Title', 150),
    reviewer: text(body.reviewer, 'Reviewer', 100),
    owner: text(body.owner, 'Creative owner', 100),
    assetVersion: {
      id: version.id,
      content: assetContent(version.content),
      scope: {
        product: text(scope.product, 'Product'), audience: text(scope.audience, 'Audience'),
        channel: text(scope.channel, 'Channel'), placement: text(scope.placement, 'Placement'),
        ...(scope.jurisdiction !== undefined ? { jurisdiction: text(scope.jurisdiction, 'Jurisdiction', 100) } : {}),
        ...(scope.affiliatePartner !== undefined ? { affiliatePartner: text(scope.affiliatePartner, 'Affiliate partner', 100) } : {}),
      },
    },
    originalContent: assetContent(body.originalContent),
    rationale: text(body.rationale, 'Decision rationale', 1500),
  };
}
function configured(env) {
  return env.DB && env.DEMO_SETUP_KEY?.length >= 32 && env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET && env.SLACK_TEAM_ID && env.SLACK_CHANNEL_ID && env.SLACK_ALLOWED_USER_IDS && env.SLACK_OWNER_MAP;
}
function routingMap(value, label) {
  if (!value) return {};
  let map;
  try { map = JSON.parse(value); } catch { throw new HttpError(503, `Slack ${label} routing is not configured.`); }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new HttpError(503, `Slack ${label} routing is not configured.`);
  return map;
}
function trustedRecipient(name, map, env, required = true) {
  const recipient = Object.hasOwn(map, name) ? map[name] : null;
  if (!recipient && !required) return null;
  if (!recipient || !/^U[A-Z0-9]{8,20}$/.test(recipient.userId) || !env.SLACK_ALLOWED_USER_IDS.split(',').map(id => id.trim()).includes(recipient.userId) || typeof recipient.displayName !== 'string' || !recipient.displayName.trim() || recipient.displayName.length > 100 || typeof recipient.isProxy !== 'boolean') throw new HttpError(400, 'This person has no authorized Slack recipient.');
  if (recipient.channelId !== undefined && !/^[CG][A-Z0-9]{8,20}$/.test(recipient.channelId)) throw new HttpError(503, 'Slack destination channel is invalid.');
  if (recipient.channelName !== undefined && (typeof recipient.channelName !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(recipient.channelName))) throw new HttpError(503, 'Slack destination channel name is invalid.');
  if (recipient.channelName && !recipient.channelId) throw new HttpError(503, 'Slack destination channel is missing.');
  return {
    owner: name, slackUserId: recipient.userId, displayName: recipient.displayName, isProxy: recipient.isProxy,
    channelId: recipient.channelId ?? env.SLACK_CHANNEL_ID,
    channelName: recipient.channelName ?? (recipient.channelId ? null : env.SLACK_CHANNEL_NAME || 'relay-demo'),
  };
}
function ownerRecipient(owner, env) { return trustedRecipient(owner, routingMap(env.SLACK_OWNER_MAP, 'owner'), env); }
function reviewerRecipient(reviewer, env) { return trustedRecipient(reviewer, routingMap(env.SLACK_REVIEWER_MAP, 'reviewer'), env, false); }
function messageChannel(row, env) {
  // Existing cards predate channel snapshots. Their saved permalink remains the
  // authority even if the configured owner route changes after delivery.
  const saved = row.recipient_json && JSON.parse(row.recipient_json).channelId;
  return saved || row.slack_url?.match(/\/archives\/([^/]+)\/p\d+$/)?.[1] || env.SLACK_CHANNEL_ID;
}
function slackUrl(channelId, ts) { return `https://charlie-assistants.slack.com/archives/${encodeURIComponent(channelId)}/p${ts.replace('.', '')}`; }
function reviewerNotice(row) {
  return row.reviewer_json ? { recipient: JSON.parse(row.reviewer_json), delivery: row.reviewer_delivery, slackMessageUrl: row.reviewer_slack_url } : null;
}
function recipientBlocks(row) {
  if (!row.recipient_json) return [];
  const recipient = JSON.parse(row.recipient_json);
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `Marketing owner notification: <@${recipient.slackUserId}>` } },
    ...(recipient.isProxy ? [section(`${recipient.displayName} receives this message on behalf of ${recipient.owner}.`)] : []),
  ];
}
async function sessionFor(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Connect this browser to the demo workspace first.');
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first();
  if (!session) throw new HttpError(401, 'This connection expired. Reconnect the demo workspace.');
  return session;
}
function publicProposal(row) {
  const payload = JSON.parse(row.payload_json);
  return {
    id: row.id, status: row.status, delivery: row.delivery,
    sourceSnapshot: { submissionId: payload.submissionId, assetVersion: payload.assetVersion },
    slackMessageUrl: row.slack_url,
    createdAt: row.created_at, updatedAt: row.updated_at,
    feedback: row.feedback, decidedAt: row.decided_at, decidedBy: row.decided_by,
    recipient: row.recipient_json ? JSON.parse(row.recipient_json) : null,
    reviewerNotification: reviewerNotice(row),
  };
}
async function slack(env, method, payload, retryImageDownload = true) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    // Slack's validation messages identify rejected blocks. Keep URLs and
    // credentials out of logs, and never log the creative request payload.
    const code = typeof result.error === 'string' && /^[a-z0-9_]+$/.test(result.error) ? result.error : 'unknown_error';
    const diagnostics = Array.isArray(result.response_metadata?.messages) ? result.response_metadata.messages
      .filter(message => typeof message === 'string').slice(0, 5).map(message => {
        let sanitized = message;
        for (const secret of [env.SLACK_BOT_TOKEN, env.SLACK_SIGNING_SECRET, env.DEMO_SETUP_KEY]) {
          if (secret) sanitized = sanitized.split(secret).join('[redacted]');
        }
        return sanitized.replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
          .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[token]')
          .replace(/[\r\n\t]/g, ' ').slice(0, 300);
      }).join(' | ') : '';
    console.error(`Slack ${method} rejected the request: ${response.status} ${code}${diagnostics ? ` · ${diagnostics}` : ''}`);
    // Slack explicitly rejected this post before sending it. Retry this one
    // transient image-fetch failure with the identical immutable payload. A
    // timeout or an ambiguous response must never cause a second post.
    const rejectedImage = response.ok && result.ok === false && result.error === 'invalid_blocks'
      && Array.isArray(result.response_metadata?.messages)
      && result.response_metadata.messages.some(message => typeof message === 'string'
        && /\bdownloading image failed\b/i.test(message)
        && /json-pointer:\/blocks\/\d+\/image_url/.test(message));
    if (method === 'chat.postMessage' && retryImageDownload && rejectedImage) return slack(env, method, payload, false);
    throw new HttpError(502, 'Slack did not confirm the request. Check the bot connection before retrying.');
  }
  return result;
}
function section(value) { return { type: 'section', text: { type: 'plain_text', text: value, emoji: true } }; }
function scopeText(scope) {
  return `Product: ${scope.product}\nAudience: ${scope.audience}\nChannel: ${scope.channel}\nPlacement: ${scope.placement}`
    + (scope.jurisdiction ? `\nJurisdiction: ${scope.jurisdiction}` : '')
    + (scope.affiliatePartner ? `\nAffiliate partner: ${scope.affiliatePartner}` : '');
}
function proposalBlocks(row) {
  const p = JSON.parse(row.payload_json);
  const v = p.assetVersion;
  const content = v.content;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Pre-approved adjustment for creative review', emoji: true } },
    section(`${p.title} · ${p.submissionId} · v${v.id}\nCompliance: ${p.reviewer} · Creative: ${p.owner}`),
    section(`Why this change\n${p.rationale}`),
    { type: 'divider' },
    section(p.originalContent.headline
      ? `Headline\nBefore: ${p.originalContent.headline}\nProposed: ${content.headline || 'See proposed artwork'}`
      : `Proposed headline\n${content.headline || 'See proposed artwork'}\nOriginal wording is in the submitted image; no transcript was supplied.`),
    section(`Proposed body\n${content.body || '(none)'}`),
    section(`Proposed disclosure\n${content.disclosure || '(none)'}`),
    section(`CTA: ${content.cta || '(none)'}\nArtwork: ${content.art}`),
    section(`Applies only to this version and use\n${scopeText(v.scope)}`),
  ];
  blocks.push(...recipientBlocks(row));
  if (row.asset_image && row.preview_token) blocks.splice(3, 0, {
    type: 'image', image_url: `${WORKER_URL}/v1/previews/${row.id}/${row.preview_token}.png`,
    alt_text: `${p.title}, version ${v.id}. ${content.headline}`,
    title: { type: 'plain_text', text: `Proposed creative · v${v.id}` },
  });
  if (row.status === 'pending') {
    blocks.push({ type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: 'Accept adjustment' }, style: 'primary', action_id: 'relay_accept', value: row.id },
      { type: 'button', text: { type: 'plain_text', text: 'Request changes' }, action_id: 'relay_changes', value: row.id },
      { type: 'button', text: { type: 'plain_text', text: 'Open Relay' }, url: SITE_URL, action_id: 'relay_open' },
    ] });
  } else if (row.status === 'superseded') {
    blocks.push(section('Superseded · this handoff is no longer current.\nA newer revision or changed review context needs a fresh compliance decision. Open Relay for the current asset.'));
  } else {
    blocks.push(section(`${row.status === 'accepted' ? '✓ Accepted' : 'Changes requested'} by Slack member ${row.decided_by}\n${row.feedback || 'This exact adjustment and recorded use are accepted.'}`));
  }
  return blocks;
}
async function createProposal(request, env, session) {
  let input;
  try { input = JSON.parse(await readBody(request, 750000)); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Request must be valid JSON.'); }
  const payload = proposalPayload(input);
  const image = assetImage(input.assetImage);
  const payloadJson = JSON.stringify(payload);
  const existing = await env.DB.prepare('SELECT * FROM proposals WHERE session_hash = ? AND request_id = ?').bind(session.token_hash, payload.clientRequestId).first();
  if (existing) {
    if (existing.payload_json !== payloadJson || existing.asset_image !== image) throw new HttpError(409, 'This request ID belongs to a different asset snapshot.');
    return json(publicProposal(existing));
  }
  const recipient = ownerRecipient(payload.owner, env);
  const reviewer = reviewerRecipient(payload.reviewer, env);
  const now = Date.now();
  const budget = await env.DB.prepare('UPDATE sessions SET send_count = send_count + 1, last_sent_at = ? WHERE token_hash = ? AND send_count < ? AND last_sent_at < ?').bind(now, session.token_hash, MAX_SENDS, now - 5000).run();
  if (!budget.meta.changes) throw new HttpError(429, 'Please wait five seconds between sends. Each demo connection allows 20 proposals.');
  const id = crypto.randomUUID();
  const timestamp = new Date(now).toISOString();
  try {
    await env.DB.prepare('INSERT INTO proposals (id, session_hash, request_id, payload_json, created_at, updated_at, asset_image, preview_token, recipient_json, reviewer_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, session.token_hash, payload.clientRequestId, payloadJson, timestamp, timestamp, image, image ? crypto.randomUUID().replaceAll('-', '') : null, JSON.stringify(recipient), reviewer ? JSON.stringify(reviewer) : null).run();
  } catch { throw new HttpError(409, 'This request is already being submitted. Retry with the same request ID.'); }
  let row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  let message;
  try {
    message = await slack(env, 'chat.postMessage', {
      channel: messageChannel(row, env),
      text: `${payload.title}: compliance pre-approved v${payload.assetVersion.id}. Creative acceptance requested.`,
      blocks: proposalBlocks(row), unfurl_links: false, unfurl_media: false, mrkdwn: false,
    });
  } catch (error) {
    await env.DB.prepare('UPDATE proposals SET delivery = ?, updated_at = ? WHERE id = ?').bind(error instanceof HttpError ? 'failed' : 'uncertain', new Date().toISOString(), id).run();
    throw new HttpError(502, 'Could not confirm Slack delivery. Retry with the same request ID to inspect delivery status; do not create another send.');
  }
  const url = slackUrl(messageChannel(row, env), message.ts);
  await env.DB.prepare('UPDATE proposals SET delivery = ?, slack_ts = ?, slack_url = ?, updated_at = ? WHERE id = ?').bind('sent', message.ts, url, new Date().toISOString(), id).run();
  row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  return json(publicProposal(row), 201);
}
function publicNotification(row) {
  const payload = JSON.parse(row.payload_json);
  return {
    id: row.id, kind: row.kind, status: row.status, delivery: row.delivery,
    sourceSnapshot: { submissionId: payload.submissionId, assetVersion: payload.assetVersion },
    slackMessageUrl: row.slack_url, recipient: JSON.parse(row.recipient_json),
    reviewerNotification: reviewerNotice(row),
    createdAt: row.created_at, updatedAt: row.updated_at,
    acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by,
  };
}
function notificationBlocks(row) {
  const p = JSON.parse(row.payload_json);
  const v = p.assetVersion;
  const approved = row.kind === 'approved';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: approved ? 'Approved for this version and use' : 'Revision requested · awaiting marketing' } },
    section(`${p.title} · ${p.submissionId} · v${v.id}\nReviewer: ${p.reviewer} · Marketing owner: ${p.owner}`),
    ...recipientBlocks(row), section(`${approved ? 'Review outcome' : 'What needs to change'}\n${p.note}`),
    section(scopeText(v.scope)),
  ];
  if (row.asset_image && row.preview_token) blocks.push({ type: 'image', image_url: `${WORKER_URL}/v1/previews/${row.id}/${row.preview_token}.png`, alt_text: `${p.title}, version ${v.id}. ${v.content.headline}`, title: { type: 'plain_text', text: `Reviewed creative · v${v.id}` } });
  if (row.status === 'acknowledged') blocks.push(section(`Acknowledged by Slack member ${row.acknowledged_by}. This confirms receipt only; the asset still needs revision and a fresh review.`));
  blocks.push({ type: 'actions', elements: [
    ...(!approved && row.status === 'awaiting_acknowledgment' ? [{ type: 'button', text: { type: 'plain_text', text: 'Acknowledge request' }, action_id: 'relay_acknowledge', value: row.id }] : []),
    { type: 'button', text: { type: 'plain_text', text: 'Open Relay' }, url: SITE_URL, action_id: 'relay_open' },
  ] });
  blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: approved ? 'Approval covers only this exact asset and intended use. Changes need a new review.' : 'Acknowledging this request is not approval. Submit a revised version for review.' }] });
  return blocks;
}
async function createNotification(request, env, session) {
  let input;
  try { input = JSON.parse(await readBody(request, 750000)); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Request must be valid JSON.'); }
  if (!['approved', 'revision_requested'].includes(input?.kind)) throw new HttpError(400, 'Notification type is invalid.');
  const { originalContent: _original, rationale: _rationale, ...common } = proposalPayload({ ...input, originalContent: input.assetVersion?.content, rationale: input.note });
  const payload = { ...common, kind: input.kind, note: _rationale };
  const payloadJson = JSON.stringify(payload);
  const image = assetImage(input.assetImage);
  const existing = await env.DB.prepare('SELECT * FROM notifications WHERE session_hash = ? AND request_id = ?').bind(session.token_hash, payload.clientRequestId).first();
  if (existing) {
    if (existing.payload_json !== payloadJson || existing.asset_image !== image) throw new HttpError(409, 'This request ID belongs to a different notification snapshot.');
    return json(publicNotification(existing));
  }
  const recipient = ownerRecipient(payload.owner, env);
  const reviewer = payload.kind === 'revision_requested' ? reviewerRecipient(payload.reviewer, env) : null;
  const now = Date.now();
  const budget = await env.DB.prepare('UPDATE sessions SET send_count = send_count + 1, last_sent_at = ? WHERE token_hash = ? AND send_count < ? AND last_sent_at < ?').bind(now, session.token_hash, MAX_SENDS, now - 5000).run();
  if (!budget.meta.changes) throw new HttpError(429, 'Please wait five seconds between sends. Each demo connection allows 20 messages.');
  const id = crypto.randomUUID();
  const timestamp = new Date(now).toISOString();
  try {
    await env.DB.prepare('INSERT INTO notifications (id, session_hash, request_id, kind, status, payload_json, recipient_json, created_at, updated_at, asset_image, preview_token, reviewer_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, session.token_hash, payload.clientRequestId, payload.kind, payload.kind === 'approved' ? 'noted' : 'awaiting_acknowledgment', payloadJson, JSON.stringify(recipient), timestamp, timestamp, image, image ? crypto.randomUUID().replaceAll('-', '') : null, reviewer ? JSON.stringify(reviewer) : null).run();
  } catch { throw new HttpError(409, 'This notification is already being submitted. Retry with the same request ID.'); }
  let row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first();
  let message;
  try {
    message = await slack(env, 'chat.postMessage', { channel: messageChannel(row, env), text: `${payload.title}: ${payload.kind === 'approved' ? 'approved for the recorded version and use' : 'revision requested from marketing'}.`, blocks: notificationBlocks(row), unfurl_links: false, unfurl_media: false, mrkdwn: false });
  } catch (error) {
    await env.DB.prepare('UPDATE notifications SET delivery = ?, updated_at = ? WHERE id = ?').bind(error instanceof HttpError ? 'failed' : 'uncertain', new Date().toISOString(), id).run();
    throw new HttpError(502, 'Could not confirm Slack delivery. Check this same request before sending another notification.');
  }
  const url = slackUrl(messageChannel(row, env), message.ts);
  await env.DB.prepare('UPDATE notifications SET delivery = ?, slack_ts = ?, slack_url = ?, updated_at = ? WHERE id = ?').bind('sent', message.ts, url, new Date().toISOString(), id).run();
  row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first();
  return json(publicNotification(row), 201);
}
async function updateNotificationMessage(env, id) {
  const row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first();
  await slack(env, 'chat.update', { channel: messageChannel(row, env), ts: row.slack_ts, text: 'Relay: revision request acknowledged. A revised version still needs review.', blocks: notificationBlocks(row) });
}
async function verifySlack(request, raw, secret) {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const signature = request.headers.get('X-Slack-Signature');
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^v0=[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hmac = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${raw}`));
  const expected = `v0=${[...new Uint8Array(hmac)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
  return equalSecret(expected, signature);
}
async function decide(env, row, status, userId, feedback = null) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare('UPDATE proposals SET status = ?, feedback = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ? AND status = ? AND delivery = ?').bind(status, feedback, now, userId, now, row.id, 'pending', 'sent').run();
  return result.meta.changes > 0;
}
async function updateSlackMessage(env, id) {
  const row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  if (!row.slack_ts) return;
  await slack(env, 'chat.update', { channel: messageChannel(row, env), ts: row.slack_ts, text: `Relay: ${row.status === 'accepted' ? 'adjustment accepted' : row.status === 'superseded' ? 'handoff superseded' : 'changes requested'}.`, blocks: proposalBlocks(row) });
}
async function notifyReviewer(env, table, id) {
  // Callers pass only these two literal tables. The conditional claim makes
  // repeated Slack callbacks harmless; ambiguous sends are never reposted.
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row?.reviewer_json || !['accepted', 'changes_requested', 'acknowledged'].includes(row.status)) return;
  const claimed = await env.DB.prepare(`UPDATE ${table} SET reviewer_delivery = 'sending' WHERE id = ? AND reviewer_delivery = 'not_sent' AND status = ?`).bind(id, row.status).run();
  if (!claimed.meta.changes) return;
  const p = JSON.parse(row.payload_json);
  const recipient = JSON.parse(row.recipient_json);
  const reviewer = JSON.parse(row.reviewer_json);
  const accepted = row.status === 'accepted';
  const acknowledged = row.status === 'acknowledged';
  const title = accepted ? 'Creative accepted the adjustment' : acknowledged ? 'Marketing acknowledged the revision request' : 'Creative requested changes';
  const actor = recipient.isProxy ? `${recipient.displayName}, acting for ${p.owner}` : recipient.displayName;
  const result = accepted ? 'This exact adjustment and recorded use are accepted.' : acknowledged ? 'Receipt confirmed. The asset still needs revision and another review.' : row.feedback;
  const scope = p.assetVersion.scope;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title } },
    section(`${p.title} · ${p.submissionId} · v${p.assetVersion.id}\nMarketing owner: ${p.owner} · Reviewer: ${p.reviewer}`),
    section(`${actor} responded in Slack.\n${result}`),
    { type: 'section', text: { type: 'mrkdwn', text: `Reviewer notification: <@${reviewer.slackUserId}>` } },
    ...(reviewer.isProxy ? [section(`${reviewer.displayName} receives this update on behalf of ${p.reviewer}.`)] : []),
    section(scopeText(scope)),
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: 'View marketing response' }, url: row.slack_url, action_id: 'relay_open_response' },
      { type: 'button', text: { type: 'plain_text', text: 'Open Relay' }, url: SITE_URL, action_id: 'relay_open' },
    ] },
  ];
  try {
    const message = await slack(env, 'chat.postMessage', { channel: reviewer.channelId, text: `${p.owner}: ${title.toLowerCase()} · ${p.submissionId} · v${p.assetVersion.id}.`, blocks, unfurl_links: false, unfurl_media: false, mrkdwn: false });
    await env.DB.prepare(`UPDATE ${table} SET reviewer_delivery = 'sent', reviewer_slack_url = ? WHERE id = ?`).bind(slackUrl(reviewer.channelId, message.ts), id).run();
  } catch (error) {
    await env.DB.prepare(`UPDATE ${table} SET reviewer_delivery = ? WHERE id = ?`).bind(error instanceof HttpError ? 'failed' : 'uncertain', id).run();
    console.error('Could not confirm reviewer Slack notification. The response remains recorded.');
  }
}
function refreshDecision(env, ctx, table, id) {
  const refresh = table === 'proposals' ? updateSlackMessage : updateNotificationMessage;
  ctx.waitUntil(Promise.all([
    refresh(env, id).catch(() => console.error('Could not refresh a decided Slack card. The response remains saved.')),
    notifyReviewer(env, table, id).catch(() => console.error('Could not process reviewer Slack notification. The response remains saved.')),
  ]));
}
async function interaction(request, env, ctx) {
  const raw = await readBody(request, 65536);
  if (!await verifySlack(request, raw, env.SLACK_SIGNING_SECRET)) throw new HttpError(401, 'Invalid Slack signature.');
  let payload;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload')); } catch { throw new HttpError(400, 'Invalid Slack interaction.'); }
  const allowedUsers = env.SLACK_ALLOWED_USER_IDS.split(',').map(value => value.trim());
  if (payload?.team?.id !== env.SLACK_TEAM_ID || !allowedUsers.includes(payload?.user?.id)) throw new HttpError(403, 'This Slack member is not authorized for demo decisions.');
  const action = payload.actions?.[0];
  if (payload.type === 'block_actions' && ['relay_open', 'relay_open_response'].includes(action?.action_id)) return new Response('');
  if (payload.type === 'block_actions' && action?.action_id === 'relay_acknowledge') {
    const row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(action.value).first();
    if (!row || row.kind !== 'revision_requested' || row.delivery !== 'sent' || payload.channel?.id !== messageChannel(row, env) || payload.container?.message_ts !== row.slack_ts) throw new HttpError(409, 'This message does not match a delivered revision request.');
    if (JSON.parse(row.recipient_json).slackUserId !== payload.user.id) throw new HttpError(403, 'Only the assigned marketing recipient can acknowledge this request.');
    const now = new Date().toISOString();
    const changed = await env.DB.prepare('UPDATE notifications SET status = ?, acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ? AND status = ?').bind('acknowledged', now, payload.user.id, now, row.id, 'awaiting_acknowledgment').run();
    if (changed.meta.changes) refreshDecision(env, ctx, 'notifications', row.id);
    return new Response('');
  }
  let id;
  let expectedTimestamp;
  let expectedChannel;
  if (payload.type === 'block_actions') {
    if (!['relay_accept', 'relay_changes'].includes(action?.action_id)) throw new HttpError(400, 'Unsupported Slack action.');
    id = action.value;
    expectedTimestamp = payload.container?.message_ts;
  } else if (payload.type === 'view_submission' && payload.view?.callback_id === 'relay_changes_submit') {
    let metadata;
    try { metadata = JSON.parse(payload.view.private_metadata); } catch { throw new HttpError(400, 'Invalid decision context.'); }
    id = metadata.id;
    expectedTimestamp = metadata.ts;
    expectedChannel = metadata.channelId;
  } else throw new HttpError(400, 'Unsupported Slack interaction.');
  let row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  if (row && payload.type === 'block_actions' && payload.channel?.id !== messageChannel(row, env)) throw new HttpError(400, 'Unsupported Slack action channel.');
  if (row && payload.type === 'view_submission' && (expectedChannel || (row.recipient_json && JSON.parse(row.recipient_json).channelId)) && expectedChannel !== messageChannel(row, env)) throw new HttpError(409, 'This form does not match the delivered proposal channel.');
  // A post can reach Slack even when its response times out. A signed button
  // interaction from the assigned recipient proves delivery; bind its message
  // once before applying the normal exact-message and first-decision checks.
  if (payload.type === 'block_actions' && row?.status === 'pending' && row.delivery === 'uncertain' && row.slack_ts === null) {
    if (!row.recipient_json || JSON.parse(row.recipient_json).slackUserId !== payload.user.id) throw new HttpError(403, 'Only the assigned creative recipient can decide this proposal.');
    if (typeof expectedTimestamp !== 'string' || !/^\d+\.\d{6}$/.test(expectedTimestamp)) throw new HttpError(409, 'This message does not match a delivered proposal.');
    const url = slackUrl(messageChannel(row, env), expectedTimestamp);
    await env.DB.prepare("UPDATE proposals SET delivery = ?, slack_ts = ?, slack_url = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND delivery = 'uncertain' AND slack_ts IS NULL").bind('sent', expectedTimestamp, url, new Date().toISOString(), id).run();
    row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  }
  if (!row || row.slack_ts !== expectedTimestamp || row.delivery !== 'sent') throw new HttpError(409, 'This message does not match a delivered proposal.');
  if (row.recipient_json && JSON.parse(row.recipient_json).slackUserId !== payload.user.id) throw new HttpError(403, 'Only the assigned creative recipient can decide this proposal.');
  if (payload.type === 'view_submission') {
    const feedback = payload.view.state?.values?.creative_feedback?.feedback?.value?.trim();
    if (!feedback || feedback.length > 1000) return json({ response_action: 'errors', errors: { creative_feedback: 'Please give clear feedback, up to 1,000 characters.' } });
    if (!await decide(env, row, 'changes_requested', payload.user.id, feedback)) return json({ response_action: 'errors', errors: { creative_feedback: 'This handoff is no longer awaiting a decision. Close this form and open Relay for the current version.' } });
    refreshDecision(env, ctx, 'proposals', id);
    return new Response('');
  }
  if (row.status !== 'pending') {
    // Retrying a valid button may repair a failed Slack card refresh. It never
    // reopens or changes the already-recorded decision.
    ctx.waitUntil(updateSlackMessage(env, id).catch(() => console.error('Could not refresh a decided Slack card. The decision remains saved.')));
    return json({ response_type: 'ephemeral', text: row.status === 'superseded' ? 'This handoff is no longer current. Open Relay for the latest revision.' : 'This adjustment already has a decision. Refresh Relay to see it.' });
  }
  if (action.action_id === 'relay_accept') {
    if (await decide(env, row, 'accepted', payload.user.id)) refreshDecision(env, ctx, 'proposals', id);
    return new Response('');
  }
  await slack(env, 'views.open', {
    trigger_id: payload.trigger_id,
    view: {
      type: 'modal', callback_id: 'relay_changes_submit', private_metadata: JSON.stringify({ id, ts: row.slack_ts, channelId: messageChannel(row, env) }),
      title: { type: 'plain_text', text: 'Request changes' }, submit: { type: 'plain_text', text: 'Send feedback' }, close: { type: 'plain_text', text: 'Cancel' },
      blocks: [{ type: 'input', block_id: 'creative_feedback', label: { type: 'plain_text', text: 'What should change?' }, element: { type: 'plain_text_input', action_id: 'feedback', multiline: true, max_length: 1000 } }],
    },
  });
  return new Response('');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    let response;
    try {
      if (url.pathname === '/slack/interactions' && request.method === 'POST') {
        if (!configured(env)) throw new HttpError(503, 'Slack demo is not configured.');
        return await interaction(request, env, ctx);
      }
      const previewPath = url.pathname.match(/^\/v1\/previews\/([a-f0-9-]{36})\/([a-f0-9]{32})\.png$/);
      if (previewPath && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT asset_image FROM proposals WHERE id = ? AND preview_token = ?').bind(previewPath[1], previewPath[2]).first()
          ?? await env.DB.prepare('SELECT asset_image FROM notifications WHERE id = ? AND preview_token = ?').bind(previewPath[1], previewPath[2]).first();
        if (!row?.asset_image) throw new HttpError(404, 'Preview not found.');
        const bytes = Uint8Array.from(atob(row.asset_image.split(',')[1]), character => character.charCodeAt(0));
        return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
      }
      if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'This browser origin is not allowed.');
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (url.pathname.startsWith('/v1/ai/')) response = await handleAi(request, env);
      else if (url.pathname === '/health' && request.method === 'GET') response = json({ ok: true, configured: Boolean(configured(env)) });
      else {
        if (!configured(env)) throw new HttpError(503, 'Slack demo is not configured.');
        if (url.pathname === '/v1/sessions' && request.method === 'POST') {
          if (!bearer(request) || !await equalSecret(bearer(request), env.DEMO_SETUP_KEY)) throw new HttpError(401, 'The demo setup code is incorrect.');
          const active = await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?').bind(new Date().toISOString()).first();
          if (active.count >= 25) throw new HttpError(429, 'This private demo already has 25 active connections.');
          const channels = (value, label) => {
            const map = routingMap(value, label);
            return Object.keys(map).map(name => {
              const recipient = trustedRecipient(name, map, env);
              return { name, channelName: recipient.channelName, channelId: recipient.channelId };
            });
          };
          const routing = { owners: channels(env.SLACK_OWNER_MAP, 'owner'), reviewers: channels(env.SLACK_REVIEWER_MAP, 'reviewer') };
          const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
          const now = new Date();
          const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600000).toISOString();
          await env.DB.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').bind(await digest(token), now.toISOString(), expiresAt).run();
          response = json({ token, expiresAt, channel: '#relay-demo', routing }, 201);
        } else {
          const session = await sessionFor(request, env);
          if (url.pathname === '/v1/proposals' && request.method === 'POST') response = await createProposal(request, env, session);
          else if (url.pathname === '/v1/notifications' && request.method === 'POST') response = await createNotification(request, env, session);
          else if (/^\/v1\/notifications\/[a-f0-9-]{36}$/.test(url.pathname) && request.method === 'GET') {
            const row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ? AND session_hash = ?').bind(url.pathname.split('/').at(-1), session.token_hash).first();
            if (!row) throw new HttpError(404, 'Notification not found in this browser connection.');
            response = json(publicNotification(row));
          }
          else if (/^\/v1\/proposals\/[a-f0-9-]{36}\/supersede$/.test(url.pathname) && request.method === 'POST') {
            const id = url.pathname.split('/')[3];
            const row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ? AND session_hash = ?').bind(id, session.token_hash).first();
            if (!row) throw new HttpError(404, 'Proposal not found in this browser connection.');
            await env.DB.prepare('UPDATE proposals SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind('superseded', new Date().toISOString(), id, 'pending').run();
            const current = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
            if (current.status === 'superseded' && current.slack_ts) ctx.waitUntil(updateSlackMessage(env, id).catch(() => console.error('Could not refresh a superseded Slack card. The handoff remains retired.')));
            response = json(publicProposal(current));
          }
          else if (/^\/v1\/proposals\/[a-f0-9-]{36}$/.test(url.pathname) && request.method === 'GET') {
            const row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ? AND session_hash = ?').bind(url.pathname.split('/').at(-1), session.token_hash).first();
            if (!row) throw new HttpError(404, 'Proposal not found in this browser connection.');
            response = json(publicProposal(row));
          } else throw new HttpError(404, 'Endpoint not found.');
        }
      }
    } catch (error) {
      response = json({ error: error instanceof HttpError ? error.message : 'The request could not be completed. Please try again.' }, error instanceof HttpError ? error.status : 500);
    }
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    return response;
  },
};
