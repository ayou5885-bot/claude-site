import { html, raw, safeJson } from './html.mjs';

const absolute = (cfg, path) => new URL(path, cfg.siteUrl).href;

function layout(ctx, { title, description, path, body, noindex = false, jsonld = null }) {
  const { cfg, assets } = ctx;
  const canonical = absolute(cfg, path);
  return html`<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0E2238">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${cfg.business.name}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assets.css}">
${jsonld ? raw(`<script type="application/ld+json">${safeJson(jsonld)}</script>`) : ''}
<script type="module" src="${assets.js}"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
${cfg.demo ? html`<p class="demo-banner" role="note">Demo site. The business details, reviews and prices on this page are placeholders.</p>` : ''}
${header(cfg)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(cfg)}
</body>
</html>
`;
}

function header(cfg) {
  const b = cfg.business;
  return html`<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="${b.name}, home">${b.name}</a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Main">
      <ul>
        <li><a href="/#services">Services</a></li>
        <li><a href="/#process">How it works</a></li>
        <li><a href="/#areas">Areas</a></li>
        <li><a href="/#faq">Questions</a></li>
        <li><a class="btn btn-small" href="/#contact">Get a quote</a></li>
      </ul>
    </nav>
    <a class="phone" href="tel:${b.phoneHref}">${b.phone}</a>
  </div>
</header>`;
}

function footer(cfg) {
  const b = cfg.business;
  return html`<footer class="site-footer">
  <div class="wrap foot">
    <div>
      <p class="foot-name">${b.legalName}</p>
      <p>Registered in ${b.registeredIn}, company number ${b.companyNumber}.</p>
      <p>${b.address}</p>
    </div>
    <div>
      <p><a href="tel:${b.phoneHref}">${b.phone}</a></p>
      <p><a href="mailto:${b.email}">${b.email}</a></p>
    </div>
    <ul class="foot-links">
      <li><a href="/privacy">Privacy notice</a></li>
      <li><a href="/accessibility">Accessibility</a></li>
    </ul>
  </div>
</footer>`;
}

function localBusinessLd(cfg) {
  const b = cfg.business;
  return {
    '@context': 'https://schema.org',
    '@type': 'Electrician',
    name: b.name,
    legalName: b.legalName,
    url: cfg.siteUrl,
    telephone: b.phoneHref,
    email: b.email,
    address: { '@type': 'PostalAddress', streetAddress: b.address, addressCountry: 'GB' },
    areaServed: b.areas.map((name) => ({ '@type': 'AdministrativeArea', name })),
    openingHoursSpecification: b.hoursSpec.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
  };
}

function enquiryForm(cfg) {
  const b = cfg.business;
  return html`<form class="enquiry" method="post" action="/api/enquiry" data-enquiry-form data-phone="${b.phone}" novalidate>
  <div class="field">
    <label for="f-name">Your name</label>
    <input id="f-name" name="name" type="text" autocomplete="name" required minlength="2" maxlength="80" aria-describedby="err-name">
    <p class="field-error" id="err-name" hidden></p>
  </div>
  <div class="field">
    <label for="f-phone">Phone number</label>
    <input id="f-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="25" aria-describedby="err-phone">
    <p class="field-error" id="err-phone" hidden></p>
  </div>
  <div class="field">
    <label for="f-email">Email address</label>
    <input id="f-email" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="err-email">
    <p class="field-error" id="err-email" hidden></p>
  </div>
  <div class="field">
    <label for="f-postcode">Postcode <span class="optional">(optional)</span></label>
    <input id="f-postcode" name="postcode" type="text" autocomplete="postal-code" maxlength="10" aria-describedby="err-postcode">
    <p class="field-error" id="err-postcode" hidden></p>
  </div>
  <div class="field field-wide">
    <label for="f-service">What do you need?</label>
    <select id="f-service" name="service" required aria-describedby="err-service">
      ${cfg.services.map((s) => html`<option value="${s.slug}">${s.title}</option>`)}
      <option value="other">Something else</option>
    </select>
    <p class="field-error" id="err-service" hidden></p>
  </div>
  <div class="field field-wide">
    <label for="f-message">Tell us about the job</label>
    <textarea id="f-message" name="message" rows="5" required minlength="10" maxlength="2000" aria-describedby="err-message"></textarea>
    <p class="field-error" id="err-message" hidden></p>
  </div>
  <div class="hp" aria-hidden="true">
    <label for="f-company-website">Leave this field empty</label>
    <input id="f-company-website" name="company_website" type="text" tabindex="-1" autocomplete="off">
  </div>
  <input type="hidden" name="ms" value="">
  <div class="field field-wide consent">
    <input id="f-consent" name="consent" type="checkbox" value="true" required aria-describedby="err-consent">
    <label for="f-consent">I have read the <a href="/privacy">privacy notice</a> and agree that ${b.name} may use these details to reply to my enquiry.</label>
    <p class="field-error" id="err-consent" hidden></p>
  </div>
  <div class="field-wide actions">
    <button class="btn" type="submit" data-submit>Send enquiry</button>
    <p class="form-status" role="status" aria-live="polite" data-status></p>
  </div>
</form>`;
}

