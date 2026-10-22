// Replaces sensitive details with labels BEFORE a transcript line is stored, so notes, search and the model never see
// them. Same rules as backend/app/redact.py. It catches recognisable shapes and cue phrases; a number spoken in words,
// or a secret with no cue, passes through. The app says so honestly.

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){3,8}\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONE = /(?<!\w)(?:\+|00)\d[\d ()-]{7,16}\d\b/g;
// JavaScript's \b only knows ASCII letters, so "é" is matched between spaces instead of with \b.
const SECRET_CUE = /(?<cue>\b(?:my |a minha |o meu )?(?:password|palavra[- ]passe|senha|pin|código|codigo))\s*(?:\bis\b|(?<=\s)é(?=\s)|:)\s*\S+/gi;
const KEY_URL = /https?:\/\/\S+[?&](?:key|token|secret|apikey|api_key)=\S+/gi;

function luhn(digits) {
  let total = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    total += d;
    alt = !alt;
  }
  return total % 10 === 0;
}

/** @returns {{text: string, count: number}} the cleaned text and how many details were hidden */
function redact(input) {
  let count = 0;
  const hit = (label) => () => { count++; return label; };
  let text = String(input || '');
  text = text.replace(KEY_URL, hit('[ligação com chave]'));
  text = text.replace(SECRET_CUE, (_m, cue) => { count++; return `${cue} ••••`; });
  text = text.replace(EMAIL, hit('[email]'));
  text = text.replace(IBAN, hit('[IBAN]'));
  text = text.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) { count++; return '••••'; }
    return m;
  });
  text = text.replace(PHONE, hit('[telefone]'));
  return { text, count };
}

module.exports = { redact, luhn };
