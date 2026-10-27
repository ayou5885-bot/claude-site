# Security model

## What is protected, and how

| Threat | Control | Where |
|---|---|---|
| Cross-site scripting | Auto-escaping templates; no inline scripts/styles; CSP `default-src 'none'` + `'self'` only; client code uses `textContent`; JSON-LD escaped | `scripts/lib/html.mjs`, `vercel.json`, `app.js`, tests |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `vercel.json` |
| CSRF / cross-site form posting | Strict `Origin` allow-list (fails closed), no cookies or sessions at all | `lib/handler.js` |
| SQL injection | Parameterised RPC call; typed JSON payload; DB `CHECK` constraints repeat every rule | `submit_enquiry`, migration |
| Direct database access from browsers | RLS enabled with **no policies**; all privileges revoked from `anon`/`authenticated`; only `service_role` may call the function | migration |
| Spam and floods | Honeypot, minimum-fill-time, link limit, optional Turnstile, per-visitor limit (5 / 10 min), global limit (300 / h), 8 KB body cap | `lib/*`, migration |
| Abuse of stored IPs / privacy | IPs are HMAC-SHA256 hashed with a server secret before storage; raw IP never leaves the function | `lib/handler.js` |
| Data leakage in errors | Generic client messages; logs contain codes only, never personal data or keys | `lib/handler.js` |
| Secret exposure | All secrets are server-side env vars; `.env` is git-ignored; a test scans for key-like strings | `.env.example`, tests |
| Supply chain | No runtime or build dependencies | `package.json` |
| Downgrade / sniffing | HSTS (2 years), `upgrade-insecure-requests`, `nosniff`, COOP/CORP | `vercel.json` |
| Placeholder content going live | Production build refuses demo values | `scripts/lib/config.mjs` |

## Known limits

- The minimum-fill-time check uses a client-supplied number. It only stops naive bots.
- The global limit can be exhausted by a distributed attacker. If that matters, enable Turnstile.
- IP-based limits depend on the platform setting `x-forwarded-for` (true on Vercel).
- The service-role key is powerful. Restrict who can see Vercel env vars and rotate it if anyone leaves.
- This has not had an independent penetration test.

## Enabling Cloudflare Turnstile (optional)

1. Create a Turnstile widget and set `TURNSTILE_SECRET` in Vercel.
2. Add the widget markup to the form and extend the CSP:
   `script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com`
3. The widget adds `cf-turnstile-response` to the form; the API already verifies it.

## Data retention (matches the privacy notice)

Run on a schedule (Supabase `pg_cron`) to delete stale enquiries:

```sql
delete from public.enquiries
 where created_at < now() - interval '12 months'
   and status in ('new', 'lost', 'spam');
```

## Reporting a problem

`/.well-known/security.txt` lists the contact address (from `site.config.json`).
