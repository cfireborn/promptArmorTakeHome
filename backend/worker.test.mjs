import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from './worker.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(query) {
    const statement = sql.prepare(query);
    let args = [];
    return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async run() { return { meta: { changes: statement.run(...args).changes } }; } };
  } };
  const env = { DB, DEMO_SETUP_KEY: 'test-setup-key-that-is-long-enough-123456', SLACK_BOT_TOKEN: 'test-bot', SLACK_SIGNING_SECRET: 'test-signature', SLACK_TEAM_ID: 'T_DEMO', SLACK_CHANNEL_ID: 'C_DEMO', SLACK_ALLOWED_USER_IDS: 'U12345678,U87654321', SLACK_OWNER_MAP: JSON.stringify({ Alex: { userId: 'U12345678', displayName: 'Demo recipient', isProxy: true } }) };
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  const call = (path, { token, body, method = body ? 'POST' : 'GET', origin = 'https://cfireborn.github.io' } = {}) => worker.fetch(new Request(`https://relay.test${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  async function connect() { const response = await call('/v1/sessions', { method: 'POST', token: env.DEMO_SETUP_KEY }); assert.equal(response.status, 201); return (await response.json()).token; }
  async function interact(payload, { age = 0, tamper = false } = {}) {
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000) - age);
    const signature = `v0=${createHmac('sha256', env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    return worker.fetch(new Request('https://relay.test/slack/interactions', { method: 'POST', headers: { 'X-Slack-Request-Timestamp': timestamp, 'X-Slack-Signature': tamper ? `v0=${'0'.repeat(64)}` : signature }, body }), env, ctx);
  }
  return { sql, env, pending, call, connect, interact };
}
const content = { headline: 'Rates for your next chapter', body: 'Check your options.', disclosure: 'Terms and eligibility apply.', cta: 'Explore options', art: 'sunrise' };
const proposal = () => ({ clientRequestId: crypto.randomUUID(), submissionId: 'CP-1042', title: 'Loan campaign', reviewer: 'Morgan', owner: 'Alex', assetVersion: { id: 2, content: { ...content }, scope: { product: 'Personal loan', audience: 'New applicants', channel: 'Email', placement: 'Hero' } }, originalContent: { ...content, headline: 'Guaranteed approval' }, rationale: 'Remove unsupported approval guarantee.' });
const action = (id, actionId = 'relay_accept') => ({ type: 'block_actions', team: { id: 'T_DEMO' }, user: { id: 'U12345678' }, channel: { id: 'C_DEMO' }, container: { message_ts: '123456.000001' }, trigger_id: 'test-trigger', actions: [{ action_id: actionId, value: id }] });

test('private setup, scoped capabilities, CORS, and expiry', async () => {
  const f = fixture();
  assert.equal((await f.call('/v1/sessions', { method: 'POST', token: 'wrong-code-that-is-at-least-32-characters' })).status, 401);
  assert.equal((await f.call('/v1/sessions', { method: 'POST', token: f.env.DEMO_SETUP_KEY, origin: 'https://evil.example' })).status, 403);
  const token = await f.connect();
  assert.equal(token.length, 64);
  assert.notEqual(f.sql.prepare('SELECT token_hash FROM sessions').get().token_hash, token);
  const preflight = await f.call('/v1/proposals', { method: 'OPTIONS' });
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://cfireborn.github.io');
  assert.equal((await f.call('/v1/proposals', { method: 'POST', body: proposal() })).status, 401);
  f.sql.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await f.call('/v1/proposals', { token, body: proposal() })).status, 401);
});

test('send is idempotent, preserves the complete snapshot, and isolates browsers', async (t) => {
  const f = fixture();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url, JSON.parse(options.body)]); return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  const input = proposal();
  const sent = await f.call('/v1/proposals', { token, body: input });
  assert.equal(sent.status, 201);
  const record = await sent.json();
  assert.deepEqual(record.sourceSnapshot.assetVersion, input.assetVersion);
  assert.equal(record.delivery, 'sent');
  assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await f.call('/v1/proposals', { token, body: { ...input, title: 'Different asset' } })).status, 409);
  assert.equal((await f.call(`/v1/proposals/${record.id}`, { token: await f.connect() })).status, 404);
  assert.equal((await f.call('/v1/proposals', { token, body: proposal() })).status, 429);
  assert.equal(calls[0][1].channel, 'C_DEMO');
  assert.match(calls[0][1].blocks[8].text.text, /Placement: Hero/);
});

test('Slack signatures, authorized members, message binding, and first decision wins', async (t) => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, ts: '123456.000001' }));
  const token = await f.connect();
  const record = await (await f.call('/v1/proposals', { token, body: proposal() })).json();
  const payload = action(record.id);
  assert.equal((await f.interact(payload, { tamper: true })).status, 401);
  assert.equal((await f.interact(payload, { age: 301 })).status, 401);
  assert.equal((await f.interact({ ...payload, user: { id: 'U_OTHER' } })).status, 403);
  assert.equal((await f.interact({ ...payload, container: { message_ts: 'wrong' } })).status, 409);
  assert.equal((await f.interact(payload)).status, 200);
  await Promise.all(f.pending);
  const accepted = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.decidedBy, 'U12345678');
  assert.ok(accepted.decidedAt);
  await f.interact(action(record.id, 'relay_changes'));
  assert.equal((await (await f.call(`/v1/proposals/${record.id}`, { token })).json()).status, 'accepted');
});

