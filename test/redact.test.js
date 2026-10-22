const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../src/main/redact');

test('hides a valid card number and counts it', () => {
  const r = redact('o meu cartão é 4111 1111 1111 1111 obrigado');
  assert.ok(!r.text.includes('4111'));
  assert.equal(r.count, 1);
});

test('leaves a long number that fails the Luhn check alone', () => {
  const r = redact('referência 1234 5678 9012 3456');
  assert.equal(r.text, 'referência 1234 5678 9012 3456');
  assert.equal(r.count, 0);
});

test('hides spoken passwords after a cue, in Portuguese and English', () => {
  assert.equal(redact('a palavra-passe é abc123 ok').text, 'a palavra-passe •••• ok');
  assert.match(redact('my password is hunter2').text, /password ••••/);
});

test('hides emails, IBANs and phone numbers', () => {
  const r = redact('escreve para ana@exemplo.ao ou liga +244 923 456 789, IBAN AO06 0040 0000 1234 5678 1011 2');
  assert.ok(!r.text.includes('ana@exemplo.ao'));
  assert.ok(!r.text.includes('923 456'));
  assert.ok(!r.text.includes('AO06'));
  assert.equal(r.count, 3);
});

test('hides links that carry a key', () => {
  assert.match(redact('abre https://x.ao/p?token=abc123').text, /ligação com chave/);
});

test('normal sentences pass through untouched', () => {
  const s = 'Concordo, mas temos de avisar os clientes com um mês de antecedência.';
  assert.deepEqual(redact(s), { text: s, count: 0 });
});
