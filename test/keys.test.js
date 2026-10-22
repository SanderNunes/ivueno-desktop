const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');
const read = (name) => JSON.parse(fs.readFileSync(path.join(assets, name), 'utf8'));

for (const name of ['licence-public-keys.json', 'licence-public-keys.dev.json']) {
  test(`${name}: every entry is a valid Ed25519 PUBLIC key`, () => {
    const keys = read(name);
    assert.ok(Array.isArray(keys));
    for (const pem of keys) {
      assert.match(pem, /BEGIN PUBLIC KEY/);
      assert.doesNotMatch(pem, /PRIVATE/);
      assert.equal(crypto.createPublicKey(pem).asymmetricKeyType, 'ed25519');
    }
  });
}

test('the release list is not empty (a packaged app refuses to start without it) and does not contain the development key', () => {
  const release = read('licence-public-keys.json');
  const dev = read('licence-public-keys.dev.json');
  assert.ok(release.length >= 1);
  for (const k of dev) assert.ok(!release.includes(k), 'the dev key must never ship in a release');
});