test('request-changes modal requires feedback and saves it without accepting the asset', async (t) => {
  const f = fixture();
  let modal;
  t.mock.method(globalThis, 'fetch', async (url, options) => { if (url.endsWith('views.open')) modal = JSON.parse(options.body).view; return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  const record = await (await f.call('/v1/proposals', { token, body: proposal() })).json();
  assert.equal((await f.interact(action(record.id, 'relay_changes'))).status, 200);
  assert.equal(modal.blocks[0].type, 'input');
  const submission = { type: 'view_submission', team: { id: 'T_DEMO' }, user: { id: 'U12345678' }, view: { callback_id: modal.callback_id, private_metadata: modal.private_metadata, state: { values: { creative_feedback: { feedback: { value: '' } } } } } };
  assert.equal((await (await f.interact(submission)).json()).response_action, 'errors');
  submission.view.state.values.creative_feedback.feedback.value = 'Please keep our original CTA.';
  assert.equal((await f.interact(submission)).status, 200);
  await Promise.all(f.pending);
  const rejected = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(rejected.status, 'changes_requested');
  assert.equal(rejected.feedback, 'Please keep our original CTA.');
  await f.interact(action(record.id));
  assert.equal((await (await f.call(`/v1/proposals/${record.id}`, { token })).json()).status, 'changes_requested');
});

test('failed Slack delivery never becomes a sent proposal or silently sends twice', async (t) => {
  const f = fixture();
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return Response.json({ ok: false, error: 'not_in_channel' }); });
  const token = await f.connect();
  const input = proposal();
  assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 502);
  const retry = await (await f.call('/v1/proposals', { token, body: input })).json();
  assert.equal(retry.delivery, 'failed');
  assert.equal(retry.slackMessageUrl, null);
  assert.equal(sends, 1);
});

const imageDownloadFailure = { ok: false, error: 'invalid_blocks', response_metadata: { messages: ['[ERROR] downloading image failed [json-pointer:/blocks/3/image_url]'] } };

