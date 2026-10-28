// 回归：查词结果必须展示音标、词性释义和发音。
// 后台有道返回的是 phonetics 对象（{uk,us,generic}）、meanings 数组和 service 字段，
// 早期重写版误用了不存在的 word.phonetic 和 result.engine，导致音标与词典释义全丢。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(require.resolve(`../${path}`), 'utf8');

test('查词页渲染音标、词性释义、发音和真实引擎名', () => {
  const page = read('ui/src/pages/LookupPage.jsx');
  assert.match(page, /const phonetics = formatPhonetics\(result\?\.phonetics\)/);
  assert.match(page, /result\?\.meanings/);
  assert.match(page, /partOfSpeech/);
  assert.match(page, /SpeakButton/);
  assert.match(page, /result\.service/);
  assert.match(page, /result\.detectedLanguage/);
  assert.doesNotMatch(page, /result\.engine/);
});

test('词库页用 phonetics 对象，不再引用不存在的 phonetic 字段', () => {
  const page = read('ui/src/pages/WordsPage.jsx');
  assert.match(page, /formatPhonetics\(word\.phonetics\)/);
  assert.doesNotMatch(page, /word\.phonetic\b/);
});

test('整句翻译不声称已收录（recorded=false）', () => {
  const page = read('ui/src/pages/LookupPage.jsx');
  assert.match(page, /result\.recorded === false/);
});

test('音标格式化与旧版一致：英 / 美 / 通用', async () => {
  const { formatPhonetics } = await import('../ui/src/lib/format.js');
  assert.equal(formatPhonetics({ uk: 'əˈtenʃn', us: 'əˈtenʃn' }), '英 /əˈtenʃn/  美 /əˈtenʃn/');
  assert.equal(formatPhonetics({ uk: '/əˈtenʃn/' }), '英 /əˈtenʃn/');
  assert.equal(formatPhonetics({ generic: 'test' }), '/test/');
  assert.equal(formatPhonetics({}), '');
  assert.equal(formatPhonetics(null), '');
});

test('释义摘要优先词典义项，没有时退回译文', async () => {
  const { meaningSummary } = await import('../ui/src/lib/format.js');
  assert.equal(
    meaningSummary({ translated: "嵌入", meanings: [{ definitions: ["嵌入", "嵌入向量"] }, { definitions: ["内嵌"] }] }),
    "嵌入；嵌入向量；内嵌"
  );
  assert.equal(
    meaningSummary({ translated: "嵌入", meanings: [{ definitions: ["嵌入", "嵌入向量"] }, { definitions: ["内嵌"] }, { definitions: ["第三"] }] }, 1),
    "嵌入；嵌入向量"
  );
  assert.equal(meaningSummary({ translated: "嵌入", meanings: [] }), "嵌入");
  assert.equal(meaningSummary({ translated: "嵌入" }), "嵌入");
});