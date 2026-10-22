import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN_BY_PT } from '../src/renderer/lib/i18n-en.js';

// Every t("Português") written in a screen must have an English version, so a new text cannot ship half-translated.

const root = new URL('../src/renderer/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.jsx')) files.push(p);
  }
}(root));

const dictSource = readFileSync(join(root, 'lib', 'i18n.js'), 'utf8');
const keyed = new Set([...dictSource.matchAll(/^\s*'([a-z]+\.[A-Za-z0-9]+)':/gm), ...dictSource.matchAll(/'([a-z]+\.[A-Za-z0-9]+)':/g)].map((m) => m[1]));

test('every text passed to t() has an English translation or is a dictionary key', () => {
  const missing = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
      const text = JSON.parse(`"${(m[1] ?? m[2]).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
      if (!/[A-Za-zÀ-ÿ]/.test(text) || /^[a-z]+\.[A-Za-z0-9]+$/.test(text)) continue;        // dictionary keys are checked in i18n.test.mjs
      if (!(text in EN_BY_PT) && !keyed.has(text)) missing.push(`${f.split(/[\\/]/).pop()}: ${text}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('English entries are not empty and keep the same {placeholders} as the Portuguese', () => {
  for (const [pt, en] of Object.entries(EN_BY_PT)) {
    assert.ok(en.trim(), pt);
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(holes(en), holes(pt), pt);
  }
});
