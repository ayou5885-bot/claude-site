// Loads and validates site.config.json. Production builds refuse to ship placeholder content.

import { readFileSync } from 'node:fs';

const need = (cond, msg, errors) => {
  if (!cond) errors.push(msg);
};

export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateConfig(cfg, { production }) {
  const errors = [];
  const warnings = [];
  const b = cfg.business ?? {};

  need(/^https:\/\/[^/\s]+$/.test(cfg.siteUrl ?? ''), 'siteUrl must be an https origin with no path, e.g. https://www.example.co.uk', errors);
  need(typeof cfg.lang === 'string' && cfg.lang.length > 0, 'lang is required', errors);
  for (const key of ['name', 'legalName', 'phone', 'phoneHref', 'email', 'address', 'hours']) {
    need(typeof b[key] === 'string' && b[key].trim() !== '', `business.${key} is required`, errors);
  }
  need(/^\+[0-9]{8,15}$/.test(b.phoneHref ?? ''), 'business.phoneHref must be in international format, e.g. +442071234567', errors);
  need(Array.isArray(cfg.services) && cfg.services.length > 0, 'at least one service is required', errors);

  const slugs = new Set();
  for (const s of cfg.services ?? []) {
    need(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug ?? ''), `service slug "${s.slug}" must be lowercase-with-hyphens`, errors);
    need(!slugs.has(s.slug), `duplicate service slug "${s.slug}"`, errors);
    slugs.add(s.slug);
    need(['brown', 'blue', 'grey'].includes(s.tone), `service "${s.slug}" tone must be brown, blue or grey`, errors);
    need(Array.isArray(s.points) && s.points.length > 0, `service "${s.slug}" needs points`, errors);
  }

  if (production) {
    need(cfg.demo !== true, 'demo is still true. Set "demo": false once all content is real.', errors);
    need(!/example\.(com|co\.uk)/.test(cfg.siteUrl), 'siteUrl still uses an example domain', errors);
    need(!/example\./.test(b.email ?? ''), 'business.email still uses an example domain', errors);
    need(!/^020 7946 0/.test(b.phone ?? ''), 'business.phone is a reserved drama-use number (020 7946 0xxx)', errors);
    need(!/^0+$/.test(b.companyNumber ?? ''), 'business.companyNumber is still a placeholder', errors);
    need(!(b.credentials ?? []).some((c) => /example/i.test(c)), 'business.credentials still has example text', errors);
    for (const t of cfg.testimonials ?? []) {
      need(typeof t.source === 'string' && t.source.trim() !== '', 'every testimonial needs a "source" (where the review was published) before launch', errors);
    }
  } else if (cfg.demo === true) {
    warnings.push('demo content is in use: production builds will refuse to ship it.');
  }
  return { errors, warnings };
}
