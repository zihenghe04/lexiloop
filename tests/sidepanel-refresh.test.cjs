// 侧栏已经是 React 界面（ui/ 构建到 ui-dist/），因此这里校验新界面提供同样的能力：
// 主题跟随阅读器、文献状态筛选齐全、三套主题与减少动效。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('侧栏主题跟随阅读器，并在首帧前应用', () => {
  const app = read('ui/src/App.jsx');
  assert.match(app, /applyTheme\(readTheme\(\)\)/);
  assert.match(app, /lexiloopReaderTheme/);
  assert.match(app, /event\.key !== "lexiloopReaderTheme"/);
  assert.match(read('ui/src/lib/bridge.js'), /THEME_KEY = "lexiloopReaderTheme"/);
});

test('文献筛选覆盖全部状态', () => {
  const page = read('ui/src/pages/LibraryPage.jsx');
  for (const status of ['all', 'unread', 'reading', 'read', 'favorite']) {
    assert.match(page, new RegExp(`value: "${status}"`), `筛选保留 ${status}`);
  }
  assert.match(page, /filterPapers\(papers, \{ query, filter, sort \}\)/);
  assert.match(page, /paper\.favorite/);
});

test('三套主题与减少动效都在新样式里', () => {
  const css = read('ui/src/styles/app.css');
  assert.match(css, /\[data-theme="sepia"\]/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});