export function homePage(ctx) {
  const { cfg } = ctx;
  const b = cfg.business;
  const s = cfg.hero.sample;
  const body = html`
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <h1>${cfg.hero.headline}</h1>
      <p class="lead">${cfg.hero.sub}</p>
      <p class="hero-actions">
        <a class="btn" href="#contact">Get a fixed quote</a>
        <a class="btn btn-ghost" href="tel:${b.phoneHref}">Call ${b.phone}</a>
      </p>
      <ul class="credentials">${b.credentials.map((c) => html`<li>${c}</li>`)}</ul>
    </div>
    <figure class="cert">
      <div class="cert-sheet">
        <p class="cert-title">${s.title}</p>
        <dl class="cert-rows">${s.rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
        <p class="cert-outcome"><span>Outcome</span><strong>${s.outcome}</strong></p>
      </div>
      <figcaption>${s.caption}</figcaption>
    </figure>
  </div>
</section>

<section id="services" class="section">
  <div class="wrap">
    <h2>What we do</h2>
    <ul class="services">
      ${cfg.services.map(
        (svc) => html`<li class="service tone-${svc.tone}">
        <h3><a href="/services/${svc.slug}">${svc.title}</a></h3>
        <p>${svc.summary}</p>
      </li>`,
      )}
    </ul>
  </div>
</section>

<section id="process" class="section section-tint">
  <div class="wrap">
    <h2>How it works</h2>
    <ol class="steps">
      ${cfg.process.map((p) => html`<li><h3>${p.title}</h3><p>${p.text}</p></li>`)}
    </ol>
  </div>
</section>

<section id="reviews" class="section">
  <div class="wrap">
    <h2>What customers say</h2>
    <div class="quotes">
      ${cfg.testimonials.map(
        (t) => html`<figure class="quote"><blockquote><p>${t.text}</p></blockquote><figcaption>${t.name}, ${t.place}</figcaption></figure>`,
      )}
    </div>
  </div>
</section>

<section id="areas" class="section section-tint">
  <div class="wrap narrow">
    <h2>Where we work</h2>
    <p>We cover these parts of London:</p>
    <ul class="areas">${b.areas.map((a) => html`<li>${a}</li>`)}</ul>
    <p>Not on the list? Send an enquiry and we will tell you whether we can help.</p>
  </div>
</section>

<section id="faq" class="section">
  <div class="wrap narrow">
    <h2>Common questions</h2>
    ${cfg.faq.map((f) => html`<details class="faq"><summary>${f.q}</summary><p>${f.a}</p></details>`)}
  </div>
</section>

<section id="contact" class="section section-ink">
  <div class="wrap contact-grid">
    <div>
      <h2>Get a fixed quote</h2>
      <p class="lead">Tell us what you need and we will reply within one working day.</p>
      <p>For anything urgent, call <a href="tel:${b.phoneHref}">${b.phone}</a>.</p>
      <p class="hours">${b.hours}</p>
    </div>
    ${enquiryForm(cfg)}
  </div>
</section>`;
  return layout(ctx, {
    title: `${b.name}: electricians in London`,
    description: `${b.name} provides fuse box replacements, electrical safety reports, rewiring and emergency call-outs across London, with fixed written quotes.`,
    path: '/',
    body,
    jsonld: localBusinessLd(cfg),
  });
}

export function servicePage(ctx, svc) {
  const { cfg } = ctx;
  const b = cfg.business;
  const others = cfg.services.filter((s) => s.slug !== svc.slug);
  const body = html`
<section class="section page-head tone-${svc.tone}">
  <div class="wrap narrow">
    <p class="crumbs"><a href="/">Home</a> / <a href="/#services">Services</a></p>
    <h1>${svc.title}</h1>
    <p class="lead">${svc.intro}</p>
  </div>
</section>
<section class="section">
  <div class="wrap narrow prose">
    <h2>What is included</h2>
    <ul class="ticks">${svc.points.map((p) => html`<li>${p}</li>`)}</ul>
    <p>${svc.note}</p>
    <p class="hero-actions">
      <a class="btn" href="/?service=${svc.slug}#contact">Ask about this service</a>
      <a class="btn btn-ghost" href="tel:${b.phoneHref}">Call ${b.phone}</a>
    </p>
    <h2>Other services</h2>
    <ul class="plain">${others.map((o) => html`<li><a href="/services/${o.slug}">${o.title}</a></li>`)}</ul>
  </div>
</section>`;
  return layout(ctx, {
    title: `${svc.title} in London | ${b.name}`,
    description: `${svc.summary} ${b.name} quotes in writing before work starts.`,
    path: `/services/${svc.slug}`,
    body,
  });
}

