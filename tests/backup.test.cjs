const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../backup.js'), 'utf8');
const api = require('../backup.js');
test('rejects secrets, unsupported versions and malformed PDF records before restore', () => {
  const data = { format: 'lexiloop-backup', version: 1, local: {}, files: [], indexes: [] };
  assert.equal(api.validate(data), data);
  assert.throws(() => api.validate({ ...data, version: 9 }));
  assert.throws(() => api.validate({ ...data, local: { lexiloopTranslationSecrets: {} } }));
  assert.throws(() => api.validate({ ...data, files: [{ id: 'a', base64: 'invalid%' }] }));
  assert.throws(() => api.validate({ ...data, local: { lexiloopPdfKnowledge: [] } }));
});
test('round trips PDF bytes and rolls back interrupted storage restore', { skip: !process.env.LEXILOOP_TEST_DEPS }, async () => {
  const { IDBFactory } = require(process.env.LEXILOOP_TEST_DEPS + '/fake-indexeddb');
  const state = { lexiloopWords: [{ id: 'original' }], lexiloopTranslationSecrets: { apiKey: 'not-exported' } };
  let failNextSet = false;
  const local = {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state).map(k => [k, structuredClone(state[k])])); },
    async set(items) { if (failNextSet && items.lexiloopWords) { failNextSet = false; throw new Error('injected failure'); } Object.assign(state, structuredClone(items)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; }
  };
  class Reader {
    async readAsDataURL(blob) { this.result = 'data:application/pdf;base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onload(); }
  }
  const context = vm.createContext({ indexedDB: new IDBFactory(), Blob, FileReader: Reader, atob,
    chrome: { storage: { local } }, Uint8Array, console });
  vm.runInContext(source, context);
  const backup = context.LexiLoopBackup;
  const incoming = { format: 'lexiloop-backup', version: 1,
    local: { lexiloopWords: [{ id: 'new' }], lexiloopPdfLibrary: [{ id: 'pdf-a' }] },
    files: [{ id: 'pdf-a', base64: Buffer.from('%PDF-1.7\nExample').toString('base64') }], indexes: [{ id: 'pdf-a', pages: [] }] };
  const file = new Blob([JSON.stringify(incoming)]);
  await backup.importData(file);
  const exported = JSON.parse(await (await backup.exportData()).text());
  assert.deepEqual(exported.files, incoming.files);
  assert.deepEqual(exported.local, incoming.local);
  assert.ok(!JSON.stringify(exported).includes('not-exported'));
  await backup.recover();
  assert.equal(state.lexiloopWords[0].id, 'original');
  assert.equal(state.lexiloopTranslationSecrets.apiKey, 'not-exported');
  failNextSet = true;
  await assert.rejects(backup.importData(file), /injected failure/);
  assert.equal(state.lexiloopWords[0].id, 'original');
  assert.equal(state.lexiloopRestorePending, undefined);
});
