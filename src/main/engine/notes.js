// Extractive note writing: no language model, so it never invents anything. It quotes what was said next to the
// person's own lines, lists lines that sound like commitments as tasks, and picks decision-like lines for a summary.
// The real engine (a local language model) replaces this; the shape of the result stays the same.

const { fold, clock } = require('../util');

const STOP = new Set(['para', 'como', 'mais', 'esta', 'este', 'esse', 'essa', 'isso', 'isto', 'sobre', 'entre', 'ainda',
  'quando', 'porque', 'muito', 'nossa', 'nosso', 'deve', 'tem', 'uma', 'uns', 'umas', 'dos', 'das', 'com', 'que', 'por',
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'from']);

const TASK_CUE = /\b(eu envio|envio|vou enviar|vou|tenho de|temos de|tens de|tem de|fico de|fica de|ficou de|alguém tem de|alguem tem de|precisamos de|preciso de|devemos|we need to|i will|i'll)\b/i;
const NOBODY = /\b(alguém|alguem|ninguém|ninguem|someone)\b/i;
const DECISION_CUE = /\b(decidi|decidimos|acordad|fica assim|vamos|devíamos|deviamos|concordo|aprovad|combinad|we agreed|let's)\b/i;
const DAYWORD = '(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?';
const DUE = new RegExp(`(?:até (?:à |a |ao )?${DAYWORD}|na ${DAYWORD}|\\(${DAYWORD}\\)|amanhã|amanha|hoje|próxima semana|proxima semana|fim do mês|fim do mes|até \\d{1,2}/\\d{1,2}|até ao fim d[oa] \\w+)`, 'i');
const dueOf = (text) => ((text.match(DUE) || [''])[0]).replace(/^\(|\)$/g, '');

const words = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));

function cleanLine(line) {
  return line.replace(/^\s*(?:[•\-*☐☑]|\[[ xX]?\])\s*/, '').trim();
}

function sentenceOf(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 220 ? `${t.slice(0, 217)}…` : t;
}

function bestMatch(lineWords, segments) {
  let best = null;
  for (const seg of segments) {
    const sw = new Set(words(seg.text));
    let score = 0;
    for (const w of lineWords) if (sw.has(w)) score++;
    if (score > 0 && (!best || score > best.score)) best = { seg, score };
  }
  return best;
}

/**
 * @param {object} meeting  repo meeting
 * @param {(key:string)=>string} nameOf  speaker display name
 */
function writeNotes(meeting, nameOf) {
  const segs = meeting.segments;
  const mine = (meeting.myNotes || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const usedSeg = new Set();
  const blocks = [];
  const tasks = [];

  for (const line of mine) {
    const core = cleanLine(line);
    const lw = words(core);
    const match = lw.length ? bestMatch(lw, segs) : null;
    if (match) usedSeg.add(match.seg.id);
    blocks.push({
      mine: line,
      add: match ? `${nameOf(match.seg.speakerKey)}: «${sentenceOf(match.seg.text)}»` : '',
      t: match ? clock(match.seg.startMs) : '',
    });
    if (/^\s*(?:☐|\[ ?\])/.test(line)) {
      const owner = (core.match(/^([A-ZÀ-Ú][\wà-ú]+)\s*(?:→|->|:)/) || [])[1] || '';
      tasks.push({ text: core.replace(/^([A-ZÀ-Ú][\wà-ú]+)\s*(?:→|->|:)\s*/, ''), owner, due: dueOf(core), t: match ? clock(match.seg.startMs) : '' });
    }
  }

  const extra = [];
  for (const seg of segs) {
    const said = seg.text;
    if (!TASK_CUE.test(said)) continue;
    const ownerless = NOBODY.test(said);
    const saidWords = words(said);
    const duplicate = tasks.find((t) => words(t.text).filter((w) => saidWords.includes(w)).length >= 2);
    if (duplicate) {
      // The person already wrote this task down: keep their wording, fill in only what they left empty.
      if (!duplicate.due) duplicate.due = dueOf(said);
      if (!duplicate.owner && !ownerless) duplicate.owner = nameOf(seg.speakerKey);
    } else {
      tasks.push({ text: sentenceOf(said), owner: ownerless ? '' : nameOf(seg.speakerKey), due: dueOf(said), t: clock(seg.startMs) });
    }
    // A commitment nobody owns, and that none of the person's own notes covers, is worth flagging.
    if (ownerless && !usedSeg.has(seg.id)) extra.push({ text: `${sentenceOf(said)} Ficou sem dono.`, t: clock(seg.startMs) });
  }

  const decisions = segs.filter((s) => DECISION_CUE.test(s.text)).slice(0, 2);
  const summary = (decisions.length ? decisions : segs.slice(0, 1))
    .map((s) => sentenceOf(s.text)).join(' ').slice(0, 600);

  let title = meeting.title;
  if (!title) {
    const first = mine.length ? cleanLine(mine[0]) : '';
    title = first ? first.slice(0, 80) : '';
  }
  return { title, summary, blocks, extra, tasks, engine: 'demo' };
}

module.exports = { writeNotes, words, TASK_CUE, DECISION_CUE, DUE };
