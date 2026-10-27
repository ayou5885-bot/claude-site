// Input validation shared by the API route and the test-suite. No dependencies.
// Principle: allow-list every field, bound every length, never trust the client.

// Control characters, zero-width and bidirectional-override characters. Tab, LF and CR are
// kept because the message field is multi-line.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export const LIMITS = Object.freeze({
  name: { min: 2, max: 80 },
  email: { max: 254, localMax: 64 },
  phone: { min: 7, max: 15 },
  postcode: { max: 10 },
  message: { min: 10, max: 2000 },
  maxLinks: 2,
  minFillMs: 2000,
});

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const POSTCODE_RE = /^[A-Z0-9 ]{2,10}$/;

export function clean(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(CONTROL_CHARS, '').trim() : '';
}

/**
 * @param {unknown} input   Parsed request body.
 * @param {{services: string[]}} options  Allow-list of service slugs ("other" is always allowed).
 * @returns {{ok: true, value: object} | {ok: false, spam: boolean, errors: Record<string,string>}}
 */
export function validateEnquiry(input, { services }) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, spam: false, errors: { _form: 'The request was not understood.' } };
  }

  // Bot traps: a hidden field a human never fills, and an implausibly fast submission.
  if (clean(input.company_website) !== '') return { ok: false, spam: true, errors: {} };
  const elapsed = Number(input.ms);
  if (input.ms !== undefined && input.ms !== '' && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < LIMITS.minFillMs) {
    return { ok: false, spam: true, errors: {} };
  }

  const errors = {};

  const name = clean(input.name).replace(/\s+/g, ' ');
  if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
    errors.name = `Enter your name (${LIMITS.name.min}–${LIMITS.name.max} characters).`;
  }

  const email = clean(input.email).toLowerCase();
  const local = email.split('@')[0] ?? '';
  if (
    email.length > LIMITS.email.max ||
    local.length > LIMITS.email.localMax ||
    email.includes('..') ||
    !EMAIL_RE.test(email) ||
    !/\.[a-z]{2,}$/.test(email)
  ) {
    errors.email = 'Enter a valid email address, like name@example.co.uk.';
  }

  const phone = clean(input.phone).replace(/[\s().-]/g, '');
  if (!PHONE_RE.test(phone)) {
    errors.phone = 'Enter a phone number using digits only (7–15 digits, a leading + is fine).';
  }

  let postcode = clean(input.postcode).toUpperCase().replace(/\s+/g, ' ');
  if (postcode !== '' && !POSTCODE_RE.test(postcode)) {
    errors.postcode = 'Enter a valid postcode, or leave this blank.';
  }
  if (postcode === '') postcode = null;

  const service = clean(input.service);
  if (![...services, 'other'].includes(service)) {
    errors.service = 'Choose one of the listed services.';
  }

  const message = clean(input.message);
  if (message.length < LIMITS.message.min || message.length > LIMITS.message.max) {
    errors.message = `Tell us a little about the job (${LIMITS.message.min}–${LIMITS.message.max} characters).`;
  } else if ((message.match(/https?:\/\/|www\./gi) ?? []).length > LIMITS.maxLinks) {
    errors.message = 'Please remove the links from your message.';
  }

  const consent = input.consent === true || input.consent === 'true' || input.consent === 'on';
  if (!consent) errors.consent = 'Please confirm that you have read the privacy notice.';

  if (Object.keys(errors).length > 0) return { ok: false, spam: false, errors };
  return { ok: true, value: { name, email, phone, postcode, service, message } };
}
