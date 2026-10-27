// Zero-dependency static build: site.config.json + templates -> dist/
// Usage: node scripts/build.mjs [--production] [--out <dir>]
// Production builds (flag, or VERCEL_ENV=production) refuse to ship placeholder content.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig } from './lib/config.mjs';
import { accessibilityPage, homePage, notFoundPage, privacyPage, problemPage, servicePage, thanksPage } from './lib/pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const production = args.includes('--production') || process.env.VERCEL_ENV === 'production';
const outIndex = args.indexOf('--out');
const out = resolve(root, outIndex >= 0 ? args[outIndex + 1] : 'dist');

const cfg = loadConfig(join(root, 'site.config.json'));
const { errors, warnings } = validateConfig(cfg, { production });
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length > 0) {
  console.error(`\nBuild refused${production ? ' (production)' : ''}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
mkdirSync(join(out, 'services'), { recursive: true });
mkdirSync(join(out, '.well-known'), { recursive: true });

// Content-hashed asset names allow `immutable` caching without stale files.
function emitAsset(file) {
  const source = readFileSync(join(root, 'src/assets', file));
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 10);
  const dot = file.lastIndexOf('.');
  const name = `${file.slice(0, dot)}.${hash}${file.slice(dot)}`;
  writeFileSync(join(out, 'assets', name), source);
  return `/assets/${name}`;
}

const ctx = { cfg, assets: { css: emitAsset('styles.css'), js: emitAsset('app.js') } };
const write = (path, content) => writeFileSync(join(out, path), String(content));

write('index.html', homePage(ctx));
for (const svc of cfg.services) write(`services/${svc.slug}.html`, servicePage(ctx, svc));
write('privacy.html', privacyPage(ctx));
write('accessibility.html', accessibilityPage(ctx));
write('thanks.html', thanksPage(ctx));
write('problem.html', problemPage(ctx));
write('404.html', notFoundPage(ctx));
cpSync(join(root, 'src/assets/favicon.svg'), join(out, 'favicon.svg'));

const today = new Date(process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now());
const day = today.toISOString().slice(0, 10);
const urls = ['/', ...cfg.services.map((s) => `/services/${s.slug}`), '/privacy', '/accessibility'];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${new URL(u, cfg.siteUrl).href}</loc><lastmod>${day}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${new URL('/sitemap.xml', cfg.siteUrl).href}\n`);

// RFC 9116 security contact. Expires one year after the build.
const expires = new Date(today.getTime() + 365 * 24 * 3600 * 1000).toISOString();
write(
  '.well-known/security.txt',
  `Contact: mailto:${cfg.business.email}\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${new URL('/.well-known/security.txt', cfg.siteUrl).href}\n`,
);

console.log(`Built ${urls.length + 4} pages to ${out}${production ? ' [production]' : ' [preview]'}`);
