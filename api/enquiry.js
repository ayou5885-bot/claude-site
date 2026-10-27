// Vercel serverless adapter. All logic lives in ../lib/handler.js (tested without Vercel).
import { readFileSync } from 'node:fs';
import { handleEnquiry, json, MAX_BODY_BYTES } from '../lib/handler.js';

const config = JSON.parse(readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));
const services = config.services.map((service) => service.slug);

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, out) {
  res.statusCode = out.status;
  for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
  res.end(out.body);
}

export default async function handler(req, res) {
  let rawBody = '';
  if (req.method === 'POST') {
    try {
      rawBody = await readBody(req, MAX_BODY_BYTES);
    } catch {
      // Stop reading and close the connection so an oversized upload cannot tie up the socket.
      return send(res, json(413, { ok: false, error: 'payload_too_large' }, { connection: 'close' }));
    }
  }
  // On Vercel the platform sets x-forwarded-for, so the first entry is the client address.
  // If you host elsewhere, make sure a trusted proxy sets this header.
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || 'unknown';

  const out = await handleEnquiry({ method: req.method, headers: req.headers, rawBody, ip }, process.env, { services });
  send(res, out);
}
