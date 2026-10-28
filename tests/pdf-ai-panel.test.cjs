const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("../pdf-ai-panel.js");

test("clamps the PDF AI panel while leaving room for the document", () => {
  assert.equal(panel.clampWidth(100, 1440), panel.MIN_WIDTH);
  assert.equal(panel.clampWidth(900, 1440), panel.MAX_WIDTH);
  assert.equal(panel.clampWidth(650, 800), 480);
  assert.equal(panel.clampWidth(650, 800, 224), panel.MIN_WIDTH);
  assert.equal(panel.clampWidth(500, 390), Math.floor(390 * 0.92));
  assert.equal(panel.clampWidth(500, 240), Math.floor(240 * 0.92));
});

test("dragging the left edge left makes the panel wider", () => {
  assert.equal(panel.widthFromDrag(356, 1000, 900, 1440), 456);
  assert.equal(panel.widthFromDrag(356, 1000, 1080, 1440), 280);
});
