// Meeting-type detection, the follow-up email draft and the mailto builder: all pure, no engine or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/main/engine/mtype');
const E = require('../src/main/engine/email');
const M = require('../src/main/mail');

// ------------------------------------------------------------------------------------------------ meeting type
const says = (text, title = '', n = 0) => T.detectByRules({ title, text, attendeeCount: n });

test('the type is found from the words, in Portuguese and English', () => {
  assert.equal(says('Ontem fiz a migração. Hoje vou rever os testes. Tenho um bloqueio no acesso ao servidor.').key, 'standup');
  assert.equal(says('', 'Daily da equipa').key, 'standup');
  assert.equal(says('Fala-me da tua experiência profissional. Quais os teus pontos fortes? E a pretensão salarial?').key, 'interview');
  assert.equal(says('Tell me about yourself. What are your salary expectations?', 'Interview with Rui').key, 'interview');
  assert.equal(says('A proposta tem desconto de 10%. O orçamento inclui o contrato anual e a renovação.').key, 'sales');
  assert.equal(says('', 'Demo e proposta para o banco').key, 'sales');
  assert.equal(says('Boa tarde. Ordem de trabalhos: aprovação da ata anterior, votação do orçamento, quórum confirmado. A assembleia deliberou aprovar. Próxima reunião em março.').key, 'minutes');
  assert.equal(says('Vamos fazer um brainstorm. E se fizéssemos de outra forma? Tenho mais ideias e alternativas.').key, 'brainstorm');
  assert.equal(says('Quero dar-te feedback sobre a tua carreira e como tens estado.', '1:1 com a Ana').key, 'one_to_one');
});

test('a title counts for more than a stray word, and two people with no other clue lean to a one to one', () => {
  assert.equal(says('falámos do preço do café', 'Daily').key, 'standup');
  assert.equal(says('vamos falar um pouco de tudo sem nada de especial por agora', '', 2).key, 'general');   // one weak point is not enough
  assert.equal(says('feedback sobre a tua carreira', '', 2).key, 'one_to_one');                                   // two cues plus two people
});

test('too little to go on is general with low confidence; clear evidence has high confidence', () => {
  const none = says('Bom dia a todos. Vamos começar.');
  assert.deepEqual([none.key, none.by], ['general', 'rules']); assert.ok(none.confidence <= 0.3);
  const clear = says('stand-up daily scrum sprint bloqueio bloqueio hoje vou ontem fiz', 'Daily');
  assert.equal(clear.key, 'standup'); assert.ok(clear.confidence >= 0.7 && clear.confidence <= 0.9, String(clear.confidence));
});

test('detecting from a meeting reads the transcript, or the notes when it was not kept', () => {
  const m = { title: '', segments: [{ speakerKey: 'a', text: 'A proposta e o orçamento estão prontos, com desconto.' }], attendees: [], speakers: { a: {}, b: {} } };
  assert.equal(T.detectMeeting(m, (k) => k).key, 'sales');
  const noTranscript = { title: '', segments: [], myNotes: 'Entrevista com o candidato: pontos fortes, currículo.', summary: '', attendees: [], speakers: {} };
  assert.equal(T.detectMeeting(noTranscript, (k) => k).key, 'interview');
  assert.equal(T.sampleText({ segments: [{ speakerKey: 'a', text: 'x'.repeat(100) }] }, (k) => k, 20).length, 20);
});

test('the person\'s choice wins; on auto the detected kind is used', () => {
  assert.equal(T.effectiveTemplate({ template: 'standup', templateDetected: { key: 'sales' } }), 'standup');
  assert.equal(T.effectiveTemplate({ template: 'auto', templateDetected: { key: 'sales' } }), 'sales');
  assert.equal(T.effectiveTemplate({ template: 'auto' }), 'auto');
  assert.equal(T.effectiveTemplate({ template: 'auto', templateDetected: { key: 'made-up' } }), 'auto');
  assert.equal(T.effectiveTemplate({}), 'auto');
});

test('the app and the server name two types differently, and both ways are mapped', () => {
  assert.deepEqual(['one_to_one', 'sales', 'standup'].map(T.toServerKey), ['one_on_one', 'sales_call', 'standup']);
  assert.deepEqual(['one_on_one', 'sales_call', 'general'].map(T.fromServerKey), ['one_to_one', 'sales', 'general']);
});

// ------------------------------------------------------------------------------------------------ the email
const meeting = (over = {}) => ({
  title: 'Preços', summary: 'Vão subir os preços 5% em janeiro.', myNotes: '', aiBlocks: [], aiExtra: [], segments: [],
  tasks: [{ text: 'Enviar a lista de preços', owner: 'Ana', due: 'sexta-feira', done: false, hidden: false }, { text: 'Já feito', done: true }, { text: 'Escondida', hidden: true }], ...over,
});