export function privacyPage(ctx) {
  const { cfg } = ctx;
  const b = cfg.business;
  const body = html`
<section class="section">
  <div class="wrap narrow prose">
    <h1>Privacy notice</h1>
    <p><strong>${b.legalName}</strong> (company number ${b.companyNumber}, ${b.address}) is the controller of the personal data described here. Contact us at <a href="mailto:${b.email}">${b.email}</a>.</p>
    <h2>What we collect</h2>
    <p>When you use the enquiry form we collect your name, phone number, email address, optional postcode, the service you are interested in, and the message you write. We also store a one-way scrambled form of your internet address, which we use only to stop automated abuse. We cannot turn it back into your address.</p>
    <h2>Why we use it</h2>
    <p>We use these details to reply to your enquiry and, if you ask, to provide a quote. This is necessary to take steps at your request before a contract, and for our legitimate interest in running and protecting the business.</p>
    <h2>Who else handles it</h2>
    <ul>${b.processors.map((p) => html`<li>${p.name}, for ${p.purpose}.</li>`)}</ul>
    <p>We do not sell your details or use them for marketing unless you separately agree.</p>
    <h2>How long we keep it</h2>
    <p>Enquiries that do not lead to work are deleted after ${b.privacyRetentionMonths} months. Records of work we carry out are kept as long as the law and our insurers require.</p>
    <h2>Your rights</h2>
    <p>You can ask to see, correct or delete your data, to restrict or object to its use, and to receive a copy. Email us and we will respond within one month.</p>
    <h2>Cookies</h2>
    <p>This website does not set cookies or use analytics or advertising trackers.</p>
    <h2>Complaints</h2>
    <p>If you are unhappy, please tell us first. You can also complain to the Information Commissioner's Office at <a href="https://ico.org.uk">ico.org.uk</a>.</p>
  </div>
</section>`;
  return layout(ctx, {
    title: `Privacy notice | ${b.name}`,
    description: `How ${b.name} collects and uses the details you send through this website.`,
    path: '/privacy',
    body,
  });
}

export function accessibilityPage(ctx) {
  const { cfg } = ctx;
  const b = cfg.business;
  const body = html`
<section class="section">
  <div class="wrap narrow prose">
    <h1>Accessibility</h1>
    <p>We want everyone to be able to use this website. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.</p>
    <h2>What we have done</h2>
    <ul>
      <li>Every page works with a keyboard alone and shows where focus is.</li>
      <li>Text and controls meet the AA colour-contrast ratios.</li>
      <li>Forms have visible labels and plain-language error messages.</li>
      <li>The site respects the reduced-motion setting and works at 200% zoom.</li>
    </ul>
    <h2>Tell us about a problem</h2>
    <p>If something does not work for you, email <a href="mailto:${b.email}">${b.email}</a> or call <a href="tel:${b.phoneHref}">${b.phone}</a>. We will try to fix it and, if needed, offer the information in another way.</p>
  </div>
</section>`;
  return layout(ctx, {
    title: `Accessibility | ${b.name}`,
    description: `Accessibility statement for the ${b.name} website.`,
    path: '/accessibility',
    body,
  });
}

function messagePage(ctx, { title, heading, text, path }) {
  const b = ctx.cfg.business;
  const body = html`
<section class="section">
  <div class="wrap narrow prose">
    <h1>${heading}</h1>
    <p>${text}</p>
    <p><a class="btn" href="/">Back to the home page</a> <a class="btn btn-ghost" href="tel:${b.phoneHref}">Call ${b.phone}</a></p>
  </div>
</section>`;
  return layout(ctx, { title: `${title} | ${b.name}`, description: text, path, body, noindex: true });
}

export const thanksPage = (ctx) =>
  messagePage(ctx, {
    title: 'Enquiry sent',
    heading: 'Thank you, we have your enquiry',
    text: 'We will reply within one working day. For anything urgent, please call us.',
    path: '/thanks',
  });

export const problemPage = (ctx) =>
  messagePage(ctx, {
    title: 'Enquiry not sent',
    heading: 'Your enquiry was not sent',
    text: 'Something went wrong, or the form was filled in incorrectly. Please go back and try again, or call us.',
    path: '/problem',
  });

export const notFoundPage = (ctx) =>
  messagePage(ctx, {
    title: 'Page not found',
    heading: 'We could not find that page',
    text: 'The address may have changed. Use the home page to find what you need.',
    path: '/404',
  });
