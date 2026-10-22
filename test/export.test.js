const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { toMarkdown, toText, toHtml, toDocx } = require('../src/main/export');
const { png } = require('../src/main/icons');
const { crc32 } = require('../src/main/zip');
const { newRepo } = require('./helpers');

function meeting() {
  const { repo } = newRepo();
  const m = repo.createMeeting({ title: 'Revisão de preços Q4 <&>', startedAt: '2026-10-20T09:30:00Z', attendees: [{ name: 'Ana' }] });
  repo.setMyNotes(m.id, 'Preços Q4\n☐ Carla → lista (sexta)\n');
  repo.addSegments(m.id, [{ text: 'Eu envio a lista até sexta.', speakerKey: 'spk_2', startMs: 3000 }]);
  repo.updateMeeting(m.id, { durationSeconds: 780 });
  repo.setGenerated(m.id, { summary: 'Sobe 5%.', blocks: [{ mine: 'Preços Q4', add: 'Bruno: «sobe»', t: '00:00:03' }], extra: [], tasks: [{ text: 'Enviar a lista', owner: 'Carla', due: 'sexta' }] });
  return { repo, m: repo.getMeeting(m.id) };
}

test('markdown has the sections and leaves the transcript out unless asked', () => {
  const { repo, m } = meeting();
  const nameOf = (k) => repo.speakerName(m, k);
  const md = toMarkdown(m, { nameOf });
  assert.match(md, /^# Revisão/);
  assert.match(md, /## Resumo/);
  assert.match(md, /- \[ \] Enviar a lista — Carla · sexta/);
  assert.doesNotMatch(md, /## Transcrição/);
  assert.match(toMarkdown(m, { nameOf, includeTranscript: true }), /\*\*Orador 2\*\* \(00:00:03\)/);
  assert.doesNotMatch(toText(m, { nameOf }), /[#*]/);
});

test('html escapes the title', () => {
  const { repo, m } = meeting();
  assert.match(toHtml(m, { nameOf: (k) => repo.speakerName(m, k) }), /Revisão de preços Q4 &lt;&amp;&gt;/);
});

test('docx is a valid zip whose entries inflate to well-formed content', () => {
  const { repo, m } = meeting();
  const buf = toDocx(m, { nameOf: (k) => repo.speakerName(m, k) });
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const out = path.join(require('os').tmpdir(), `ivuenu-${process.pid}.docx`);
  fs.writeFileSync(out, buf);
  // read the first local entry back by hand and check its CRC
  const nameLen = buf.readUInt16LE(26); const size = buf.readUInt32LE(18); const crc = buf.readUInt32LE(14);
  const data = zlib.inflateRawSync(buf.subarray(30 + nameLen, 30 + nameLen + size));
  assert.equal(crc32(data), crc);
  assert.match(data.toString(), /<Types/);
  fs.rmSync(out, { force: true });
});

test('the icon is a real PNG of the requested size, with and without the recording dot', () => {
  for (const opts of [{}, { recording: true }, { dark: true, recording: true }]) {
    const p = png(32, opts);
    assert.deepEqual([...p.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(p.readUInt32BE(16), 32);
    assert.equal(p.readUInt32BE(20), 32);
  }
  assert.notDeepEqual(png(32, {}), png(32, { recording: true }));
});
