import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'site-'));
const cfg = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let files;
let pages;
before(() => {
  execFileSync('node', [join(root, 'scripts/build.mjs'), '--out', out], { stdio: 'pipe' });
  files = walk(out);
  pages = files.filter((f) => f.endsWith('.html'));
});

const read = (p) => readFileSync(p, 'utf8');
const routeToFile = (route) => {
  const clean = route.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return join(out, 'index.html');
  return [join(out, `${clean}.html`), join(out, clean)].find(existsSync);
};

test('expected files are produced', () => {
  for (const f of ['index.html', 'privacy.html', 'accessibility.html', 'thanks.html', 'problem.html', '404.html', 'sitemap.xml', 'robots.txt', 'favicon.svg', '.well-known/security.txt']) {
    assert.ok(existsSync(join(out, f)), f);
  }
  for (const s of cfg.services) assert.ok(existsSync(join(out, 'services', `${s.slug}.html`)), s.slug);
});

test('no inline scripts or styles anywhere (CSP safe)', () => {
  for (const p of pages) {
    const html = read(p);
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    for (const attrs of scripts) {
      assert.ok(/src=|type="application\/ld\+json"/.test(attrs), `${p}: inline script ${attrs}`);
    }
    assert.ok(!/\sstyle=/.test(html), `${p}: inline style attribute`);
    assert.ok(!/<style\b/.test(html), `${p}: <style> block`);
    assert.ok(!/\son[a-z]+=/i.test(html), `${p}: inline event handler`);
    assert.ok(!/javascript:/i.test(html), `${p}: javascript: URL`);
  }
});

test('no third-party resources are loaded', () => {
  for (const p of pages) {
    const html = read(p);
    for (const m of html.matchAll(/\b(?:src|href|action)="(https?:\/\/[^"]+)"/g)) {
      const url = new URL(m[1]);
      const own = new URL(cfg.siteUrl).host;
      const isLink = /<a\b[^>]*href="/.test(html) && m[0].startsWith('href');
      assert.ok(url.host === own || isLink, `${p}: external resource ${m[1]}`);
    }
    assert.ok(!/<(?:link|script|img|iframe)\b[^>]*(?:src|href)="https?:\/\/(?!brightwell)/.test(html.replace(/<link rel="canonical"[^>]*>/g, '')), `${p}: external subresource`);
  }
});

test('every page has lang, title, description, canonical, one h1 and a main landmark', () => {
  for (const p of pages) {
    const html = read(p);
    assert.match(html, /<html lang="en-GB">/, p);
    assert.match(html, /<title>[^<]{10,}<\/title>/, p);
    assert.match(html, /<meta name="description" content="[^"]{20,}">/, p);
    assert.match(html, /<link rel="canonical" href="https:\/\//, p);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${p}: h1 count`);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, `${p}: main count`);
    assert.match(html, /class="skip-link"/, p);
  }
});

test('ids are unique per page and every aria-describedby/controls target exists', () => {
  for (const p of pages) {
    const html = read(p);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${p}: duplicate ids`);
    for (const m of html.matchAll(/aria-(?:describedby|controls)="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) assert.ok(ids.includes(id), `${p}: missing #${id}`);
    }
  }
});

test('every form control has a label, and images have alt text', () => {
  const html = read(join(out, 'index.html'));
  const ids = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\sid="([^"]+)"[^>]*>/g)]
    .filter((m) => !/type="hidden"/.test(m[0]))
    .map((m) => m[1]);
  assert.ok(ids.length >= 8);
  for (const id of ids) assert.match(html, new RegExp(`<label for="${id}"`), `no label for #${id}`);
  for (const p of pages) for (const m of read(p).matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\balt="/, `${p}: img without alt`);
});

