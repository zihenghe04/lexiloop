const test = require('node:test');
const assert = require('node:assert/strict');
const exporter = require('../paper-export.js');
test('citation keys are unique even when suffixes already exist', () => {
  assert.deepEqual(exporter.records([{ citationKey: 'x' }, { citationKey: 'x' }, { citationKey: 'x_2' }, { citationKey: 'x' }]).map(x => x.key), ['x', 'x_2', 'x_2_2', 'x_3']);
});
test('BibTeX escapes text and preserves literal author names', () => {
  const result = exporter.bibtex([{ title: 'A {B} & 50%', authors: ['Research and Development'], citationKey: 'bad,}\nkey', entryType: 'inproceedings', venue: 'Conf', year: 2026 }]);
  assert.match(result, /title = \{A \\\{B\\\} \\& 50\\%\}/);
  assert.match(result, /author = \{\{Research and Development\}\}/);
  assert.match(result, /booktitle = \{Conf\}/);
  assert.ok(!result.includes('bad,}'));
});
test('CSL keeps known metadata without inventing missing dates or name parts', () => {
  const [item, empty] = exporter.csl([{ title: 'Paper', authors: ['张三'], year: 2020, doi: '10.1/x', entryType: 'article' }, {}]);
  assert.deepEqual(item.author, [{ literal: '张三' }]);
  assert.deepEqual(item.issued, { 'date-parts': [[2020]] });
  assert.equal(item.type, 'article-journal');
  assert.equal(item.DOI, '10.1/x');
  assert.equal(empty.issued, undefined);
});
