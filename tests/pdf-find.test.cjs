const test = require('node:test');
const assert = require('node:assert/strict');
const find = require('../pdf-find.js');

test('pattern is case-insensitive by default and tolerates lost spaces at line joins', () => {
  const pattern = find.buildPattern('Neural  Network');
  const text = 'A neuralnetwork and a Neural Network and NEURAL\nNETWORK.';
  assert.deepEqual(find.findAll(text, pattern).map(m => text.slice(m.start, m.end)), ['neuralnetwork', 'Neural Network', 'NEURAL\nNETWORK']);
  assert.equal(find.findAll(text, find.buildPattern('Neural Network', { caseSensitive: true })).length, 1);
});

test('special characters are matched literally and empty queries yield no pattern', () => {
  assert.equal(find.buildPattern('   '), null);
  const pattern = find.buildPattern('f(x) = x^2 [1]');
  assert.equal(find.findAll('where f(x) = x^2 [1] holds', pattern).length, 1);
  assert.equal(find.findAll('a.b', find.buildPattern('.')).length, 1);
});

test('page text joins text items like the pdf.js text layer', () => {
  const content = { items: [{ str: 'Atten' }, { type: 'beginMarkedContent' }, { str: 'tion is all' }, { str: '' }, { str: ' you need' }] };
  assert.equal(find.pageText(content), 'Attention is all you need');
  assert.equal(find.pageText(null), '');
});

test('locate maps offsets spanning several text nodes', () => {
  const nodes = [{ data: 'Atten' }, { data: 'tion is' }, { data: ' all' }];
  const located = find.locate(nodes, 3, 9);
  assert.equal(located.from.node, nodes[0]);
  assert.equal(located.from.offset, 3);
  assert.equal(located.to.node, nodes[1]);
  assert.equal(located.to.offset, 4);
  assert.equal(find.locate(nodes, 10, 40), null);
});

test('global and per-page match indexes convert both ways', () => {
  const counts = new Map([[1, 2], [2, 0], [3, 3], [4, 1]]);
  assert.deepEqual(find.resolveIndex(counts, 0), { pageNumber: 1, ordinal: 0 });
  assert.deepEqual(find.resolveIndex(counts, 2), { pageNumber: 3, ordinal: 0 });
  assert.deepEqual(find.resolveIndex(counts, 5), { pageNumber: 4, ordinal: 0 });
  assert.equal(find.resolveIndex(counts, 6), null);
  assert.equal(find.globalIndex(counts, 3, 1), 3);
  assert.equal(find.firstIndexFromPage(counts, 2), 2);
  assert.equal(find.firstIndexFromPage(counts, 5), 0);
  assert.equal(find.firstIndexFromPage(new Map([[1, 0]]), 1), -1);
});
