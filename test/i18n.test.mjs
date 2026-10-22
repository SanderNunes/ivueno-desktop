import test from 'node:test';
import assert from 'node:assert/strict';

// i18n.js imports React and the app context, so load only its pure part by reading the dictionaries from source.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/renderer/lib/i18n.js', import.meta.url), 'utf8');
const grab = (name) => {
  const start = src.indexOf(`const ${name} = {`);
  const end = src.indexOf('\n};', start);
  const body = src.slice(start + `const ${name} = `.length, end + 3);
  return new Function(`return (${body.replace(/;$/, '')})`)();
};
const pt = grab('pt');
const en = grab('en');

test('every Portuguese text has an English one, and no English text is orphaned', () => {
  assert.deepEqual(Object.keys(pt).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.keys(en).filter((k) => !(k in pt)), []);
});

test('no text is left empty and placeholders match between languages', () => {
  for (const [k, v] of Object.entries(pt)) {
    assert.ok(v.trim() && en[k].trim(), k);
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(holes(v), holes(en[k]), k);
  }
});
