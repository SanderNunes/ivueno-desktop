const { writeNotes } = require('./notes');

/**
 * A follow-up email drafted from a meeting's notes. The server's AI writes it (CloudEngine.draftEmail); when that cannot be reached
 * it is assembled from the notes themselves, so there is always something to edit. Nothing is ever sent from here:
 * the person reviews the draft and sends it from their own email program.
 */
const TONES = ['formal', 'friendly', 'direct'];

const PT = {
  formal: { hello: (n) => (n ? `Caros ${n},` : 'Caros,'), thanks: 'Agradeço o tempo dedicado à reunião.', recap: 'Em resumo, ficou o seguinte:', steps: 'Próximos passos:', close: 'Com os melhores cumprimentos,', subject: (t) => `Resumo da reunião${t ? `: ${t}` : ''}` },
  friendly: { hello: (n) => (n ? `Olá ${n},` : 'Olá,'), thanks: 'Obrigado/a pela reunião de hoje!', recap: 'Em resumo:', steps: 'Próximos passos:', close: 'Um abraço,', subject: (t) => `Resumo da nossa reunião${t ? `: ${t}` : ''}` },
  direct: { hello: (n) => (n ? `${n},` : 'Olá,'), thanks: '', recap: 'Resumo:', steps: 'A fazer:', close: 'Cumprimentos,', subject: (t) => `Resumo: ${t || 'reunião'}` },
};
const EN = {
  formal: { hello: (n) => (n ? `Dear ${n},` : 'Dear all,'), thanks: 'Thank you for your time in the meeting.', recap: 'In summary:', steps: 'Next steps:', close: 'Kind regards,', subject: (t) => `Meeting summary${t ? `: ${t}` : ''}` },
  friendly: { hello: (n) => (n ? `Hi ${n},` : 'Hi all,'), thanks: 'Thanks for the meeting today!', recap: 'Quick recap:', steps: 'Next steps:', close: 'Best,', subject: (t) => `Recap of our meeting${t ? `: ${t}` : ''}` },
  direct: { hello: (n) => (n ? `${n},` : 'Hi,'), thanks: '', recap: 'Summary:', steps: 'To do:', close: 'Regards,', subject: (t) => `Summary: ${t || 'meeting'}` },
};

/** Everything an email can be built from, taken from the meeting: summary, the person's notes, what was added, the open tasks. */
function material(meeting) {
  const summary = (meeting.summary || '').trim();
  const mine = (meeting.myNotes || '').trim();
  const added = [...(meeting.aiBlocks || []).flatMap((b) => [b.mine, b.add]), ...(meeting.aiExtra || []).map((x) => x.text)].filter(Boolean);
  const tasks = (meeting.tasks || []).filter((t) => !t.hidden && !t.done).map((t) => ({ text: t.text, owner: t.owner || '', due: t.due || '' }));
  return { summary, mine, added, tasks };
}

const hasMaterial = (m) => !!(m.summary || m.mine || m.added.length || m.tasks.length);

/** "Ana Silva", "Rui Costa", "Maria Lopes" -> "Ana, Rui e Maria" (first names only). */
const firstNames = (names, and = 'e') => {
  const f = names.map((n) => String(n).trim().split(/\s+/)[0]).filter(Boolean);
  return f.length <= 1 ? (f[0] || '') : `${f.slice(0, -1).join(', ')} ${and} ${f.at(-1)}`;
};

/** The draft without any AI: greeting, thanks, the summary (or the person's own notes), next steps, sign-off. */
function templateEmail({ meeting, tone = 'friendly', language = 'pt', includeTasks = true, senderName = '', attendeeNames = [] }) {
  const lang = language === 'en' ? 'en' : 'pt';
  const T = (lang === 'en' ? EN : PT)[TONES.includes(tone) ? tone : 'friendly'];
  const mat = material(meeting);
  const names = firstNames(attendeeNames, lang === 'en' ? 'and' : 'e');
  const lines = [T.hello(names), ''];
  if (T.thanks) lines.push(T.thanks, '');
  const recap = mat.summary || (mat.mine ? mat.mine.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => `• ${l.replace(/^[•\-*]\s*/, '')}`).join('\n') : mat.added.slice(0, 5).map((l) => `• ${l}`).join('\n'));
  if (recap) lines.push(T.recap, recap, '');
  if (includeTasks && mat.tasks.length) {
    lines.push(T.steps, ...mat.tasks.map((t) => `• ${t.text}${t.owner || t.due ? ` (${[t.owner, t.due].filter(Boolean).join(', ')})` : ''}`), '');
  }
  lines.push(T.close, senderName || '');
  return { subject: T.subject(meeting.title), body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** Meeting -> the draft, extractively (also what the demonstration engine uses). */
function extractiveEmail(meeting, nameOf, opts) {
  // a meeting with a transcript but no written notes yet still has something to say
  const base = (meeting.summary || meeting.myNotes || (meeting.aiBlocks || []).length || (meeting.tasks || []).length) ? meeting
    : { ...meeting, summary: (meeting.segments || []).length ? writeNotes(meeting, nameOf).summary : '' };
  return templateEmail({ ...opts, meeting: base });
}

module.exports = { TONES, material, hasMaterial, templateEmail, extractiveEmail };
