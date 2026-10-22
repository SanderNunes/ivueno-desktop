/**
 * Opening the person's own email program with a message ready (mailto:). Nothing is sent from here and no attachment can be added this way
 * (a mailto link cannot carry a file), so a long body is shortened to what mail programs accept and the full text goes to the clipboard.
 */
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
const MAX_URL = 1800;                         // Windows mail handlers and most browsers cope with about 2000 characters in total

const cleanLine = (s, max) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Split "a@x.pt, b@y.pt; c@z.ao" into valid addresses (anything else is dropped). Returns { valid, invalid }. */
function parseRecipients(input) {
  const parts = (Array.isArray(input) ? input : String(input || '').split(/[,;\n]+/)).map((p) => String(p).trim()).filter(Boolean);
  const valid = []; const invalid = [];
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*$/);                                   // "Ana Silva <ana@x.pt>"
    const addr = (m ? m[1] : p).trim();
    if (EMAIL.test(addr) && addr.length <= 254) { if (!valid.some((v) => v.toLowerCase() === addr.toLowerCase())) valid.push(addr); } else invalid.push(p);
  }
  return { valid: valid.slice(0, 50), invalid };
}

/** The mailto: address, shortened to fit. truncated is true when the body had to be cut (the caller then copies the full text). */
function buildMailto({ to = [], subject = '', body = '' }) {
  const { valid } = parseRecipients(to);
  const head = `mailto:${valid.map(encodeURIComponent).join(',').replace(/%40/g, '@')}`;
  const subj = cleanLine(subject, 200);
  const make = (text) => `${head}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`.replace(/%0A/g, '%0D%0A').replace(/%0D%0D%0A/g, '%0D%0A');
  let text = String(body || '').replace(/\r\n/g, '\n');
  let url = make(text);
  if (url.length <= MAX_URL) return { url, truncated: false };
  const note = '\n\n[…]';
  let lo = 0; let hi = text.length;
  while (lo < hi) {                                                        // the longest start of the body that still fits
    const mid = Math.ceil((lo + hi) / 2);
    if (make(text.slice(0, mid) + note).length <= MAX_URL) lo = mid; else hi = mid - 1;
  }
  text = text.slice(0, lo).replace(/\s+\S*$/, '') + note;                  // do not cut a word in half
  return { url: make(text), truncated: true };
}

module.exports = { parseRecipients, buildMailto, cleanLine, MAX_URL };
