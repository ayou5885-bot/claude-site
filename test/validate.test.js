import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnquiry, clean, LIMITS } from '../lib/validate.js';

const services = ['fuse-boxes', 'rewiring'];
const good = () => ({
  name: 'Jane Smith',
  phone: '020 7946 0123',
  email: 'Jane@Example.co.uk',
  postcode: 'e1 0aa',
  service: 'fuse-boxes',
  message: 'My fuse box is old and trips a lot.',
  consent: true,
  company_website: '',
  ms: 15000,
});

test('accepts a valid enquiry and normalises it', () => {
  const r = validateEnquiry(good(), { services });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: 'Jane Smith',
    email: 'jane@example.co.uk',
    phone: '02079460123',
    postcode: 'E1 0AA',
    service: 'fuse-boxes',
    message: 'My fuse box is old and trips a lot.',
  });
});

test('postcode is optional and becomes null', () => {
  const r = validateEnquiry({ ...good(), postcode: '   ' }, { services });
  assert.equal(r.ok, true);
  assert.equal(r.value.postcode, null);
});

test('"other" is always an allowed service', () => {
  assert.equal(validateEnquiry({ ...good(), service: 'other' }, { services }).ok, true);
});

test('rejects unknown service, missing consent, short message', () => {
  const r = validateEnquiry({ ...good(), service: 'hacking', consent: false, message: 'short' }, { services });
  assert.equal(r.ok, false);
  assert.equal(r.spam, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['consent', 'message', 'service']);
});

test('consent must be an explicit yes', () => {
  for (const consent of [undefined, 'no', 0, null, 'false']) {
    assert.equal(validateEnquiry({ ...good(), consent }, { services }).ok, false, String(consent));
  }
  for (const consent of [true, 'true', 'on']) {
    assert.equal(validateEnquiry({ ...good(), consent }, { services }).ok, true, String(consent));
  }
});

test('rejects malformed emails', () => {
  const bad = ['a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a@c..com', 'a@c.c', '<x>@c.com', `${'a'.repeat(65)}@c.com`, `a@${'b'.repeat(250)}.com`, ''];
  for (const email of bad) {
    assert.ok(validateEnquiry({ ...good(), email }, { services }).errors?.email, `should reject "${email.slice(0, 30)}"`);
  }
});

test('rejects malformed phone numbers', () => {
  for (const phone of ['abc', '123', '1234567890123456', "'; DROP TABLE enquiries;--", '+44 (0) 20 7946 012a', '']) {
    assert.ok(validateEnquiry({ ...good(), phone }, { services }).errors?.phone, phone);
  }
  assert.equal(validateEnquiry({ ...good(), phone: '+44 20 7946 0123' }, { services }).ok, true);
});

test('honeypot and instant submissions are flagged as spam, silently', () => {
  assert.deepEqual(validateEnquiry({ ...good(), company_website: 'http://spam' }, { services }), { ok: false, spam: true, errors: {} });
  assert.equal(validateEnquiry({ ...good(), ms: 300 }, { services }).spam, true);
  assert.equal(validateEnquiry({ ...good(), ms: String(LIMITS.minFillMs - 1) }, { services }).spam, true);
});

test('missing ms (no-JS form) is not treated as spam', () => {
  const { ms, ...noMs } = good();
  assert.equal(validateEnquiry(noMs, { services }).ok, true);
});

test('link-stuffed messages are rejected', () => {
  const message = 'Cheap! http://a.example http://b.example www.c.example buy now please';
  assert.ok(validateEnquiry({ ...good(), message }, { services }).errors?.message);
});

test('length limits are enforced', () => {
  assert.ok(validateEnquiry({ ...good(), message: 'x'.repeat(LIMITS.message.max + 1) }, { services }).errors?.message);
  assert.ok(validateEnquiry({ ...good(), name: 'x'.repeat(81) }, { services }).errors?.name);
  assert.ok(validateEnquiry({ ...good(), name: 'x' }, { services }).errors?.name);
});

test('non-object and prototype-pollution style inputs are handled', () => {
  for (const input of [null, undefined, 'x', 42, [], [good()]]) {
    assert.equal(validateEnquiry(input, { services }).ok, false);
  }
  const polluted = JSON.parse('{"__proto__":{"admin":true},"constructor":{"x":1}}');
  const r = validateEnquiry({ ...good(), ...polluted }, { services });
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.value).length, 6);
  assert.equal({}.admin, undefined);
});

test('control, zero-width and bidi characters are stripped; newlines kept in messages', () => {
  assert.equal(clean('a\u0000b\u200Bc\u202Ed'), 'abcd');
  const r = validateEnquiry({ ...good(), name: 'Jane\nSmith\u202E', message: 'Line one\nLine two is here' }, { services });
  assert.equal(r.value.name, 'Jane Smith');
  assert.equal(r.value.message, 'Line one\nLine two is here');
});

test('markup is not altered by validation (it is escaped on output instead)', () => {
  const r = validateEnquiry({ ...good(), message: '<script>alert(1)</script> hello there' }, { services });
  assert.equal(r.ok, true);
  assert.match(r.value.message, /<script>/);
});

test('email validation has no catastrophic backtracking', () => {
  const evil = `${'a'.repeat(60)}@${'b-'.repeat(5000)}`;
  const started = performance.now();
  validateEnquiry({ ...good(), email: evil }, { services });
  assert.ok(performance.now() - started < 200, 'validation took too long');
});