test('explicit image-download rejection retries the identical post once without creating another row', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const kind of ['proposal', 'notification']) {
    const f = fixture();
    const posts = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      posts.push(options.body);
      return Response.json(posts.length === 1 ? imageDownloadFailure : { ok: true, ts: '123456.000001' });
    });
    const token = await f.connect();
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cWQAAAAASUVORK5CYII=';
    const input = { ...(kind === 'proposal' ? proposal() : notice('revision_requested')), assetImage: png };
    const path = kind === 'proposal' ? '/v1/proposals' : '/v1/notifications';
    const response = await f.call(path, { token, body: input });
    assert.equal(response.status, 201);
    const record = await response.json();
    assert.equal(record.delivery, 'sent');
    assert.deepEqual(record.sourceSnapshot.assetVersion, input.assetVersion);
    assert.equal(posts.length, 2);
    assert.equal(posts[1], posts[0]);
    const blocks = JSON.parse(posts[0]).blocks;
    assert.ok(blocks.some(block => block.type === 'image' && block.image_url.includes(record.id)));
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${kind === 'proposal' ? 'proposals' : 'notifications'}`).get().count, 1);
    assert.equal((await f.call(path, { token, body: input })).status, 200);
    assert.equal(posts.length, 2);
  }
});

test('image retries are bounded and never apply to timeouts, ambiguous responses, or other rejections', async (t) => {
  t.mock.method(console, 'error', () => {});
  const scenarios = [
    { response: () => Response.json(imageDownloadFailure), posts: 2, delivery: 'failed' },
    { response: () => { throw new DOMException('Response timed out', 'TimeoutError'); }, posts: 1, delivery: 'uncertain' },
    { response: () => Response.json({ ok: false, error: 'not_in_channel' }), posts: 1, delivery: 'failed' },
    { response: () => Response.json({ ok: false, error: 'invalid_blocks', response_metadata: { messages: ['[ERROR] text too long [json-pointer:/blocks/3/text]'] } }), posts: 1, delivery: 'failed' },
    { response: () => Response.json(imageDownloadFailure, { status: 503 }), posts: 1, delivery: 'failed' },
  ];
  for (const scenario of scenarios) {
    const f = fixture();
    let posts = 0;
    t.mock.method(globalThis, 'fetch', async () => { posts++; return scenario.response(); });
    const token = await f.connect();
    const input = proposal();
    assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 502);
    const record = await (await f.call('/v1/proposals', { token, body: input })).json();
    assert.equal(record.delivery, scenario.delivery);
    assert.equal(record.slackMessageUrl, null);
    assert.equal(posts, scenario.posts);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM proposals').get().count, 1);
  }
});

test('a signed assigned-recipient action recovers uncertain delivery without weakening message binding', async (t) => {
  const f = fixture();
  let posts = 0;
  const updates = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('chat.postMessage')) { posts++; throw new DOMException('Response timed out', 'TimeoutError'); }
    updates.push(JSON.parse(options.body));
    return Response.json({ ok: true });
  });
  const token = await f.connect();
  const input = proposal();
  assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 502);
  const record = await (await f.call('/v1/proposals', { token, body: input })).json();
  assert.equal(record.delivery, 'uncertain');
  const payload = action(record.id);
  assert.equal((await f.interact(payload, { tamper: true })).status, 401);
  assert.equal((await f.interact(payload, { age: 301 })).status, 401);
  assert.equal((await f.interact({ ...payload, team: { id: 'T_OTHER' } })).status, 403);
  assert.equal((await f.interact({ ...payload, user: { id: 'U_OTHER' } })).status, 403);
  assert.equal((await f.interact({ ...payload, user: { id: 'U87654321' } })).status, 403);
  assert.equal((await f.interact({ ...payload, channel: { id: 'C_OTHER' } })).status, 400);
  assert.equal((await f.interact({ ...payload, container: { message_ts: 'invalid' } })).status, 409);
  const modalOnly = { type: 'view_submission', team: payload.team, user: payload.user, view: { callback_id: 'relay_changes_submit', private_metadata: JSON.stringify({ id: record.id, ts: payload.container.message_ts }) } };
  assert.equal((await f.interact(modalOnly)).status, 409);
  assert.equal(f.sql.prepare('SELECT slack_ts FROM proposals WHERE id = ?').get(record.id).slack_ts, null);
  assert.equal((await f.interact(payload)).status, 200);
  await Promise.all(f.pending);
  const accepted = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(accepted.delivery, 'sent');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.decidedBy, payload.user.id);
  assert.equal(accepted.slackMessageUrl, 'https://charlie-assistants.slack.com/archives/C_DEMO/p123456000001');
  assert.deepEqual(accepted.sourceSnapshot.assetVersion, input.assetVersion);
  assert.equal((await f.interact(payload)).status, 200);
  assert.equal((await f.interact(action(record.id, 'relay_changes'))).status, 200);
  assert.equal((await f.interact({ ...payload, container: { message_ts: '123456.000002' } })).status, 409);
  const unchanged = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(unchanged.decidedAt, accepted.decidedAt);
  assert.equal(unchanged.status, 'accepted');
  await Promise.all(f.pending);
  assert.equal(posts, 1);
  assert.equal(updates.length, 3);
  assert.equal(updates[0].ts, payload.container.message_ts);
});

test('Slack validation diagnostics redact URLs and credentials and limit log size', async (t) => {
  const f = fixture();
  const logs = [];
  t.mock.method(console, 'error', message => logs.push(message));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'invalid_blocks', response_metadata: { messages: [
    '[ERROR] downloading image failed [json-pointer:/blocks/3/image_url] https://relay.test/private-preview.png?token=secret-preview',
    `Credentials ${f.env.SLACK_BOT_TOKEN} ${f.env.SLACK_SIGNING_SECRET} ${f.env.DEMO_SETUP_KEY} xoxb-123-456-private`,
    `Long diagnostic ${'x'.repeat(2000)}`,
    { unexpected: 'object' },
  ] } }));
  const token = await f.connect();
  assert.equal((await f.call('/v1/proposals', { token, body: proposal() })).status, 502);
  assert.equal(logs.length, 2);
  for (const log of logs) {
    assert.match(log, /invalid_blocks/);
    assert.match(log, /downloading image failed \[json-pointer:\/blocks\/3\/image_url\]/);
    for (const secret of [f.env.SLACK_BOT_TOKEN, f.env.SLACK_SIGNING_SECRET, f.env.DEMO_SETUP_KEY, 'secret-preview', 'xoxb-123-456-private', 'https://']) assert.ok(!log.includes(secret));
    assert.ok(log.length < 1000);
  }
});

test('a repeated authorized button repairs a failed card refresh without changing the decision', async (t) => {
  const f = fixture();
  let posts = 0;
  const updates = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('chat.postMessage')) { posts++; return Response.json({ ok: true, ts: '123456.000001' }); }
    if (url.endsWith('chat.update')) {
      updates.push(JSON.parse(options.body));
      return Response.json(updates.length === 1 ? { ok: false, error: 'invalid_blocks' } : { ok: true });
    }
    throw new Error('Unexpected Slack operation');
  });
  const token = await f.connect();
  const record = await (await f.call('/v1/proposals', { token, body: proposal() })).json();
  const payload = action(record.id);
  await f.interact(payload);
  await Promise.all(f.pending);
  const before = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(before.status, 'accepted');
  assert.equal((await f.interact(payload, { tamper: true })).status, 401);
  assert.equal((await f.interact({ ...payload, user: { id: 'U87654321' } })).status, 403);
  assert.equal((await f.interact({ ...payload, container: { message_ts: '123456.000002' } })).status, 409);
  assert.equal(updates.length, 1);
  assert.equal((await f.interact(action(record.id, 'relay_changes'))).status, 200);
  await Promise.all(f.pending);
  const after = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.deepEqual(after, before);
  assert.equal(posts, 1);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1], updates[0]);
  assert.ok(updates[1].blocks.every(block => block.type !== 'actions'));
});

test('uncertain delivery recovery never revives explicit failures or superseded handoffs', async (t) => {
  const f = fixture();
  let explicitFailure = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (explicitFailure) return Response.json({ ok: false, error: 'not_in_channel' });
    throw new DOMException('Response timed out', 'TimeoutError');
  });
  const failedToken = await f.connect();
  const failedInput = proposal();
  await f.call('/v1/proposals', { token: failedToken, body: failedInput });
  const failed = await (await f.call('/v1/proposals', { token: failedToken, body: failedInput })).json();
  assert.equal((await f.interact(action(failed.id))).status, 409);
  assert.equal((await (await f.call(`/v1/proposals/${failed.id}`, { token: failedToken })).json()).delivery, 'failed');
  explicitFailure = false;
  const token = await f.connect();
  const input = proposal();
  await f.call('/v1/proposals', { token, body: input });
  const uncertain = await (await f.call('/v1/proposals', { token, body: input })).json();
  await f.call(`/v1/proposals/${uncertain.id}/supersede`, { token, body: {} });
  assert.equal((await f.interact(action(uncertain.id))).status, 409);
  const retired = await (await f.call(`/v1/proposals/${uncertain.id}`, { token })).json();
  assert.equal(retired.status, 'superseded');
  assert.equal(retired.delivery, 'uncertain');
  assert.equal(retired.slackMessageUrl, null);
});

test('recovered change requests retain the bound timestamp through the feedback modal', async (t) => {
  const f = fixture();
  let modal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('chat.postMessage')) throw new DOMException('Response timed out', 'TimeoutError');
    if (url.endsWith('views.open')) modal = JSON.parse(options.body).view;
    return Response.json({ ok: true });
  });
  const token = await f.connect();
  const input = proposal();
  await f.call('/v1/proposals', { token, body: input });
  const record = await (await f.call('/v1/proposals', { token, body: input })).json();
  assert.equal((await f.interact(action(record.id, 'relay_changes'))).status, 200);
  assert.deepEqual(JSON.parse(modal.private_metadata), { id: record.id, ts: '123456.000001', channelId: 'C_DEMO' });
  const pending = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(pending.delivery, 'sent');
  assert.equal(pending.status, 'pending');
  const submission = { type: 'view_submission', team: { id: 'T_DEMO' }, user: { id: 'U12345678' }, view: { callback_id: modal.callback_id, private_metadata: modal.private_metadata, state: { values: { creative_feedback: { feedback: { value: 'Keep the original CTA.' } } } } } };
  assert.equal((await f.interact(submission)).status, 200);
  await Promise.all(f.pending);
  const decided = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(decided.status, 'changes_requested');
  assert.equal(decided.feedback, 'Keep the original CTA.');
});

test('concurrent recovery attempts bind only one Slack message', async (t) => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('chat.postMessage')) throw new DOMException('Response timed out', 'TimeoutError');
    return Response.json({ ok: true });
  });
  const token = await f.connect();
  const input = proposal();
  await f.call('/v1/proposals', { token, body: input });
  const record = await (await f.call('/v1/proposals', { token, body: input })).json();
  const payloads = [action(record.id), { ...action(record.id), container: { message_ts: '123456.000002' } }];
  const responses = await Promise.all(payloads.map(payload => f.interact(payload)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  await Promise.all(f.pending);
  const winner = responses.findIndex(response => response.status === 200);
  const row = f.sql.prepare('SELECT * FROM proposals WHERE id = ?').get(record.id);
  assert.equal(row.slack_ts, payloads[winner].container.message_ts);
  assert.equal(row.status, 'accepted');
});

test('supersede retires only owned pending handoffs and rejects stale Slack actions', async (t) => {
  const f = fixture();
  const cards = [];
  let modal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('chat.update')) cards.push(body);
    if (url.endsWith('views.open')) modal = body.view;
    return Response.json({ ok: true, ts: '123456.000001' });
  });
  const token = await f.connect();
  const record = await (await f.call('/v1/proposals', { token, body: proposal() })).json();
  const path = `/v1/proposals/${record.id}/supersede`;
  assert.equal((await f.call(path, { token: await f.connect(), body: {} })).status, 404);
  await f.interact(action(record.id, 'relay_changes'));
  const retired = await (await f.call(path, { token, body: {} })).json();
  assert.equal(retired.status, 'superseded');
  assert.equal((await (await f.call(path, { token, body: {} })).json()).status, 'superseded');
  await f.interact(action(record.id));
  const staleModal = { type: 'view_submission', team: { id: 'T_DEMO' }, user: { id: 'U12345678' }, view: { callback_id: modal.callback_id, private_metadata: modal.private_metadata, state: { values: { creative_feedback: { feedback: { value: 'Old feedback' } } } } } };
  assert.equal((await (await f.interact(staleModal)).json()).response_action, 'errors');
  await Promise.all(f.pending);
  assert.equal((await (await f.call(`/v1/proposals/${record.id}`, { token })).json()).status, 'superseded');
  assert.ok(cards.every(card => !card.blocks.some(block => block.type === 'actions')));
  assert.ok(cards[0].blocks.some(block => block.text?.text.includes('Superseded')));
  const decidedToken = await f.connect();
  const decided = await (await f.call('/v1/proposals', { token: decidedToken, body: proposal() })).json();
  await f.interact(action(decided.id));
  assert.equal((await (await f.call(`/v1/proposals/${decided.id}/supersede`, { token: decidedToken, body: {} })).json()).status, 'accepted');
  await Promise.all(f.pending);
});

test('PNG previews preserve the submitted image and need an unguessable image-only URL', async (t) => {
  const f = fixture();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cWQAAAAASUVORK5CYII=';
  let sentBlocks;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { sentBlocks = JSON.parse(options.body).blocks; return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  assert.equal((await f.call('/v1/proposals', { body: { ...proposal(), assetImage: png } })).status, 401);
  assert.equal((await f.call('/v1/proposals', { token, body: { ...proposal(), assetImage: 'data:image/png;base64,ZmFrZQ==' } })).status, 400);
  assert.equal((await f.call('/v1/proposals', { token, body: { ...proposal(), assetImage: `data:image/png;base64,${Buffer.alloc(512001).toString('base64')}` } })).status, 400);
  const input = { ...proposal(), assetImage: png };
  const record = await (await f.call('/v1/proposals', { token, body: input })).json();
  const imageBlock = sentBlocks.find(block => block.type === 'image');
  assert.ok(imageBlock);
  assert.ok(!imageBlock.image_url.includes(token));
  assert.equal(record.assetImage, undefined);
  const imagePath = new URL(imageBlock.image_url).pathname;
  assert.match(imagePath, /^\/v1\/previews\/[a-f0-9-]{36}\/[a-f0-9]{32}\.png$/);
  const preview = await f.call(imagePath, { origin: null });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Content-Type'), 'image/png');
  assert.equal(preview.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(preview.headers.get('Cache-Control'), 'public, max-age=86400, immutable');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
  const wrongPath = imagePath.replace(/\/[a-f0-9]{32}\.png$/, `/${'0'.repeat(32)}.png`);
  assert.equal((await f.call(wrongPath, { origin: null })).status, 404);
  assert.equal((await f.call(`/v1/previews/${record.id}`, { origin: null })).status, 401);
  assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 200);
  assert.equal((await f.call('/v1/proposals', { token, body: { ...input, assetImage: undefined } })).status, 409);
});

const notice = (kind = 'approved') => {
  const { originalContent, rationale, ...input } = proposal();
  return { ...input, kind, note: rationale };
};

test('trusted owner routing mentions the real recipient and rejects unmapped owners', async (t) => {
  const f = fixture();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  assert.equal((await f.call('/v1/proposals', { token, body: { ...proposal(), owner: '<@U87654321>' } })).status, 400);
  assert.equal(sent.length, 0);
  const result = await (await f.call('/v1/proposals', { token, body: { ...proposal(), recipient: { userId: 'U87654321' } } })).json();
  assert.equal(result.recipient.slackUserId, 'U12345678');
  assert.ok(sent[0].blocks.some(block => block.text?.type === 'mrkdwn' && block.text.text.includes('<@U12345678>')));
  assert.ok(sent[0].blocks.some(block => block.text?.text.includes('receives this message on behalf of Alex')));
  assert.equal((await f.interact({ ...action(result.id), user: { id: 'U87654321' } })).status, 403);
});

test('image and palette belong to the snapshot, with absent defaults compatible', async (t) => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, ts: '123456.000001' }));
  const token = await f.connect();
  const input = proposal();
  const saved = await (await f.call('/v1/proposals', { token, body: input })).json();
  const defaults = structuredClone(input);
  defaults.assetVersion.content.palette = 'brand';
  defaults.assetVersion.content.image = '';
  assert.equal((await f.call('/v1/proposals', { token, body: defaults })).status, 200);
  defaults.assetVersion.content.palette = 'off-brand';
  assert.equal((await f.call('/v1/proposals', { token, body: defaults })).status, 409);
  defaults.assetVersion.content.palette = 'invalid';
  assert.equal((await f.call('/v1/proposals', { token, body: defaults })).status, 400);
  const changed = proposal();
  changed.assetVersion.content = { ...content, image: '/creative/test.png', palette: 'off-brand' };
  const next = await (await f.call('/v1/proposals', { token: await f.connect(), body: changed })).json();
  assert.deepEqual(next.sourceSnapshot.assetVersion.content, changed.assetVersion.content);
  assert.notDeepEqual(saved.sourceSnapshot.assetVersion.content, next.sourceSnapshot.assetVersion.content);
});

test('approval notices are idempotent, scoped, and contain no decision buttons', async (t) => {
  const f = fixture();
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  const input = notice();
  assert.equal((await f.call('/v1/notifications', { body: input })).status, 401);
  assert.equal((await f.call('/v1/notifications', { token, body: { ...input, kind: 'anything' } })).status, 400);
  const response = await f.call('/v1/notifications', { token, body: input });
  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.delivery, 'sent');
  assert.equal(record.status, 'noted');
  assert.deepEqual(record.sourceSnapshot.assetVersion, input.assetVersion);
  assert.equal((await f.call('/v1/notifications', { token, body: input })).status, 200);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].blocks.find(block => block.type === 'actions').elements.map(element => element.action_id), ['relay_open']);
  assert.equal((await f.call('/v1/notifications', { token, body: { ...input, note: 'Different reason' } })).status, 409);
  assert.equal((await f.call(`/v1/notifications/${record.id}`, { token: await f.connect() })).status, 404);
  assert.equal((await f.interact(action(record.id, 'relay_acknowledge'))).status, 409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM proposals').get().count, 0);
});

test('revision receipt binds the assigned actor and message, and never approves', async (t) => {
  const f = fixture();
  const updates = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { if (url.endsWith('chat.update')) updates.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  const record = await (await f.call('/v1/notifications', { token, body: notice('revision_requested') })).json();
  assert.equal(record.status, 'awaiting_acknowledgment');
  const payload = action(record.id, 'relay_acknowledge');
  assert.equal((await f.interact(payload, { tamper: true })).status, 401);
  assert.equal((await f.interact({ ...payload, user: { id: 'U87654321' } })).status, 403);
  assert.equal((await f.interact({ ...payload, container: { message_ts: 'wrong' } })).status, 409);
  assert.equal((await f.interact(payload)).status, 200);
  await Promise.all(f.pending);
  const acknowledged = await (await f.call(`/v1/notifications/${record.id}`, { token })).json();
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.acknowledgedBy, 'U12345678');
  assert.ok(acknowledged.acknowledgedAt);
  assert.equal((await f.interact(payload)).status, 200);
  assert.equal((await (await f.call(`/v1/notifications/${record.id}`, { token })).json()).acknowledgedAt, acknowledged.acknowledgedAt);
  await Promise.all(f.pending);
  assert.ok(updates.every(update => !update.blocks.some(block => block.elements?.some(element => ['relay_accept', 'relay_acknowledge'].includes(element.action_id)))));
  assert.ok(updates[0].blocks.some(block => block.text?.text.includes('receipt only')));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM proposals').get().count, 0);
});

test('notification previews remain private by URL and failed sends do not duplicate', async (t) => {
  const f = fixture();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cWQAAAAASUVORK5CYII=';
  let blocks;
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { sends++; blocks = JSON.parse(options.body).blocks; return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  assert.equal((await f.call('/v1/notifications', { token, body: { ...notice(), assetImage: 'data:image/png;base64,ZmFrZQ==' } })).status, 400);
  const input = { ...notice(), assetImage: png };
  await f.call('/v1/notifications', { token, body: input });
  const imagePath = new URL(blocks.find(block => block.type === 'image').image_url).pathname;
  const preview = await f.call(imagePath, { origin: null });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Content-Type'), 'image/png');
  assert.equal(preview.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
  assert.equal((await f.call(imagePath.replace(/\/[a-f0-9]{32}\.png$/, `/${'0'.repeat(32)}.png`), { origin: null })).status, 404);
  assert.equal((await f.call('/v1/notifications', { token, body: { ...input, assetImage: undefined } })).status, 409);
  t.mock.method(globalThis, 'fetch', async () => { sends++; return Response.json({ ok: false, error: 'not_in_channel' }); });
  const secondToken = await f.connect();
  const failedInput = notice();
  assert.equal((await f.call('/v1/notifications', { token: secondToken, body: failedInput })).status, 502);
  const retry = await (await f.call('/v1/notifications', { token: secondToken, body: failedInput })).json();
  assert.equal(retry.delivery, 'failed');
  assert.equal(retry.slackMessageUrl, null);
  assert.equal(sends, 2);
});

function personRouting(f) {
  const recipient = { userId: 'U12345678', displayName: 'Charlie', isProxy: true };
  f.env.SLACK_OWNER_MAP = JSON.stringify({
    Alex: { ...recipient, channelId: 'C11111111', channelName: 'alex-marketing' },
    Sofia: { ...recipient, channelId: 'C22222222', channelName: 'sofia-marketing' },
    Jordan: { ...recipient, channelId: 'C33333333', channelName: 'jordan-marketing' },
  });
  f.env.SLACK_REVIEWER_MAP = JSON.stringify({ Morgan: { ...recipient, channelId: 'C44444444', channelName: 'morgan-compliance' } });
}
const routedAction = (id, actionId = 'relay_accept', channelId = 'C11111111') => ({ ...action(id, actionId), channel: { id: channelId } });

test('trusted person channels route each workflow and ignore client-supplied destinations', async (t) => {
  const f = fixture();
  personRouting(f);
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: '123456.000001' }); });
  for (const example of [
    { input: { ...notice(), owner: 'Sofia' }, path: '/v1/notifications', channel: 'C22222222', name: 'sofia-marketing', reviewer: false },
    { input: proposal(), path: '/v1/proposals', channel: 'C11111111', name: 'alex-marketing', reviewer: true },
    { input: { ...notice('revision_requested'), owner: 'Jordan' }, path: '/v1/notifications', channel: 'C33333333', name: 'jordan-marketing', reviewer: true },
  ]) {
    const input = { ...example.input, recipient: { channelId: 'C99999999' }, reviewerNotification: { recipient: { channelId: 'C99999999' } } };
    const response = await f.call(example.path, { token: await f.connect(), body: input });
    assert.equal(response.status, 201);
    const record = await response.json();
    assert.equal(record.recipient.channelId, example.channel);
    assert.equal(record.recipient.channelName, example.name);
    assert.equal(messages.at(-1).channel, example.channel);
    assert.ok(record.slackMessageUrl.includes(`/archives/${example.channel}/`));
    assert.deepEqual(record.sourceSnapshot.assetVersion, example.input.assetVersion);
    assert.equal(Boolean(record.reviewerNotification), example.reviewer);
    if (example.reviewer) {
      assert.equal(record.reviewerNotification.recipient.channelId, 'C44444444');
      assert.equal(record.reviewerNotification.delivery, 'not_sent');
    }
  }
});

test('accepted, changed, and acknowledged responses return once to the snapshotted reviewer channel', async (t) => {
  for (const outcome of ['accepted', 'changes_requested', 'acknowledged']) {
    const f = fixture();
    personRouting(f);
    const posts = [];
    const updates = [];
    let modal;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith('chat.postMessage')) posts.push(body);
      if (url.endsWith('chat.update')) updates.push(body);
      if (url.endsWith('views.open')) modal = body.view;
      return Response.json({ ok: true, ts: '123456.000001' });
    });
    const token = await f.connect();
    const path = outcome === 'acknowledged' ? '/v1/notifications' : '/v1/proposals';
    const record = await (await f.call(path, { token, body: outcome === 'acknowledged' ? notice('revision_requested') : proposal() })).json();
    // A later configuration edit must not redirect an in-flight decision or update.
    f.env.SLACK_OWNER_MAP = JSON.stringify({ Alex: { userId: 'U87654321', displayName: 'Replacement', isProxy: true, channelId: 'C88888888', channelName: 'new-marketing' } });
    f.env.SLACK_REVIEWER_MAP = JSON.stringify({ Morgan: { userId: 'U87654321', displayName: 'Replacement', isProxy: true, channelId: 'C99999999', channelName: 'new-compliance' } });
    const actionId = outcome === 'acknowledged' ? 'relay_acknowledge' : outcome === 'changes_requested' ? 'relay_changes' : 'relay_accept';
    const payload = routedAction(record.id, actionId);
    assert.ok([400, 409].includes((await f.interact({ ...payload, channel: { id: 'C88888888' } })).status));
    assert.equal((await f.interact({ ...payload, user: { id: 'U87654321' } })).status, 403);
    if (outcome === 'changes_requested') {
      assert.equal((await f.interact(payload)).status, 200);
      const submission = { type: 'view_submission', team: payload.team, user: payload.user, view: { callback_id: modal.callback_id, private_metadata: modal.private_metadata, state: { values: { creative_feedback: { feedback: { value: 'Keep the original CTA.' } } } } } };
      const forged = structuredClone(submission);
      forged.view.private_metadata = JSON.stringify({ id: record.id, ts: '123456.000001', channelId: 'C88888888' });
      assert.equal((await f.interact(forged)).status, 409);
      assert.equal((await f.interact(submission)).status, 200);
      assert.equal((await (await f.interact(submission)).json()).response_action, 'errors');
    } else {
      const results = await Promise.all([f.interact(payload), f.interact(payload)]);
      assert.ok(results.every(response => response.status === 200));
    }
    await Promise.all(f.pending);
    await f.interact(payload);
    await Promise.all(f.pending);
    const result = await (await f.call(`${path}/${record.id}`, { token })).json();
    assert.equal(result.status, outcome);
    assert.equal(result.reviewerNotification.delivery, 'sent');
    assert.match(result.reviewerNotification.slackMessageUrl, /\/archives\/C44444444\//);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].channel, 'C44444444');
    assert.ok(posts[1].blocks.some(block => block.text?.text.includes('Charlie, acting for Alex')));
    assert.ok(posts[1].blocks.some(block => block.text?.text.includes('Charlie receives this update on behalf of Morgan')));
    assert.ok(posts[1].blocks.some(block => block.text?.text.includes('Placement: Hero')));
    assert.ok(posts[1].blocks.some(block => block.elements?.some(element => element.url === record.slackMessageUrl)));
    assert.ok(updates.every(update => update.channel === 'C11111111'));
    if (outcome === 'acknowledged') assert.ok(posts[1].blocks.some(block => block.text?.text.includes('Receipt confirmed. The asset still needs revision')));
    if (outcome === 'changes_requested') assert.equal(result.feedback, 'Keep the original CTA.');
  }
});

test('failed or uncertain reviewer notices never undo the decision or repost on callback retries', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const delivery of ['failed', 'uncertain']) {
    const f = fixture();
    personRouting(f);
    let posts = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url.endsWith('chat.postMessage')) {
        posts++;
        if (JSON.parse(options.body).channel === 'C44444444') {
          if (delivery === 'uncertain') throw new DOMException('Timeout', 'TimeoutError');
          return Response.json({ ok: false, error: 'not_in_channel' });
        }
      }
      return Response.json({ ok: true, ts: '123456.000001' });
    });
    const token = await f.connect();
    const record = await (await f.call('/v1/proposals', { token, body: proposal() })).json();
    await f.interact(routedAction(record.id));
    await Promise.all(f.pending);
    const saved = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
    assert.equal(saved.status, 'accepted');
    assert.equal(saved.reviewerNotification.delivery, delivery);
    assert.equal(saved.reviewerNotification.slackMessageUrl, null);
    await f.interact(routedAction(record.id));
    await Promise.all(f.pending);
    assert.equal(posts, 2);
    assert.deepEqual(await (await f.call(`/v1/proposals/${record.id}`, { token })).json(), saved);
  }
});

test('legacy cards use their saved channel after owner and fallback routing changes', async (t) => {
  const f = fixture();
  const updates = [];
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('chat.update')) updates.push(JSON.parse(options.body));
    if (url.endsWith('chat.postMessage')) posts++;
    return Response.json({ ok: true, ts: '123456.000001' });
  });
  for (const kind of ['proposal', 'notification']) {
    const token = await f.connect();
    const path = kind === 'proposal' ? '/v1/proposals' : '/v1/notifications';
    const record = await (await f.call(path, { token, body: kind === 'proposal' ? proposal() : notice('revision_requested') })).json();
    const recipient = { owner: 'Alex', slackUserId: 'U12345678', displayName: 'Demo recipient', isProxy: true };
    f.sql.prepare(`UPDATE ${kind === 'proposal' ? 'proposals' : 'notifications'} SET recipient_json = ?, reviewer_json = NULL WHERE id = ?`).run(JSON.stringify(recipient), record.id);
    personRouting(f);
    f.env.SLACK_CHANNEL_ID = 'C99999999';
    const payload = action(record.id, kind === 'proposal' ? 'relay_accept' : 'relay_acknowledge');
    assert.equal((await f.interact(payload)).status, 200);
    await Promise.all(f.pending);
    assert.equal(updates.at(-1).channel, 'C_DEMO');
    assert.equal((await (await f.call(`${path}/${record.id}`, { token })).json()).reviewerNotification, null);
    f.env.SLACK_CHANNEL_ID = 'C_DEMO';
    f.env.SLACK_OWNER_MAP = JSON.stringify({ Alex: { userId: 'U12345678', displayName: 'Demo recipient', isProxy: true } });
    delete f.env.SLACK_REVIEWER_MAP;
  }
  assert.equal(posts, 2);
});

test('uncertain person-channel sends recover only in their original destination', async (t) => {
  const f = fixture();
  personRouting(f);
  delete f.env.SLACK_REVIEWER_MAP;
  const updates = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('chat.postMessage')) throw new DOMException('Timeout', 'TimeoutError');
    updates.push(JSON.parse(options.body));
    return Response.json({ ok: true });
  });
  const token = await f.connect();
  const input = proposal();
  assert.equal((await f.call('/v1/proposals', { token, body: input })).status, 502);
  const record = await (await f.call('/v1/proposals', { token, body: input })).json();
  f.env.SLACK_OWNER_MAP = JSON.stringify({ Alex: { userId: 'U12345678', displayName: 'Charlie', isProxy: true, channelId: 'C88888888', channelName: 'new-channel' } });
  assert.equal((await f.interact(routedAction(record.id, 'relay_accept', 'C88888888'))).status, 400);
  assert.equal(f.sql.prepare('SELECT slack_ts FROM proposals WHERE id = ?').get(record.id).slack_ts, null);
  assert.equal((await f.interact(routedAction(record.id))).status, 200);
  await Promise.all(f.pending);
  const accepted = await (await f.call(`/v1/proposals/${record.id}`, { token })).json();
  assert.equal(accepted.status, 'accepted');
  assert.match(accepted.slackMessageUrl, /\/archives\/C11111111\//);
  assert.equal(updates[0].channel, 'C11111111');
});

test('invalid trusted routing fails before consuming the send budget or calling Slack', async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ ok: true, ts: '123456.000001' }); });
  const token = await f.connect();
  for (const override of [
    { channelId: 'https://evil.example' }, { channelId: 'D12345678' }, { channelName: 'missing-id' },
    { channelId: 'C11111111', channelName: '<@U12345678>' }, { channelId: 'C11111111', channelName: 42 },
  ]) {
    f.env.SLACK_OWNER_MAP = JSON.stringify({ Alex: { userId: 'U12345678', displayName: 'Charlie', isProxy: true, ...override } });
    assert.equal((await f.call('/v1/proposals', { token, body: proposal() })).status, 503);
  }
  personRouting(f);
  f.env.SLACK_REVIEWER_MAP = 'not-json';
  assert.equal((await f.call('/v1/proposals', { token, body: proposal() })).status, 503);
  assert.equal(f.sql.prepare('SELECT send_count FROM sessions').get().send_count, 0);
  assert.equal(calls, 0);
});

test('person-channel migration preserves existing snapshots and starts with no reviewer route', () => {
  const sql = new DatabaseSync(':memory:');
  const legacySchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').split('\n').filter(line => !/reviewer_(json|delivery|slack_url)/.test(line)).join('\n');
  sql.exec(legacySchema);
  sql.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run('session', 'created', 'expires');
  sql.prepare('INSERT INTO proposals (id, session_hash, request_id, payload_json, created_at, updated_at, slack_url) VALUES (?, ?, ?, ?, ?, ?, ?)').run('proposal', 'session', 'request', JSON.stringify(proposal()), 'created', 'updated', 'https://charlie-assistants.slack.com/archives/C_DEMO/p123456000001');
  sql.exec(readFileSync(new URL('./migrations/0005_person_channels.sql', import.meta.url), 'utf8'));
  const migrated = sql.prepare('SELECT * FROM proposals').get();
  assert.equal(migrated.reviewer_json, null);
  assert.equal(migrated.reviewer_delivery, 'not_sent');
  assert.equal(migrated.reviewer_slack_url, null);
  assert.match(migrated.slack_url, /C_DEMO/);
  assert.equal(JSON.parse(migrated.payload_json).assetVersion.id, 2);
});


test('connection routing summarizes configured channels without replacing the legacy fallback', async () => {
  const f = fixture();
  personRouting(f);
  const response = await f.call('/v1/sessions', { method: 'POST', token: f.env.DEMO_SETUP_KEY });
  const connected = await response.json();
  assert.equal(response.status, 201);
  assert.equal(connected.channel, '#relay-demo');
  assert.deepEqual(connected.routing.reviewers, [{ name: 'Morgan', channelId: 'C44444444', channelName: 'morgan-compliance' }]);
  assert.equal(connected.routing.owners.length, 3);
  assert.ok(connected.routing.owners.every(route => Object.keys(route).sort().join(',') === 'channelId,channelName,name'));
});

test('image-only Slack handoffs bind jurisdiction and affiliate scope without changing blank source copy', async t => {
  for (const kind of ['proposal', 'notification']) {
    const f = fixture(); const messages = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: '123456.000001' }); });
    const token = await f.connect();
    const input = kind === 'proposal' ? proposal() : notice('approved');
    input.assetVersion.content = { headline: '', body: '', disclosure: '', cta: '', art: 'sunrise' };
    if (kind === 'proposal') input.originalContent = { ...input.assetVersion.content };
    input.assetVersion.scope.jurisdiction = 'California';
    input.assetVersion.scope.affiliatePartner = 'Homewise';
    const path = kind === 'proposal' ? '/v1/proposals' : '/v1/notifications';
    const response = await f.call(path, { token, body: input });
    assert.equal(response.status, 201);
    const record = await response.json();
    assert.deepEqual(record.sourceSnapshot.assetVersion, input.assetVersion);
    const text = JSON.stringify(messages[0].blocks);
    assert.match(text, /Jurisdiction: California/); assert.match(text, /Affiliate partner: Homewise/);
    assert.ok(text.includes(input.title));
    if (kind === 'proposal') {
      assert.match(text, /Original wording is in the submitted image; no transcript was supplied/);
      assert.ok(!text.includes(`Before: ${input.title}`));
    }
    const changed = structuredClone(input); changed.assetVersion.scope.jurisdiction = 'Other US jurisdiction';
    assert.equal((await f.call(path, { token, body: changed })).status, 409);
    const otherPartner = structuredClone(input); otherPartner.assetVersion.scope.affiliatePartner = 'None';
    assert.equal((await f.call(path, { token, body: otherPartner })).status, 409);
    assert.equal(messages.length, 1);
  }
});
