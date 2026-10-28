const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// 回归：tests/pdf-reader-preview.html 是自动化验收用的预览页，必须和真实页 pdf-reader.html 结构一致。
// 曾经它手工维护，落后于产品：缺 pdf-zoom.js / reader-center.js 导致脚本报错、缺「暂停」「只翻本页」
// 按钮导致按钮点不到、还是旧顶栏。现在由 scripts/build-reader-preview.cjs 生成。
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const scripts = (html, prefix) =>
  [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split("?")[0].replace(prefix, ""));

test("preview page carries every element id and script of the real reader page", () => {
  const real = read("pdf-reader.html");
  const preview = read("tests/pdf-reader-preview.html");
  assert.deepEqual([...ids(real)].filter((id) => !ids(preview).has(id)), [], "preview is missing element ids");
  const missing = scripts(real, "").filter((name) => !scripts(preview, "../").includes(name));
  assert.deepEqual(missing, [], "preview is missing scripts");
  const extra = scripts(preview, "../").filter((name) => !scripts(real, "").includes(name));
  assert.deepEqual(extra, ["pdf-reader-preview-mocks.js"], "only the preview stub may be extra");
});