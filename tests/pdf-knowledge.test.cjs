const test = require('node:test');
const assert = require('node:assert/strict');
const { patch } = require('../pdf-knowledge.js');
test('regenerating or deleting AI draft preserves edited notes and conversation notes', () => {
  let entry = patch({}, 'edit', 'My own interpretation');
  entry = patch(entry, 'note', 'Saved answer');
  const id = entry.notes[0].id;
  entry = patch(entry, 'generate', 'A claim [p. 3]');
  entry = patch(entry, 'generate', 'A revised claim [p. 4]');
  assert.equal(entry.edited, 'My own interpretation');
  assert.equal(entry.notes[0].text, 'Saved answer');
  entry = patch(entry, 'clear-generated');
  assert.equal(entry.generated, '');
  assert.equal(entry.notes.length, 1);
  assert.equal(patch(entry, 'remove-note', id).notes.length, 0);
});
test('knowledge page preserves notes over the old character limit', () => {
  const long = 'x'.repeat(110000);
  assert.equal(patch({}, 'edit', long).edited.length, long.length);
  assert.equal(patch({}, 'note', long).notes[0].text.length, long.length);
});
