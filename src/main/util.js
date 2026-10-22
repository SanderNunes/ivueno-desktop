const crypto = require('crypto');

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const nowIso = () => new Date().toISOString();

// Lower-case and strip accents so "orcamento" finds "orçamento". Same length as the input for Latin text.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

module.exports = { uid, nowIso, fold, clock, pad };
