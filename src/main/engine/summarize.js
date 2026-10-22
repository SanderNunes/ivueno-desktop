const { writeNotes } = require('./notes');

/**
 * The text a summary is made from, and the plain fallback. The summaries themselves are written by the server's AI (CloudEngine.summarize);
 * when it cannot be reached an extract of the text is shown instead: picked from the text, never invented, and labelled as such.
 */
const STYLES = ['short', 'normal', 'detailed'];

/** The words of a meeting as one text: "Name: line" per transcript line, in order. */
function transcriptText(meeting, nameOf) {
  return (meeting.segments || []).map((s) => `${nameOf(s.speakerKey)}: ${s.text}`).join('\n');
}

/** What is left to summarise when the transcript was not kept: the notes the person and the engine wrote. */
function notesText(meeting) {
  const parts = [];
  if (meeting.myNotes && meeting.myNotes.trim()) parts.push(meeting.myNotes.trim());
  if (meeting.summary) parts.push(meeting.summary);
  for (const b of meeting.aiBlocks || []) { if (b.mine) parts.push(b.mine); if (b.add) parts.push(b.add); }
  for (const x of meeting.aiExtra || []) if (x.text) parts.push(x.text);
  return parts.join('\n');
}

const sentences = (s) => (s.match(/[^.!?…]+[.!?…]*/g) || []).map((x) => x.trim()).filter((x) => x.length > 3);

/** An extract: `meeting` (when given) lets it reuse the extractive meeting notes; otherwise the first lines of the text, by style. */
function extractiveSummary({ scope, text, style = 'normal', meeting, nameOf = (k) => k }) {
  if (scope === 'meeting' && meeting && (meeting.segments || []).length) {
    const base = writeNotes(meeting, nameOf);
    const sents = sentences(base.summary || '');
    const lines = [];
    if (style === 'short') lines.push(sents.slice(0, 2).join(' '));
    else lines.push(base.summary || '');
    if (style !== 'short' && base.tasks.length) lines.push('', ...base.tasks.slice(0, style === 'detailed' ? 10 : 4).map((t) => `• ${t.text}${t.owner ? ` (${t.owner})` : ''}`));
    return lines.join('\n').trim();
  }
  const all = String(text || '').split('\n').map((l) => l.replace(/^\s*(?:[•\-*☐☑]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean);
  const take = { short: 3, normal: 6, detailed: 12 }[style] || 6;
  return all.slice(0, take).map((l) => (l.length > 200 ? `${l.slice(0, 197)}…` : l)).join('\n');
}

module.exports = { STYLES, transcriptText, notesText, extractiveSummary };