test('all internal links and anchors resolve', () => {
  const homeIds = new Set([...read(join(out, 'index.html')).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const p of pages) {
    for (const m of read(p).matchAll(/\shref="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:)/.test(href)) continue;
      if (href.startsWith('/assets/') || href === '/favicon.svg') {
        assert.ok(existsSync(join(out, href)), `${p}: missing ${href}`);
        continue;
      }
      assert.ok(routeToFile(href), `${p}: broken link ${href}`);
      const hash = href.split('#')[1];
      if (hash && href.startsWith('/')) assert.ok(homeIds.has(hash), `${p}: missing anchor #${hash}`);
    }
  }
});

test('assets are content-hashed and referenced pages exist', () => {
  const assets = files.filter((f) => f.includes('/assets/'));
  assert.equal(assets.length, 2);
  for (const a of assets) assert.match(a, /\.[0-9a-f]{10}\.(?:css|js)$/);
});

test('sitemap lists only indexable pages; robots blocks the API; security.txt is present', () => {
  const sitemap = read(join(out, 'sitemap.xml'));
  assert.match(sitemap, /<loc>https:\/\/[^<]+\/<\/loc>/);
  for (const noindex of ['thanks', 'problem', '404']) assert.ok(!sitemap.includes(noindex), noindex);
  for (const s of cfg.services) assert.ok(sitemap.includes(`/services/${s.slug}`), s.slug);
  assert.match(read(join(out, 'robots.txt')), /Disallow: \/api\//);
  const sec = read(join(out, '.well-known/security.txt'));
  assert.match(sec, /^Contact: mailto:/m);
  assert.match(sec, /^Expires: \d{4}-\d{2}-\d{2}T/m);
  for (const f of ['thanks', 'problem', '404']) assert.match(read(join(out, `${f}.html`)), /<meta name="robots" content="noindex">/);
});

test('JSON-LD is valid JSON and contains no review ratings', () => {
  const html = read(join(out, 'index.html'));
  const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(ld);
  const data = JSON.parse(ld[1]);
  assert.equal(data['@type'], 'Electrician');
  assert.ok(!('aggregateRating' in data) && !('review' in data));
});

test('templating escapes hostile config values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hostile-'));
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
  const evil = structuredClone(cfg);
  evil.business.name = '<img src=x onerror=alert(1)>';
  evil.business.areas = ['</script><script>alert(2)</script>'];
  evil.faq[0].a = '"><script>alert(3)</script>';
  writeFileSync(join(dir, 'site.config.json'), JSON.stringify(evil));
  const target = join(dir, 'dist');
  execFileSync('node', [join(dir, 'scripts/build.mjs'), '--out', target], { stdio: 'pipe' });
  const html = read(join(target, 'index.html'));
  assert.ok(!html.includes('<img src=x'), 'name not escaped');
  assert.ok(!/<script>alert/.test(html), 'script injected');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.ok(!ld.includes('</script>') && !ld.includes('<'), 'ld+json can break out of its block');
  rmSync(dir, { recursive: true, force: true });
});

test('production builds refuse placeholder content', () => {
  const r = spawnSync('node', [join(root, 'scripts/build.mjs'), '--production', '--out', join(out, 'prod')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /demo is still true/);
  assert.ok(!existsSync(join(out, 'prod', 'index.html')));
});

test('vercel.json: strict CSP and the full security-header set', () => {
  const rule = vercel.headers.find((h) => h.source === '/(.*)');
  const get = (k) => rule.headers.find((h) => h.key === k)?.value;
  const csp = get('Content-Security-Policy');
  for (const must of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'", 'upgrade-insecure-requests']) {
    assert.ok(csp.includes(must), `CSP missing ${must}`);
  }
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), 'CSP is not strict');
  assert.match(get('Strict-Transport-Security'), /max-age=(\d+)/);
  assert.ok(Number(get('Strict-Transport-Security').match(/max-age=(\d+)/)[1]) >= 31536000);
  assert.equal(get('X-Content-Type-Options'), 'nosniff');
  assert.equal(get('X-Frame-Options'), 'DENY');
  assert.ok(get('Referrer-Policy') && get('Permissions-Policy') && get('Cross-Origin-Opener-Policy') && get('Cross-Origin-Resource-Policy'));
  assert.ok(vercel.headers.some((h) => h.source === '/api/(.*)' && /no-store/.test(h.headers[0].value)));
});

test('client script never uses dangerous sinks', () => {
  const js = read(join(root, 'src/assets/app.js'));
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.cookie']) {
    assert.ok(!js.includes(bad), `app.js uses ${bad}`);
  }
});

test('no secrets or real keys are present in the repository', () => {
  const skip = ['node_modules', 'dist', '.git'];
  const all = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (skip.includes(e.name)) return [];
      const p = join(dir, e.name);
      return e.isDirectory() ? all(p) : [p];
    });
  for (const f of all(root)) {
    if (/\.test\.js$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(text), `JWT-like token in ${f}`);
    assert.ok(!/(?:sk|re|rk)_(?:live|test)?_?[A-Za-z0-9]{24,}/.test(text), `API-key-like string in ${f}`);
  }
  assert.ok(!existsSync(join(root, '.env')));
});

test('database migration: RLS on, public roles revoked, function locked down', () => {
  const sql = read(join(root, 'supabase/migrations/0001_enquiries.sql'));
  for (const t of ['enquiries', 'enquiry_rate_limits']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `RLS ${t}`);
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`), `revoke ${t}`);
  }
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public, pg_temp/);
  assert.match(sql, /revoke all on function public\.submit_enquiry\(jsonb, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.submit_enquiry\(jsonb, text\) to service_role/);
  assert.ok(!/create policy/i.test(sql), 'no public policies expected');
  assert.ok(!/grant .* to (anon|authenticated|public)/i.test(sql));
});
