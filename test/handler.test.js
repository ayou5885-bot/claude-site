import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEnquiry, MAX_BODY_BYTES } from '../lib/handler.js';

const services = ['fuse-boxes', 'rewiring'];
const baseEnv = {
  SITE_URL: 'https://www.example-business.co.uk',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
  IP_HASH_SECRET: 'x'.repeat(40),
};
const body = (over = {}) =>
  JSON.stringify({
    name: 'Jane Smith',
    phone: '02079460123',
    email: 'jane@example.co.uk',
    service: 'fuse-boxes',
    message: 'My fuse box keeps tripping.',
    consent: true,
    company_website: '',
    ms: 9000,
    ...over,
  });
const req = (over = {}) => ({
  method: 'POST',
  headers: { origin: 'https://www.example-business.co.uk', 'content-type': 'application/json' },
  rawBody: body(),
  ip: '203.0.113.7',
  ...over,
});

function fakeFetch(handlers = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [prefix, fn] of Object.entries(handlers)) if (String(url).startsWith(prefix)) return fn(url, init);
    return new Response(JSON.stringify('00000000-0000-0000-0000-000000000000'), { status: 200 });
  };
  impl.calls = calls;
  return impl;
}
const quiet = () => {};
const run = (r, env = baseEnv, fetch = fakeFetch(), extra = {}) => handleEnquiry(r, env, { fetch, services, log: quiet, ...extra });

test('happy path stores the enquiry via the RPC with the service-role key', async () => {
  const fetch = fakeFetch();
  const out = await run(req(), baseEnv, fetch);
  assert.equal(out.status, 200);
  assert.deepEqual(JSON.parse(out.body), { ok: true });
  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://abc.supabase.co/rest/v1/rpc/submit_enquiry');
  assert.equal(call.init.headers.authorization, 'Bearer service-role-secret-value');
  const sent = JSON.parse(call.init.body);
  assert.equal(sent.p_ip_hash.length, 64);
  assert.notEqual(sent.p_ip_hash, '203.0.113.7');
  assert.ok(!call.init.body.includes('203.0.113.7'), 'raw IP must never be sent');
  assert.deepEqual(Object.keys(sent.p_payload).sort(), ['email', 'message', 'name', 'phone', 'postcode', 'service']);
});

test('same IP hashes the same, different IPs differ', async () => {
  const a = fakeFetch(), b = fakeFetch(), c = fakeFetch();
  await run(req(), baseEnv, a);
  await run(req(), baseEnv, b);
  await run(req({ ip: '198.51.100.9' }), baseEnv, c);
  const h = (f) => JSON.parse(f.calls[0].init.body).p_ip_hash;
  assert.equal(h(a), h(b));
  assert.notEqual(h(a), h(c));
});

test('only POST is accepted', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const out = await run(req({ method }));
    assert.equal(out.status, 405, method);
    assert.equal(out.headers.allow, 'POST');
  }
});

test('cross-site and origin-less posts are rejected (CSRF)', async () => {
  const fetch = fakeFetch();
  for (const headers of [
    { 'content-type': 'application/json', origin: 'https://evil.example' },
    { 'content-type': 'application/json', origin: 'null' },
    { 'content-type': 'application/json' },
    { 'content-type': 'application/json', origin: 'https://www.example-business.co.uk.evil.example' },
    { 'content-type': 'application/json', origin: 'http://www.example-business.co.uk' },
  ]) {
    assert.equal((await run(req({ headers }), baseEnv, fetch)).status, 403, JSON.stringify(headers));
  }
  assert.equal(fetch.calls.length, 0);
});

test('fails closed when no origin is configured', async () => {
  const { SITE_URL, ...env } = baseEnv;
  assert.equal((await run(req(), env)).status, 403);
});

test('preview origin is accepted only when explicitly enabled', async () => {
  const headers = { origin: 'https://site-git-x.vercel.app', 'content-type': 'application/json' };
  assert.equal((await run(req({ headers }), { ...baseEnv, VERCEL_URL: 'site-git-x.vercel.app' })).status, 403);
  assert.equal((await run(req({ headers }), { ...baseEnv, VERCEL_URL: 'site-git-x.vercel.app', ALLOW_VERCEL_PREVIEW: '1' })).status, 200);
});

test('rejects unsupported content types', async () => {
  for (const type of ['text/plain', 'multipart/form-data', 'application/xml', '']) {
    const out = await run(req({ headers: { origin: baseEnv.SITE_URL, 'content-type': type } }));
    assert.equal(out.status, 415, type);
  }
});

test('rejects oversized bodies before parsing', async () => {
  const out = await run(req({ rawBody: body({ message: 'x'.repeat(MAX_BODY_BYTES) }) }));
  assert.equal(out.status, 413);
});

test('rejects malformed JSON without leaking details', async () => {
  const out = await run(req({ rawBody: '{"name": ' }));
  assert.equal(out.status, 400);
  assert.deepEqual(JSON.parse(out.body), { ok: false, error: 'bad_request' });
});

test('validation errors return 422 with field messages and never reach the database', async () => {
  const fetch = fakeFetch();
  const out = await run(req({ rawBody: body({ email: 'nope', consent: false }) }), baseEnv, fetch);
  assert.equal(out.status, 422);
  const parsed = JSON.parse(out.body);
  assert.ok(parsed.errors.email && parsed.errors.consent);
  assert.equal(fetch.calls.length, 0);
});

