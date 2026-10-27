// Runs the real Vercel adapter (api/enquiry.js) behind a real HTTP server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const ORIGIN = 'https://www.example-business.co.uk';
process.env.SITE_URL = ORIGIN;
process.env.SUPABASE_URL = 'https://abc.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-value';
process.env.IP_HASH_SECRET = 'y'.repeat(48);

const realFetch = globalThis.fetch;
const dbCalls = [];
let server;
let base;

before(async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://abc.supabase.co')) {
      dbCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify('11111111-1111-1111-1111-111111111111'), { status: 200 });
    }
    return realFetch(url, init);
  };
  const { default: handler } = await import('../api/enquiry.js');
  server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

const payload = (over = {}) => ({
  name: 'Jane Smith', phone: '02079460123', email: 'jane@example.co.uk', service: 'fuse-boxes',
  message: 'My fuse box keeps tripping.', consent: true, company_website: '', ms: 9000, ...over,
});
const post = (body, headers = {}) =>
  realFetch(`${base}/`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('end to end: valid enquiry is stored and the visitor IP is only ever hashed', async () => {
  const res = await post(payload(), { 'x-forwarded-for': '203.0.113.50, 10.0.0.1' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const sent = dbCalls.at(-1);
  assert.equal(sent.p_payload.service, 'fuse-boxes');
  assert.match(sent.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(sent).includes('203.0.113.50'));
});

test('service allow-list comes from site.config.json', async () => {
  assert.equal((await post(payload({ service: 'rewiring' }))).status, 200);
  assert.equal((await post(payload({ service: 'not-a-service' }))).status, 422);
});

test('real body-size cap: a 1 MB body is refused without being buffered', async () => {
  const res = await post(JSON.stringify(payload({ message: 'x'.repeat(1_000_000) })));
  assert.equal(res.status, 413);
});

test('wrong origin and wrong method are refused', async () => {
  assert.equal((await post(payload(), { origin: 'https://evil.example' })).status, 403);
  const get = await realFetch(`${base}/`, { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
});

test('responses carry no-store and nosniff', async () => {
  const res = await post(payload());
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await res.text();
});
