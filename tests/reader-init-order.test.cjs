const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// 回归：顶层调用 applyReaderTheme() 时其依赖的 const 必须已声明，否则 TDZ 会中断 initialize()，
// 导致文献库「继续阅读」等所有打开 PDF 的路径失效。
test("reader theme constants are declared before top-level theme initialization", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  const call = source.search(/^applyReaderTheme\(/m);
  assert.ok(call > 0, "top-level applyReaderTheme call not found");
  for (const name of ["READER_THEME_KEY", "READER_THEMES", "READER_THEME_LABELS"]) {
    const declaration = source.search(new RegExp(`^const ${name} =`, "m"));
    assert.ok(declaration >= 0 && declaration < call, `${name} must be declared before applyReaderTheme() runs`);
  }
  assert.ok(source.search(/^initialize\(\);/m) > call);
});

// 回归：initialize() 是顶层立即执行的入口，它和它调用的清理路径会读顶层状态。
// 状态若声明在 initialize() 之后（夹在函数之间），就会抛
// "Cannot access 'x' before initialization"——aiAbortController 曾让打开任意 PDF 直接失败。
test("all top-level state is declared before initialize() runs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  const lines = source.split("\n");
  const callIndex = lines.findIndex((line) => line.trim() === "initialize();");
  assert.ok(callIndex > 0, "top-level initialize() call not found");
  const late = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > callIndex && /^(?:let|const) [A-Za-z_$]/.test(line))
    .map(({ line, index }) => `${line.split(" ")[1]?.replace(/[=;].*$/, "")} on line ${index + 1}`);
  assert.deepEqual(late, [], "move these declarations above initialize()");
});
