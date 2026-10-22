const { writeNotes, words, DECISION_CUE } = require('./notes');
const { extractiveSummary } = require('./summarize');
const { extractiveEmail } = require('./email');
const { detectMeeting } = require('./mtype');
const { clock } = require('../util');

/**
 * THE DEMONSTRATION ENGINE. It does not listen to anything and it has no language model.
 * It plays a short scripted Portuguese conversation so every screen of the app can be used end to end, and it writes
 * notes by quoting that conversation. The real local engine (speech-to-text + a language model, see docs/ENGINE.md)
 * implements the same interface and replaces this file. The app tells the person whenever this engine is active.
 */
const SCRIPT = [
  { who: 'spk_3', source: 'system', text: 'Antes de mexermos nos preços, quero ver os números de cancelamento do último trimestre.' },
  { who: 'spk_4', source: 'system', text: 'Tenho isso. Os cancelamentos subiram dois por cento em Setembro, sobretudo no pré-pago.' },
  { who: 'spk_2', source: 'system', text: 'Acho que devíamos subir os preços em cinco por cento a partir de Janeiro.' },
  { who: 'spk_3', source: 'system', language: 'en', text: 'If we go to five percent, we need a retention offer ready.',
    translation: 'Se formos para cinco por cento, precisamos de uma oferta de retenção pronta.' },
  { who: 'spk_me', source: 'mic', text: 'Concordo, mas temos de avisar os clientes com um mês de antecedência.' },
  { who: 'spk_5', source: 'system', text: 'Eu envio a nova lista de preços até sexta-feira.' },
  { who: 'spk_2', source: 'system', text: 'Perfeito. E alguém tem de avisar o suporte.' },
];

const UNAVAILABLE = 'Esta ajuda precisa do motor de IA local, que ainda não está instalado. O que já funciona: “Põe-me a par”, “Versão curta”, “Decisões” e “Perguntas sem resposta”.';

class DemoEngine {
  constructor({ stepMs = 6000 } = {}) {
    this.id = 'demo';
    this.label = 'Motor de demonstração';
    this.realTranscription = false;
    this.needsAudio = false;
    this.stepMs = stepMs;
    this._timer = null;
    this._i = 0;
    this._sink = null;
    this._clock = null;
    this._running = false;
  }

  modelStatus() { return { state: 'ready', demo: true, label: 'Sem modelo: motor de demonstração' }; }

  /** Start "listening". `elapsedMs()` tells the engine how far into the meeting we are, so lines get real timestamps. */
  start(meeting, sink, elapsedMs) {
    this._sink = sink; this._clock = elapsedMs; this._i = 0; this._running = true;
    this._next();
  }

  _next() {
    if (!this._running || this._i >= SCRIPT.length) return;
    const line = SCRIPT[this._i];
    const startMs = this._clock();
    const half = line.text.split(' ').slice(0, Math.ceil(line.text.split(' ').length / 2)).join(' ');
    this._timer = setTimeout(() => {
      this._sink.partial({ speakerKey: line.who, source: line.source, text: half });
      this._timer = setTimeout(() => {
        this._sink.final({
          clientId: `demo_${this._i}`, speakerKey: line.who, source: line.source, text: line.text,
          language: line.language || 'pt', translation: line.translation || null, startMs,
        });
        this._i += 1;
        this._next();
      }, this.stepMs / 2);
    }, this.stepMs / 2);
  }

  pause() { clearTimeout(this._timer); this._timer = null; this._running = false; this._sink && this._sink.partial(null); }

  resume() { if (!this._running) { this._running = true; this._next(); } }

  stop() { this.pause(); this._sink = null; }

  async writeNotes(meeting, nameOf) { return writeNotes(meeting, nameOf); }

  async summarize(req, nameOf) { return { text: extractiveSummary({ ...req, nameOf }), engine: 'extractive' }; }

  async draftEmail(req, nameOf) {
    const language = req.language === 'auto' ? (req.meeting.language === 'en' ? 'en' : 'pt') : req.language;
    return { ...extractiveEmail(req.meeting, nameOf, { ...req, language }), engine: 'template' };
  }

  async detectType(meeting, nameOf) { return detectMeeting(meeting, nameOf); }

  async runRecipe(meeting, recipeId, { live = false } = {}, nameOf) {
    const segs = meeting.segments;
    const lastMs = segs.length ? segs[segs.length - 1].startMs : 0;
    const scope = live ? segs.filter((s) => s.startMs >= lastMs - 5 * 60_000) : segs;
    const quote = (s) => `• ${nameOf(s.speakerKey)}: «${s.text}»`;
    if (!segs.length) return { text: 'Ainda não há transcrição para trabalhar.' };
    switch (recipeId) {
      case 'catch-up': {
        const key = scope.filter((s) => DECISION_CUE.test(s.text));
        return { text: (key.length ? key : scope.slice(-3)).slice(-3).map(quote).join('\n') };
      }
      case 'tldr':
        return { text: meeting.summary || scope.filter((s) => DECISION_CUE.test(s.text)).slice(0, 2).map((s) => s.text).join(' ') || scope[0].text };
      case 'decisions': {
        const d = scope.filter((s) => DECISION_CUE.test(s.text));
        return { text: d.length ? d.map(quote).join('\n') : 'Não encontrei decisões claras nesta reunião.' };
      }
      case 'unanswered': {
        const q = scope.filter((s) => /\?\s*$/.test(s.text));
        return { text: q.length ? q.map(quote).join('\n') : 'Não encontrei perguntas por responder.' };
      }
      case 'shorter':
        return { text: (meeting.summary || '').split(/(?<=[.!?])\s+/).slice(0, 1).join(' ') || 'Ainda não há notas para encurtar.' };
      default:
        return { text: UNAVAILABLE, unavailable: true };
    }
  }

  async ask(meeting, question, nameOf) {
    const qw = words(question);
    let best = null;
    for (const s of meeting.segments) {
      const sw = new Set(words(s.text));
      const score = qw.filter((w) => sw.has(w)).length;
      if (score && (!best || score > best.score)) best = { s, score };
    }
    if (!best) return { text: 'Não encontrei isso nesta reunião.' };
    return { text: `${nameOf(best.s.speakerKey)} disse: «${best.s.text}»`, cite: clock(best.s.startMs) };
  }
}

module.exports = { DemoEngine, SCRIPT };
