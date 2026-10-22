const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { Repo } = require('../src/main/repo');

function tmpDir(prefix = 'ivuenu-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function newRepo() {
  const dir = tmpDir();
  const store = new Store(path.join(dir, 'data.json'), { debounceMs: 5 });
  const events = [];
  const repo = new Repo(store, (...e) => events.push(e));
  return { dir, store, repo, events };
}

module.exports = { tmpDir, newRepo };
