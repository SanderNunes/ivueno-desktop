const { zip } = require('./zip');
const { clock } = require('./util');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const p2 = (n) => String(n).padStart(2, '0');

function whenLine(m) {
  if (!m.startedAt) return '';
  const d = new Date(m.startedAt);
  const mins = m.durationSeconds ? Math.max(1, Math.round(m.durationSeconds / 60)) : null;
  return `${WEEKDAYS[d.getDay()]}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}${mins ? ` · ${mins} min` : ''}`;
}

/** The pieces every format shares, so the formats cannot drift apart. */
/** `include` chooses what goes in: { summary, mine, ai, tasks, transcript } (all on, transcript off, unless said otherwise). */
function sections(m, { includeTranscript = false, include = {}, nameOf }) {
  const inc = { summary: true, mine: true, ai: true, tasks: true, transcript: includeTranscript, ...include };
  const out = { title: m.title || 'Reunião sem título', when: whenLine(m), people: m.attendees.map((a) => a.name || a.email).filter(Boolean) };
  out.summary = inc.summary ? (m.summary || '') : '';
  out.mine = inc.mine ? (m.myNotes || '').split('\n').filter((l) => l.trim()) : [];
  out.blocks = inc.ai ? (m.aiBlocks || []) : [];
  out.extra = inc.ai ? (m.aiExtra || []) : [];
  out.tasks = !inc.tasks ? [] : (m.tasks || []).filter((t) => !t.hidden).map((t) => ({
    text: t.text, done: !!t.done, meta: [t.owner || 'Sem dono', t.due || 'Sem prazo'].join(' · '),
  }));
  out.transcript = inc.transcript
    ? m.segments.map((s) => ({ t: clock(s.startMs), who: nameOf(s.speakerKey), text: s.text, tr: s.translation || '' }))
    : null;
  return out;
}

function toMarkdown(m, opts) {
  const s = sections(m, opts);
  const L = [`# ${s.title}`, ''];
  if (s.when) L.push(`_${s.when}_`, '');
  if (s.people.length) L.push(`Participantes: ${s.people.join(', ')}`, '');
  if (s.summary) L.push('## Resumo', '', s.summary, '');
  if (s.mine.length) L.push('## As tuas notas', '', ...s.mine, '');
  if (s.blocks.some((b) => b.add)) {
    L.push('## Notas da Ivuenu', '');
    for (const b of s.blocks) { L.push(b.mine); if (b.add) L.push(`  - ${b.add}${b.t ? ` (${b.t})` : ''}`); }
    L.push('');
  }
  if (s.extra.length) L.push('## Também foi dito', '', ...s.extra.map((e) => `- ${e.text}${e.t ? ` (${e.t})` : ''}`), '');
  if (s.tasks.length) L.push('## Tarefas', '', ...s.tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text} — ${t.meta}`), '');
  if (s.transcript) {
    L.push('## Transcrição', '');
    for (const t of s.transcript) { L.push(`**${t.who}** (${t.t}): ${t.text}`); if (t.tr) L.push(`  _${t.tr}_`); }
    L.push('');
  }
  return L.join('\n');
}

function toText(m, opts) {
  return toMarkdown(m, opts)
    .replace(/^#{1,3} /gm, '').replace(/\*\*/g, '').replace(/(^|\s)_([^_]+)_/g, '$1$2');
}

function toHtml(m, opts) {
  const s = sections(m, opts);
  const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#1F1D1A;line-height:1.5;margin:40px;font-size:12pt}
h1{font-size:22pt;margin:0 0 4px}h2{font-size:14pt;margin:22px 0 6px}.meta{color:#57524B;font-size:10pt}
.add{color:#57524B;margin-left:18px;font-size:11pt}ul{padding-left:20px}</style></head><body>
<h1>${esc(s.title)}</h1><div class="meta">${esc(s.when)}${s.people.length ? ` · ${esc(s.people.join(', '))}` : ''}</div>
${s.summary ? `<h2>Resumo</h2><p>${esc(s.summary)}</p>` : ''}
${s.mine.length ? `<h2>As tuas notas</h2>${s.mine.map((l) => `<div>${esc(l)}</div>`).join('')}` : ''}
${s.blocks.some((b) => b.add) ? `<h2>Notas da Ivuenu</h2>${s.blocks.map((b) => `<div>${esc(b.mine)}</div>${b.add ? `<div class="add">${esc(b.add)}${b.t ? ` (${esc(b.t)})` : ''}</div>` : ''}`).join('')}` : ''}
${s.extra.length ? `<h2>Também foi dito</h2>${li(s.extra.map((e) => esc(e.text)))}` : ''}
${s.tasks.length ? `<h2>Tarefas</h2>${li(s.tasks.map((t) => `${t.done ? '☑' : '☐'} ${esc(t.text)} <span class="meta">— ${esc(t.meta)}</span>`))}` : ''}
${s.transcript ? `<h2>Transcrição</h2>${s.transcript.map((t) => `<p><b>${esc(t.who)}</b> <span class="meta">${t.t}</span><br>${esc(t.text)}${t.tr ? `<br><i>${esc(t.tr)}</i>` : ''}</p>`).join('')}` : ''}
${opts.brand ? '<div class="meta" style="margin-top:28px;border-top:1px solid #DDD7CC;padding-top:8px">Notas criadas com a Ivuenu</div>' : ''}
</body></html>`;
}

function toDocx(m, opts) {
  const s = sections(m, opts);
  const run = (text, { bold = false, size = 0, color = '' } = {}) =>
    `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const para = (text, o = {}) => `<w:p>${o.indent ? `<w:pPr><w:ind w:left="${o.indent}"/></w:pPr>` : ''}${run(text, o)}</w:p>`;
  const body = [para(s.title, { bold: true, size: 44 })];
  if (s.when) body.push(para(`${s.when}${s.people.length ? ` · ${s.people.join(', ')}` : ''}`, { color: '57524B', size: 20 }));
  if (s.summary) body.push(para('Resumo', { bold: true, size: 28 }), para(s.summary));
  if (s.mine.length) body.push(para('As tuas notas', { bold: true, size: 28 }), ...s.mine.map((l) => para(l)));
  if (s.blocks.some((b) => b.add)) {
    body.push(para('Notas da Ivuenu', { bold: true, size: 28 }));
    for (const b of s.blocks) { body.push(para(b.mine)); if (b.add) body.push(para(`${b.add}${b.t ? ` (${b.t})` : ''}`, { indent: 400, color: '57524B' })); }
  }
  if (s.extra.length) body.push(para('Também foi dito', { bold: true, size: 28 }), ...s.extra.map((e) => para(`• ${e.text}`)));
  if (s.tasks.length) body.push(para('Tarefas', { bold: true, size: 28 }), ...s.tasks.map((t) => para(`${t.done ? '☑' : '☐'} ${t.text} — ${t.meta}`)));
  if (s.transcript) {
    body.push(para('Transcrição', { bold: true, size: 28 }));
    for (const t of s.transcript) body.push(para(`${t.who} (${t.t}): ${t.text}${t.tr ? ` — ${t.tr}` : ''}`));
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}</w:body></w:document>` },
  ]);
}

/** A short plain-text version for the body of an email: the title, the summary and the open tasks (never the transcript). */
function toEmailText(m, opts) {
  const wanted = opts.include || {};
  return toText(m, { ...opts, include: { summary: wanted.summary !== false, mine: false, ai: false, tasks: wanted.tasks !== false, transcript: false } }).trim();
}

module.exports = { toMarkdown, toText, toHtml, toDocx, toEmailText, sections };