test('spam gets a fake success and nothing is stored', async () => {
  const fetch = fakeFetch();
  for (const over of [{ company_website: 'http://x' }, { ms: 100 }]) {
    const out = await run(req({ rawBody: body(over) }), baseEnv, fetch);
    assert.equal(out.status, 200);
    assert.deepEqual(JSON.parse(out.body), { ok: true });
  }
  assert.equal(fetch.calls.length, 0);
});

test('database rate-limit maps to 429 with Retry-After', async () => {
  const fetch = fakeFetch({
    'https://abc.supabase.co': () => new Response(JSON.stringify({ code: 'P0001', message: 'rate_limited' }), { status: 400 }),
  });
  const out = await run(req(), baseEnv, fetch);
  assert.equal(out.status, 429);
  assert.equal(out.headers['retry-after'], '600');
});

test('database failures are generic and leak nothing', async () => {
  const secretish = 'relation "enquiries" does not exist; key=service-role-secret-value';
  const fetch = fakeFetch({
    'https://abc.supabase.co': () => new Response(JSON.stringify({ message: secretish }), { status: 500 }),
  });
  const out = await run(req(), baseEnv, fetch);
  assert.equal(out.status, 502);
  assert.ok(!out.body.includes('relation'));
  assert.ok(!out.body.includes('service-role-secret-value'));
});

test('network failure to the database returns 502', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await run(req(), baseEnv, fetch)).status, 502);
});

test('misconfiguration fails closed with 503', async () => {
  for (const patch of [{ SUPABASE_SERVICE_ROLE_KEY: '' }, { IP_HASH_SECRET: 'short' }, { SUPABASE_URL: 'http://insecure.example.com' }, { SUPABASE_URL: 'not a url' }]) {
    const out = await run(req(), { ...baseEnv, ...patch });
    assert.equal(out.status, 503, JSON.stringify(patch));
  }
});

test('local http Supabase is allowed for development only on localhost', async () => {
  assert.equal((await run(req(), { ...baseEnv, SUPABASE_URL: 'http://127.0.0.1:54321' })).status, 200);
});

test('Turnstile: missing or failing token is rejected, valid token accepted', async () => {
  const env = { ...baseEnv, TURNSTILE_SECRET: 'ts-secret' };
  const ok = fakeFetch({ 'https://challenges.cloudflare.com': () => new Response(JSON.stringify({ success: true }), { status: 200 }) });
  const no = fakeFetch({ 'https://challenges.cloudflare.com': () => new Response(JSON.stringify({ success: false }), { status: 200 }) });
  assert.equal((await run(req(), env, ok)).status, 400, 'no token');
  assert.equal((await run(req({ rawBody: body({ 'cf-turnstile-response': 'tok' }) }), env, no)).status, 400, 'failed challenge');
  assert.equal((await run(req({ rawBody: body({ 'cf-turnstile-response': 'tok' }) }), env, ok)).status, 200, 'valid');
});

test('notification email is sent as plain text and its failure does not fail the request', async () => {
  const env = { ...baseEnv, RESEND_API_KEY: 're_key', NOTIFY_TO: 'owner@example.co.uk', NOTIFY_FROM: 'Site <a@example.co.uk>' };
  const fetch = fakeFetch();
  assert.equal((await run(req({ rawBody: body({ message: '<img src=x onerror=alert(1)> big job here' }) }), env, fetch)).status, 200);
  const mail = fetch.calls.find((c) => c.url === 'https://api.resend.com/emails');
  const payload = JSON.parse(mail.init.body);
  assert.ok(payload.text && !payload.html, 'plain text only');
  assert.equal(payload.reply_to, 'jane@example.co.uk');

  const failing = fakeFetch({ 'https://api.resend.com': () => { throw new Error('down'); } });
  assert.equal((await run(req(), env, failing)).status, 200);
});

test('no-JS form posts redirect instead of returning JSON', async () => {
  const form = new URLSearchParams({
    name: 'Jane Smith', phone: '02079460123', email: 'jane@example.co.uk', service: 'rewiring',
    message: 'Need a rewire for a flat.', consent: 'true', company_website: '',
  }).toString();
  const headers = { origin: baseEnv.SITE_URL, 'content-type': 'application/x-www-form-urlencoded' };
  const ok = await run(req({ headers, rawBody: form }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/thanks');
  const bad = await run(req({ headers, rawBody: 'name=x' }));
  assert.equal(bad.status, 303);
  assert.equal(bad.headers.location, '/problem');
});

test('responses are never cacheable and set nosniff', async () => {
  for (const out of [await run(req()), await run(req({ method: 'GET' })), await run(req({ rawBody: '{' }))]) {
    assert.equal(out.headers['cache-control'], 'no-store');
    assert.equal(out.headers['x-content-type-options'], 'nosniff');
  }
});

test('prototype-pollution payloads in the body do not affect the process', async () => {
  const raw = '{"__proto__":{"polluted":true},"name":"Jane Smith","phone":"02079460123","email":"jane@example.co.uk","service":"fuse-boxes","message":"Long enough message","consent":true,"ms":9000}';
  const out = await run(req({ rawBody: raw }));
  assert.equal(out.status, 200);
  assert.equal({}.polluted, undefined);
});
