// Progressive enhancement only: the site and the enquiry form work without this file.
// Security notes: all text is written with textContent (no HTML injection sinks, no dynamic code), no
// third-party requests, nothing is written to cookies or web storage.

document.documentElement.classList.add('js');

// Mobile navigation
const toggle = document.querySelector('[data-nav-toggle]');
const nav = document.getElementById('site-nav');
if (toggle && nav) {
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    if (open) nav.setAttribute('data-open', '');
    else nav.removeAttribute('data-open');
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
}

// Enquiry form
const form = document.querySelector('[data-enquiry-form]');
if (form instanceof HTMLFormElement) {
  const loadedAt = Date.now();
  const status = form.querySelector('[data-status]');
  const submit = form.querySelector('[data-submit]');
  const fields = ['name', 'phone', 'email', 'postcode', 'service', 'message', 'consent'];
  const phone = form.dataset.phone ?? '';

  // Preselect the service when arriving from a service page (?service=slug). Only values that
  // exist as <option>s are accepted, so the query string can never inject anything.
  const wanted = new URLSearchParams(location.search).get('service');
  const select = form.elements.namedItem('service');
  if (wanted && select instanceof HTMLSelectElement) {
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
  }

  const setStatus = (text, state = '') => {
    if (!status) return;
    status.textContent = text;
    if (state) status.setAttribute('data-state', state);
    else status.removeAttribute('data-state');
  };

  const showError = (field, message) => {
    const input = form.elements.namedItem(field);
    const note = document.getElementById(`err-${field}`);
    if (note) {
      note.textContent = message;
      note.hidden = false;
    }
    if (input instanceof HTMLElement) input.setAttribute('aria-invalid', 'true');
  };

  const clearErrors = () => {
    for (const field of fields) {
      const input = form.elements.namedItem(field);
      const note = document.getElementById(`err-${field}`);
      if (note) {
        note.textContent = '';
        note.hidden = true;
      }
      if (input instanceof HTMLElement) input.removeAttribute('aria-invalid');
    }
  };

  const focusFirstInvalid = () => {
    const first = form.querySelector('[aria-invalid="true"]');
    if (first instanceof HTMLElement) first.focus();
  };

  const nativeMessages = {
    name: 'Enter your name.',
    phone: 'Enter a phone number.',
    email: 'Enter a valid email address.',
    service: 'Choose a service.',
    message: 'Tell us a little about the job (at least 10 characters).',
    consent: 'Please confirm that you have read the privacy notice.',
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    setStatus('');

    // Native constraint checks first, with our own plain-language messages.
    let invalid = false;
    for (const field of fields) {
      const input = form.elements.namedItem(field);
      if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
        if (!input.checkValidity()) {
          showError(field, nativeMessages[field] ?? 'Check this field.');
          invalid = true;
        }
      }
    }
    if (invalid) {
      focusFirstInvalid();
      setStatus('Please fix the highlighted fields.', 'error');
      return;
    }

    const body = Object.fromEntries(new FormData(form));
    body.consent = form.elements.namedItem('consent')?.checked === true;
    body.ms = Date.now() - loadedAt;

    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    setStatus('Sending…');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok) {
        setStatus('Thank you. We have your enquiry and will reply within one working day.', 'ok');
        form.reset();
        return;
      }
      if (response.status === 422 && data.errors) {
        for (const [field, message] of Object.entries(data.errors)) {
          if (fields.includes(field) && typeof message === 'string') showError(field, message);
        }
        focusFirstInvalid();
        setStatus('Please fix the highlighted fields.', 'error');
        return;
      }
      if (response.status === 429) {
        setStatus(`You have sent several enquiries recently. Please try again in a few minutes, or call ${phone}.`, 'error');
        return;
      }
      setStatus(`We could not send your enquiry. Please try again, or call ${phone}.`, 'error');
    } catch {
      setStatus(`We could not reach the server. Please check your connection, or call ${phone}.`, 'error');
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}
