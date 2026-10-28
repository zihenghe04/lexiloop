const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(require.resolve('../workspace-ui.css'), 'utf8');
const readPage = (page) => fs.readFileSync(require.resolve(`../${page}`), 'utf8');

test('reader loads the shared skin after base styles', () => {
  const html = readPage('pdf-reader.html');
  assert.ok(html.indexOf('workspace-ui.css') > html.indexOf('pdf-reader.css'));
});

// 侧栏已换成 React 入口：不再加载旧 sidepanel.css / workspace-ui.css，
// 改为校验它确实指向构建产物，且保留了纯逻辑模块。
test('sidepanel entry points at the built React bundle', () => {
  const html = readPage('sidepanel.html');
  assert.match(html, /ui-dist\/assets\/app\.css/);
  assert.match(html, /ui-dist\/assets\/app\.js/);
  assert.match(html, /id="root"/);
  assert.match(html, /pdf-library\.js/);
  assert.match(html, /backup\.js/);
});

test('skin preserves PDF geometry, conversation rail clearance and reduced motion', () => {
  assert.doesNotMatch(css, /(?:\.textLayer|\.pdf-page|\.pdf-annotation-layer|canvas)\s*\{/);
  assert.match(css, /padding: 22px 34px 24px 20px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /focus-visible/);
});

test('core foreground tokens have readable contrast on the soft surface', () => {
  const value = name => css.match(new RegExp(`--${name}: (#[a-f0-9]{6})`))[1];
  const lum = color => {
    const components = color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
  };
  for (const token of ['ink', 'muted', 'subtle', 'accent']) {
    const ratio = (lum(value('surface-soft')) + .05) / (lum(value(token)) + .05);
    assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)} must be at least 4.5`);
  }
});