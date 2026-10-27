# Small-business website template

A fast, accessible, dependency-free website for a local service business, with a hardened
enquiry form backed by Supabase and deployed on Vercel.

- **Zero runtime dependencies.** Nothing to patch, nothing to supply-chain compromise.
- **Content lives in one file:** `site.config.json`. Pages, sitemap, robots, structured data and
  `security.txt` are generated from it.
- **Security first:** strict CSP with no inline code, full security-header set, origin-checked
  and rate-limited API, deny-by-default database. See `SECURITY.md`.
- **Production gate:** a production build refuses to ship placeholder content.

## Quick start

```bash
npm run check            # builds the site and runs all 57 tests (Node 20+, no install step)
npm run build            # preview build into dist/
```

## Set up a new client (about 30 minutes)

1. **Edit `site.config.json`**: business details, services, areas, FAQ, real reviews (each needs
   a `source`), registrations. Set `"demo": false` and a real `siteUrl`.
2. **Supabase:** create a project, then run `supabase/migrations/0001_enquiries.sql` in the SQL editor.
3. **Vercel:** import the repo. Add the variables from `.env.example` (Settings → Environment Variables).
   - `SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never prefix it for the browser.
   - `IP_HASH_SECRET`: `openssl rand -hex 32`
4. **Deploy.** Production builds fail with a list of anything still a placeholder.
5. **Submit a test enquiry** and confirm it appears in `public.enquiries`.
6. Replace `src/assets/favicon.svg` and, if you want link previews, add a PNG `og:image`.

## Project layout

```
site.config.json        all business content (single source of truth)
scripts/build.mjs       static build (+ lib/: templating, config validation, pages)
src/assets/             styles.css, app.js, favicon.svg
api/enquiry.js          Vercel function (thin adapter)
lib/handler.js          all API logic, platform independent
lib/validate.js         allow-list validation
supabase/migrations/    schema, RLS, rate-limited insert function
test/                   57 tests (node:test, no dependencies)
vercel.json             headers, caching, function config
```

## What this template does NOT include (be honest with clients)

- **No admin panel.** Content is edited in `site.config.json` and redeployed. Enquiries are read in
  the Supabase table editor and, if configured, emailed (Resend). A password-protected admin is a
  separate, larger piece of work and enlarges the attack surface.
- **No Google reviews feed.** Reviews are entered in the config by hand, with their source.
- **No analytics and no cookies** (so no cookie banner is needed).
- **Not yet measured:** Lighthouse / Core Web Vitals, real-browser rendering, and a live Vercel +
  Supabase deployment have not been run by the author of this template. Do these before first sale.
- **Legal text is generic.** The privacy notice and accessibility statement are sensible starting
  points, not legal advice. Have the business owner confirm them.
