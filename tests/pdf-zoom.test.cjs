const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zoom = require("../pdf-zoom.js");

test("捏合比例一比一还原：一组事件的 deltaY 合计 -100·ln2 时正好放大一倍", () => {
  // Chrome 把一次 2 倍捏合拆成若干个小事件
  const deltas = [-3.2, -10.7, -5.3, -12.4, -8.1, -9.6, -19.99];
  const total = deltas.reduce((sum, value) => sum + value, 0);
  const scaled = deltas.map((deltaY) => [deltaY * (-100 * Math.log(2)) / total])
    .reduce((scale, [deltaY]) => scale * zoom.wheelZoomFactor({ deltaY }), 1);
  assert.ok(Math.abs(scaled - 2) < 1e-9);
});

test("张开再合拢回到原比例；缩小与放大对称", () => {
  const up = zoom.wheelZoomFactor({ deltaY: -12 });
  const down = zoom.wheelZoomFactor({ deltaY: 12 });
  assert.ok(up > 1 && down < 1);
  assert.ok(Math.abs(up * down - 1) < 1e-12);
});

test("鼠标滚轮一格（deltaY 100 或按行计）单次最多缩放 1.25 倍", () => {
  assert.equal(zoom.wheelZoomFactor({ deltaY: -100 }), zoom.MAX_STEP);
  assert.equal(zoom.wheelZoomFactor({ deltaY: 3, deltaMode: 1 }), 1 / zoom.MAX_STEP);
  assert.equal(zoom.wheelZoomFactor({ deltaY: 0 }), 1);
  assert.equal(zoom.wheelZoomFactor({ deltaY: Number.NaN }), 1);
});

test("缩放以指针为中心：指针下的页内位置在缩放前后不变", () => {
  const before = { left: 100, top: -200, width: 600, height: 800 };
  const after = { left: 40, top: -320, width: 900, height: 1200 }; // 放大 1.5 倍、滚动前
  const pointer = { clientX: 400, clientY: 300 };
  const next = zoom.anchoredScroll({ scrollLeft: 0, scrollTop: 1000, before, after, ...pointer });
  // 指针在页面上的比例位置
  const fx = (pointer.clientX - before.left) / before.width;
  const fy = (pointer.clientY - before.top) / before.height;
  // 滚动后页面平移 (next - 原滚动)，指针下仍是同一比例位置
  const shiftedLeft = after.left - (next.left - 0);
  const shiftedTop = after.top - (next.top - 1000);
  assert.ok(Math.abs((pointer.clientX - shiftedLeft) / after.width - fx) < 1e-9);
  assert.ok(Math.abs((pointer.clientY - shiftedTop) / after.height - fy) < 1e-9);
});

test("阅读器：捏合用 pdf-zoom 换算、按帧合并排版、停手后重绘", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  assert.match(source, /window\.addEventListener\("wheel", handleZoomWheel, \{ passive: false \}\)/);
  assert.match(source, /LexiLoopPdfZoom\.wheelZoomFactor\(/);
  assert.match(source, /requestAnimationFrame\(applyPinchFrame\)/);
  assert.match(source, /pinchCommitTimer = setTimeout\(commitPinchZoom, 160\)/);
  assert.doesNotMatch(source, /Math\.log\(1\.2\)/);
  const html = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.html"), "utf8");
  assert.ok(html.indexOf("pdf-zoom.js") > 0 && html.indexOf("pdf-zoom.js") < html.indexOf("pdf-reader.js"));
});
