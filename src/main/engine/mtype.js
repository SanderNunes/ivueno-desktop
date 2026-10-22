/**
 * What kind of meeting was it? Detected automatically after a meeting (by the server's AI, falling back to these rules) and shown
 * next to the person's own choice, which always wins: "Escolhe por mim" (auto) uses the detected kind, any other choice is kept as it is.
 *
 * Keys are the app's own: general, one_to_one, standup, interview, sales, brainstorm, minutes (formal minutes, "ata"). The server calls two of them one_on_one and sales_call.
 */
const TYPES = ['general', 'one_to_one', 'standup', 'interview', 'sales', 'brainstorm', 'minutes'];
const SERVER_KEY = { one_to_one: 'one_on_one', sales: 'sales_call' };
const APP_KEY = { one_on_one: 'one_to_one', sales_call: 'sales' };

const toServerKey = (key) => SERVER_KEY[key] || key;
const fromServerKey = (key) => APP_KEY[key] || key;

/** The kind the notes are written for: the person's choice, or (when they left it on auto) the detected one. */
function effectiveTemplate(meeting) {
  const chosen = meeting.template || 'auto';
  if (chosen !== 'auto') return chosen;
  return (meeting.templateDetected && TYPES.includes(meeting.templateDetected.key)) ? meeting.templateDetected.key : 'auto';
}

// Words that give a kind away, in Portuguese and English. A hit in the title counts for more than one in the conversation.
const CUES = {
  standup: /\b(stand-?up|daily|scrum|sprint|bloque(?:io|ios|ado|ados|ei)|blockers?|blocked|ontem (?:fiz|trabalhei|terminei)|hoje (?:vou|vamos|fico)|yesterday i|today i)\b/gi,
  one_to_one: /\b(1[:\-]1|um para um|um a um|one[- ]on[- ]one|check-?in|feedback|carreira|career|promo[çc][ãa]o|aumento salarial|como te sentes|como tens estado|how are you feeling)\b/gi,
  interview: /\b(entrevista|candidat[oa]s?|curr[íi]culo|experi[êe]ncia profissional|pontos fortes|pretens[ãa]o salarial|interview|resume|tell me about yourself|salary expectations?)\b/gi,
  sales: /\b(proposta|or[çc]amento|pre[çc]os?|desconto|contrato|cota[çc][ãa]o|demonstra[çc][ãa]o|demo|fatura|renova[çc][ãa]o|objec[çc][ãa]o|pricing|proposal|quote|discovery|negotiat\w*|negocia[çc][ãa]o)\b/gi,
  minutes: /\b(ata|atas|minutes|ordem de trabalhos|ordem do dia|agenda item|pontos? da agenda|aprova[çc][ãa]o da ata|leitura da ata|assembleia|conselho de administra[çc][ãa]o|board meeting|quorum|qu[óo]rum|delibera[çc][ãa]o|delibera[çc][õo]es|deliberou|vota[çc][ãa]o|votos? a favor|abstens[ãa]o|steering committee|comit[ée] de dire[çc][ãa]o|next meeting|pr[óo]xima reuni[ãa]o)\b/gi,
  brainstorm: /\b(brainstorm\w*|ideias?|workshop|ideation|criativ\w*|alternativas|what if|e se (?:n[óo]s|a gente|fiz[ée]ssemos))\b/gi,
};
const countMatches = (text, re) => (text.match(re) || []).length;

/** Rules only: instant, offline, no AI. confidence is 0..1 and low when the words give little away. */
function detectByRules({ title = '', text = '', attendeeCount = 0 }) {
  const scores = {};
  for (const [key, re] of Object.entries(CUES)) {
    const inTitle = countMatches(title, new RegExp(re.source, 'gi'));
    const inText = Math.min(8, countMatches(text.slice(0, 20000), new RegExp(re.source, 'gi')));
    scores[key] = inTitle * 4 + inText;
  }
  if (attendeeCount === 2 && !scores.interview && !scores.sales) scores.one_to_one += 1;      // two people, no other clue: probably a one to one
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [key, score] = ranked[0];
  if (score < 3) return { key: 'general', confidence: score ? 0.3 : 0.2, by: 'rules' };       // too little to say
  const second = ranked[1][1];
  const margin = score - second;
  return { key, confidence: Math.round(Math.min(0.9, 0.35 + 0.05 * score + 0.05 * Math.min(margin, 6)) * 100) / 100, by: 'rules' };
}

/** The text the detectors look at: the start of the conversation (or the notes when no transcript was kept). */
function sampleText(meeting, nameOf = (k) => k, limit = 6000) {
  const lines = (meeting.segments || []).map((s) => `${nameOf(s.speakerKey)}: ${s.text}`).join('\n');
  const text = lines || [meeting.myNotes, meeting.summary].filter(Boolean).join('\n');
  return text.slice(0, limit);
}

function detectMeeting(meeting, nameOf) {
  return detectByRules({ title: meeting.title || '', text: sampleText(meeting, nameOf, 20000), attendeeCount: (meeting.attendees || []).length || Object.keys(meeting.speakers || {}).length });
}

module.exports = { TYPES, toServerKey, fromServerKey, effectiveTemplate, detectByRules, detectMeeting, sampleText };
