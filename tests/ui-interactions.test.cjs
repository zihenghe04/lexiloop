const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function slice(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from >= 0, `找不到 ${start}`);
  return source.slice(from, to > 0 ? to : undefined);
}

test("打开文献：消息字段用后台契约里的 libraryId", () => {
  const bridge = read("ui/src/lib/bridge.js");
  const fn = slice(bridge, "export async function openReader", "export async function openPdfReaderBlank");
  assert.match(fn, /libraryId:/);
  // 曾经写成 paperId，后台读不到，会退回 sender.tab.url，表现为点了没反应
  assert.doesNotMatch(fn, /paperId:\s*paperId/);
  assert.doesNotMatch(fn, /\{\s*paperId\s*\}/);
});

test("后台 OPEN_PDF_READER 认的是 libraryId", () => {
  const background = read("background.js");
  assert.match(background, /message\.libraryId/);
});

test("从词库跳原文：带上文献 id、页码和词形", () => {
  const bridge = read("ui/src/lib/bridge.js");
  const fn = slice(bridge, "export async function openWordSource", "export async function openSettingsShortcuts");
  assert.match(fn, /libraryId: source\.paperId/);
  assert.match(fn, /page:/);
  assert.match(fn, /find: word\.original/);
});

test("词库主点击是展开词条，不是跳去查词页", () => {
  const words = read("ui/src/pages/WordsPage.jsx");
  assert.match(words, /onClick=\{\(\) => toggle\(key\)\}/);
  assert.match(words, /查过 \{/);
  assert.match(words, /openWordSource/);
  assert.match(words, /aria-expanded=\{open\}/);
  // 重查是独立按钮，不能再挂在整行的点击上
  assert.doesNotMatch(words, /className="row-hover[^"]*"\s*\n\s*onClick=\{\(\) => onLookup\(word\)\}/);
});

test("词库展开面板用 grid-rows 过渡，并遵守减少动态效果", () => {
  const css = read("ui/src/styles/app.css");
  assert.match(css, /\.word-row__panel\s*\{[\s\S]*?grid-template-rows:\s*0fr/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.word-row__panel/);
});

test("继续阅读的进度是数字，不会再渲染 NaN%", () => {
  const library = read("ui/src/pages/LibraryPage.jsx");
  assert.doesNotMatch(library, /Math\.round\(percent\(/);
  assert.match(library, /Math\.round\(Number\(current\?\.progress/);
});

test("文献库列表不再用逐条灰色卡片，改为连续行", () => {
  const library = read("ui/src/pages/LibraryPage.jsx");
  assert.match(library, /className="library-list mt-3"/);
  assert.match(library, /className="library-row group"/);
  assert.doesNotMatch(library, /overflow-hidden rounded-lg border border-border bg-background">\s*\n\s*\{list\.map/);
});

test("设置页保留 CC Switch 导入入口，侧栏也加载了导入模块", () => {
  const html = read("sidepanel.html");
  assert.match(html, /<script src="cc-switch-import\.js"><\/script>/);
  const settings = read("ui/src/pages/SettingsPage.jsx");
  assert.match(settings, /从 CC Switch 导入/);
  assert.match(settings, /ccSwitchPreview/);
  // 全局模块名必须与 cc-switch-import.js 实际挂载的名字一致
  assert.match(read("cc-switch-import.js"), /root\.LexiLoopCcSwitch = api/);
  assert.match(settings, /globalThis\.LexiLoopCcSwitch\?\./);
  assert.doesNotMatch(settings, /LexiLoopCcSwitchImport/);
  // 导入必须把候选里的 Key 一起写入，否则只能得到一条没有认证的连接
  assert.match(settings, /apiKey: item\.apiKey/);
  // 导入沿用与预设相同的配置结构，避免两条路径字段漂移
  assert.match(settings, /function connectionConfig\(/);
  assert.match(settings, /config: connectionConfig\(chosen, id\)/);
});