test('the template email has greeting, thanks, recap, next steps and sign-off', () => {
  const e = E.templateEmail({ meeting: meeting(), tone: 'friendly', language: 'pt', senderName: 'Ana Silva', attendeeNames: ['Rui Costa', 'Maria Lopes'] });
  assert.equal(e.subject, 'Resumo da nossa reunião: Preços');
  assert.equal(e.body, ['Olá Rui e Maria,', '', 'Obrigado/a pela reunião de hoje!', '', 'Em resumo:', 'Vão subir os preços 5% em janeiro.', '', 'Próximos passos:', '• Enviar a lista de preços (Ana, sexta-feira)', '', 'Um abraço,', 'Ana Silva'].join('\n'));
});

test('tone and language change the wording; tasks can be left out; finished and hidden tasks never appear', () => {
  const formal = E.templateEmail({ meeting: meeting(), tone: 'formal', language: 'pt', attendeeNames: ['Rui Costa'] });
  assert.match(formal.body, /^Caros Rui,/); assert.match(formal.body, /Com os melhores cumprimentos,/); assert.doesNotMatch(formal.body, /Já feito|Escondida/);
  const direct = E.templateEmail({ meeting: meeting(), tone: 'direct', language: 'en', includeTasks: false });
  assert.match(direct.body, /^Hi,/); assert.doesNotMatch(direct.body, /Thanks|Enviar/); assert.equal(direct.subject, 'Summary: Preços');
  assert.match(E.templateEmail({ meeting: meeting(), language: 'en', attendeeNames: ['A B', 'C D', 'E F'] }).body, /^Hi A, C and E,/);
  assert.match(E.templateEmail({ meeting: meeting(), tone: 'weird' }).body, /^Olá,/);                                  // unknown tone -> friendly
});

test('without a summary the email is built from the person\'s notes, then from what was added', () => {
  const mine = E.templateEmail({ meeting: meeting({ summary: '', myNotes: '- preços\n- lançamento\n\n- suporte', tasks: [] }) });
  assert.match(mine.body, /• preços\n• lançamento\n• suporte/);
  const added = E.templateEmail({ meeting: meeting({ summary: '', tasks: [], aiBlocks: [{ mine: 'a', add: 'dito que sobem' }], aiExtra: [{ text: 'e o suporte avisa' }] }) });
  assert.match(added.body, /• a\n• dito que sobem\n• e o suporte avisa/);
});

test('an email can be drafted for a meeting that has a transcript but no notes yet', () => {
  const m = { title: 'T', summary: '', myNotes: '', aiBlocks: [], tasks: [], segments: [{ speakerKey: 'a', startMs: 0, text: 'Eu envio a lista de preços até sexta-feira.' }], speakers: {}, attendees: [], template: 'auto' };
  assert.ok(E.hasMaterial(E.material({ ...m, summary: 'x' })));
  assert.ok(!E.hasMaterial(E.material(m)));
  const e = E.extractiveEmail(m, (k) => k, { tone: 'friendly', language: 'pt' });
  assert.match(e.body, /Em resumo:/);
});

// ------------------------------------------------------------------------------------------------ mailto
test('recipients: valid addresses are kept once, names in angle brackets are understood, the rest is reported', () => {
  const r = M.parseRecipients('ana@x.pt, Rui Costa <rui@y.ao>; ANA@x.pt\nnot-an-email, "bad"@x, maria@z.co.ao');
  assert.deepEqual(r.valid, ['ana@x.pt', 'rui@y.ao', 'maria@z.co.ao']);
  assert.deepEqual(r.invalid, ['not-an-email', '"bad"@x']);
  assert.deepEqual(M.parseRecipients(['a@b.pt', ' ', 'c']).valid, ['a@b.pt']);
  assert.equal(M.parseRecipients(Array.from({ length: 80 }, (_, i) => `u${i}@x.pt`)).valid.length, 50);
});

test('a short message becomes a plain mailto with CRLF line breaks', () => {
  const { url, truncated } = M.buildMailto({ to: ['ana@x.pt', 'rui@y.ao'], subject: 'Resumo da reunião', body: 'Olá,\nAna' });
  assert.equal(truncated, false);
  assert.equal(url, 'mailto:ana@x.pt,rui@y.ao?subject=Resumo%20da%20reuni%C3%A3o&body=Ol%C3%A1%2C%0D%0AAna');
});

test('a long body is shortened to fit, without cutting a word, and says so', () => {
  const body = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(' ');
  const { url, truncated } = M.buildMailto({ to: ['a@b.pt'], subject: 's', body });
  assert.equal(truncated, true); assert.ok(url.length <= M.MAX_URL, String(url.length));
  const text = decodeURIComponent(url.split('body=')[1]);
  assert.match(text, /palavra\d+\r?\n\r?\n\[…\]$/);                                         // ends with a whole word, then the marker
  assert.ok(text.startsWith('palavra0 palavra1 '));
});

test('the subject is one clean line and invalid recipients never reach the address', () => {
  const { url } = M.buildMailto({ to: 'ok@x.pt, evil@x.pt?bcc=spy@z.com, "x"@y.pt', subject: 'Linha 1\r\nBcc: spy@z.com', body: '' });
  assert.ok(url.startsWith('mailto:ok@x.pt?subject='));
  assert.ok(!url.includes('bcc') && !url.includes('%0D%0ABcc') && !url.includes('%0A'));
  assert.equal(M.cleanLine('a\r\nb\tc', 50), 'a b c');
});
