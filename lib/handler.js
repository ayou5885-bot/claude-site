// Enquiry endpoint logic, independent of the hosting platform so it can be tested directly.
//
// Defence layers, in the order they run:
//   1. method allow-list            2. strict Origin check (CSRF / cross-site posting)
//   3. content-type allow-list      4. hard body-size cap
//   5. optional Cloudflare Turnstile 6. allow-list schema validation + honeypot
//   7. per-IP and global rate limits inside the database function (atomic with the insert)
//   8. the database is reached only with a server-side key; browsers can never touch it
// Failures never reveal internals: clients get short, generic messages; details go to logs
// as codes only (no personal data).

import { createHmac } from 'node:crypto';
import { validateEnquiry } from './validate.js';

export const MAX_BODY_BYTES = 8 * 1024;

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(status, body, extra = {}) {
  return {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra },
    body: JSON.stringify(body),
  };
}

function redirect(location) {
  return { status: 303, headers: { ...BASE_HEADERS, location }, body: '' };
}

export function allowedOrigins(env) {
  const set = new Set();
  for (const raw of String(env.ALLOWED_ORIGINS || env.SITE_URL || '').split(',')) {
    const value = raw.trim().replace(/\/+$/, '');
    if (value) set.add(value);
  }
  if (env.ALLOW_VERCEL_PREVIEW === '1' && env.VERCEL_URL) set.add(`https://${env.VERCEL_URL}`);
  return set;
}

// Browsers always send Origin on cross-origin and same-origin POSTs. Fail closed.
function originAllowed(headers, env) {
  const allowed = allowedOrigins(env);
  const origin = headers.origin;
  return allowed.size > 0 && typeof origin === 'string' && allowed.has(origin);
}

function supabaseUrl(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function verifyTurnstile(token, ip, env, fetchImpl) {
  if (!token) return false;
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    return (await res.json()).success === true;
  } catch {
    return false;
  }
}

/**
 * @param {{method: string, headers: Record<string,string>, rawBody: string, ip: string}} req
 * @param {Record<string,string|undefined>} env
 * @param {{fetch?: typeof fetch, services?: string[], log?: Function}} deps
 */
export async function handleEnquiry(req, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const services = deps.services ?? [];
  const log = deps.log ?? ((code, extra = {}) => console.error(JSON.stringify({ at: 'enquiry', code, ...extra })));

  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
  if (!originAllowed(req.headers, env)) return json(403, { ok: false, error: 'forbidden' });

  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const isForm = contentType === 'application/x-www-form-urlencoded';
  if (contentType !== 'application/json' && !isForm) return json(415, { ok: false, error: 'unsupported_media_type' });

  const fail = (status, error, extra) =>
    isForm ? redirect('/problem') : json(status, { ok: false, error, ...extra });

  if (Buffer.byteLength(req.rawBody, 'utf8') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' });

  let data;
  try {
    data = isForm ? Object.fromEntries(new URLSearchParams(req.rawBody)) : JSON.parse(req.rawBody);
  } catch {
    return fail(400, 'bad_request');
  }

  // Fail closed if the server is not fully configured.
  const base = supabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const ipSecret = env.IP_HASH_SECRET;
  if (!base || !serviceKey || !ipSecret || ipSecret.length < 32) {
    log('misconfigured');
    return fail(503, 'unavailable');
  }

  if (env.TURNSTILE_SECRET) {
    const token = String(data?.['cf-turnstile-response'] ?? data?.turnstileToken ?? '');
    if (!(await verifyTurnstile(token, req.ip, env, fetchImpl))) return fail(400, 'challenge_failed');
  }

  const result = validateEnquiry(data, { services });
  if (!result.ok) {
    // Bots get the same "success" a human would, so they learn nothing about the traps.
    if (result.spam) return isForm ? redirect('/thanks') : json(200, { ok: true });
    return fail(422, 'validation_failed', { errors: result.errors });
  }

  const ipHash = createHmac('sha256', ipSecret).update(req.ip || 'unknown').digest('hex');

  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/submit_enquiry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_payload: result.value, p_ip_hash: ipHash }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    log('db_unreachable');
    return fail(502, 'upstream_unavailable');
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = String((await response.json())?.message ?? '');
    } catch {
      /* ignore */
    }
    if (detail === 'rate_limited' || detail === 'busy') {
      return isForm ? redirect('/problem') : json(429, { ok: false, error: 'too_many_requests' }, { 'retry-after': '600' });
    }
    log('db_error', { status: response.status });
    return fail(502, 'upstream_error');
  }

  // Optional email notification. Best effort: the enquiry is already safely stored.
  if (env.RESEND_API_KEY && env.NOTIFY_TO && env.NOTIFY_FROM) {
    const v = result.value;
    try {
      await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.NOTIFY_FROM,
          to: [env.NOTIFY_TO],
          reply_to: v.email,
          subject: `New enquiry: ${v.service} (${v.name})`,
          text: [
            `Name: ${v.name}`,
            `Phone: ${v.phone}`,
            `Email: ${v.email}`,
            `Postcode: ${v.postcode ?? '-'}`,
            `Service: ${v.service}`,
            '',
            v.message,
          ].join('\n'),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      log('notify_failed');
    }
  }

  return isForm ? redirect('/thanks') : json(200, { ok: true });
}
