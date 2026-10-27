// Tiny auto-escaping HTML templating. Every interpolated value is escaped unless it was
// produced by html`` itself or explicitly wrapped in raw(). This removes the most common
// source of XSS in hand-written templates.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Raw {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export const raw = (text) => new Raw(text);

const render = (value) =>
  Array.isArray(value) ? value.map(render).join('') : value instanceof Raw ? value.text : esc(value);

export function html(strings, ...values) {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}

// JSON for a <script type="application/ld+json"> block: neutralise sequences that could end the block.
export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
