const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const center = require("../reader-center.js");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("我的学习：数量与个人中心一致（无排期或已到期都算待复习）", () => {
  const now = Date.parse("2026-10-26T00:00:00Z");
  const words = [
    { review: { dueAt: "2026-10-25T00:00:00Z" } },
    { review: { dueAt: "2026-10-27T00:00:00Z" } },
    {},
    { review: { dueAt: "not a date" } }
  ];
  assert.deepEqual({ ...center.centerCounts(words, [{}, {}], now) }, { words: 4, due: 3, papers: 2 });
  assert.deepEqual({ ...center.centerCounts(null, undefined, now) }, { words: 0, due: 0, papers: 0 });
});

test("我的学习：只有待复习在有数时强调，零不显示", () => {
  const nodes = {};
  const doc = { getElementById: (id) => (nodes[id] ||= { textContent: "", classes: new Set(), classList: { toggle(name, on) { on ? this.owner.classes.add(name) : this.owner.classes.delete(name); } } }) };
  ["centerWordCount", "centerDueCount", "centerPaperCount"].forEach((id) => { doc.getElementById(id).classList.owner = nodes[id]; });
  center.render(doc, { words: 8, due: 5, papers: 0 });
  assert.equal(nodes.centerWordCount.textContent, "8");
  assert.equal(nodes.centerPaperCount.textContent, "");
  assert.equal(nodes.centerDueCount.classes.has("is-attention"), true);
  assert.equal(nodes.centerWordCount.classes.has("is-attention"), false);
  center.render(doc, { words: 8, due: 0, papers: 1 });
  assert.equal(nodes.centerDueCount.classes.has("is-attention"), false);
});

test("阅读器外壳：三区顶栏、更多菜单收纳低频操作、侧栏底部是我的学习", () => {
  const html = read("pdf-reader.html");
  const center = html.indexOf('class="toolbar-center"');
  const actions = html.indexOf('class="toolbar-actions"');
  assert.ok(center > 0 && center < actions, "阅读模式在中区");
  assert.ok(html.indexOf('id="readingModeSwitch"') > center && html.indexOf('id="readingModeSwitch"') < actions);
  const menu = html.slice(html.indexOf('id="moreMenu"'), html.indexOf('id="aiPanelButton"'));
  for (const id of ["openFileButton", "addToLibraryButton", "indexDocumentButton", "knowledgeButton", "downloadButton", "printButton"]) {
    assert.match(menu, new RegExp(`id="${id}"`), `${id} 在更多菜单里`);
  }
  assert.match(html, /popovertarget="moreMenu"/);
  const sidebar = html.slice(html.indexOf('id="readerSidebar"'), html.indexOf("</aside>"));
  assert.ok(sidebar.indexOf("reader-center-links") > sidebar.lastIndexOf("data-sidebar-panel="), "我的学习在侧栏面板之后");
  for (const tab of ["words", "review", "library"]) assert.match(sidebar, new RegExp(`data-panel-tab="${tab}"`));
  assert.match(html, /<script src="reader-center\.js"><\/script>\s*<script src="pdf-reader\.js">/);
  assert.match(html, /href="ui-shell\.css"/);
});

test("个人中心：标签顺序为查词、词库、复习、文献", () => {
  // 侧栏已换成 React（ui/src/App.jsx），导航顺序以 NAV 定义为准
  const app = read("ui/src/App.jsx");
  const start = app.indexOf("const NAV = [");
  const nav = app.slice(start, app.indexOf("];", start));
  const order = [...nav.matchAll(/id: "(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["lookup", "words", "review", "library"]);
});

test("设计令牌：三套主题都定义了同一组外壳令牌", () => {
  const css = read("ui-shell.css");
  const blocks = css.split(/\n(?=:root|:is\(html\[data-reader-theme)/);
  const names = (block) => new Set([...block.matchAll(/(--ll-[a-z0-9-]+):/g)].map((match) => match[1]));
  const light = names(blocks.find((block) => block.startsWith(":root {")));
  const sepia = names(blocks.find((block) => block.includes('"sepia"')));
  const dark = names(blocks.find((block) => block.includes('"dark"')));
  for (const token of ["--ll-chrome", "--ll-surface", "--ll-line", "--ll-ink", "--ll-muted", "--ll-hover", "--ll-selected", "--ll-track"]) {
    assert.ok(light.has(token) && sepia.has(token) && dark.has(token), token);
  }
});
