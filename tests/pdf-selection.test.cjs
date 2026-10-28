const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const selection = require("../pdf-selection.js");

test("keeps PDF text-layer glyphs unnormalized like the official PDF.js viewer", () => {
  const readerSource = fs.readFileSync(require.resolve("../pdf-reader.js"), "utf8");
  assert.match(readerSource, /textLayerContent[\s\S]*disableNormalization:\s*true/);
  assert.match(readerSource, /textContentSource:\s*textLayerSource\(textLayerContent\)/);
  assert.match(
    readerSource,
    /addAnnotationFromSelection\(pendingAnnotationSelection[\s\S]*clearPageSelection\(\);[\s\S]*await persistAnnotations\(\)/
  );
});

test("uses the PDF user unit at every supported reader zoom", () => {
  for (const zoom of [0.5, 1, 1.5, 2.5]) {
    assert.equal(selection.effectiveTextScale({ scale: zoom, userUnit: 2 }), zoom * 2);
  }
  assert.equal(selection.effectiveTextScale({ scale: 1.5 }), 1.5);

  const properties = new Map();
  const element = { style: { setProperty(name, value) { properties.set(name, value); } } };
  assert.equal(selection.applyViewportScale(element, { scale: 1.5, userUnit: 2 }), 3);
  assert.deepEqual(Object.fromEntries(properties), {
    "--scale-factor": "1.5",
    "--user-unit": "2"
  });
});

test("expands a nearly complete Latin word to its true boundary", () => {
  const text = "A resilient reading tool";
  assert.deepEqual(selection.correctWordBoundaries(text, 2, 10), { start: 2, end: 11 });
  assert.equal(text.slice(2, 11), "resilient");
});

test("drops a one-character spill into the adjacent word", () => {
  const text = "A resilient reading tool";
  assert.deepEqual(selection.correctWordBoundaries(text, 2, 13), { start: 2, end: 11 });
});

test("recovers a quoted PDF word when hit testing starts at its connector", () => {
  const text = "The concept of \u201cclosure\u201d.";
  const corrected = selection.correctWordBoundaries(text, 12, 20);
  assert.deepEqual(corrected, { start: 16, end: 23 });
  assert.equal(text.slice(corrected.start, corrected.end), "closure");
});

test("keeps an unquoted connector phrase while completing its last word", () => {
  const text = "vectors of closure spaces";
  assert.deepEqual(selection.correctWordBoundaries(text, 8, 15), { start: 8, end: 18 });
});

test("corrects word edges within separate PDF text spans", () => {
  assert.equal(selection.correctBoundaryOffset("crux", 4, "end", true), 4);
  assert.equal(selection.correctBoundaryOffset("of", 1, "end", true), 0);
  assert.equal(selection.correctBoundaryOffset("closure", 4, "end", true), 7);
  assert.equal(selection.correctBoundaryOffset("resilient", 8, "end", true), 9);
  assert.equal(selection.correctBoundaryOffset("matter", 5, "start", true), 6);
});

test("preserves intentional phrases while completing their boundary words", () => {
  const text = "A resilient reading tool";
  assert.deepEqual(selection.correctWordBoundaries(text, 3, 18), { start: 2, end: 19 });
});

test("preserves an intentional middle-of-word selection", () => {
  const text = "A resilient reading tool";
  assert.deepEqual(selection.correctWordBoundaries(text, 4, 8), { start: 4, end: 8 });
});

test("handles a single word split across PDF text spans", () => {
  const textFromSpans = ["resi", "lient"].join("");
  assert.deepEqual(selection.correctWordBoundaries(textFromSpans, 0, 8), { start: 0, end: 9 });
});

test("does not expand CJK selections that have no Latin word boundary", () => {
  assert.deepEqual(selection.correctWordBoundaries("阅读长篇文献", 2, 5), { start: 2, end: 5 });
});

test("normalizes PDF ligatures before translation or search", () => {
  assert.equal(selection.cleanText("ef\ufb01cient  retrieval"), "efficient retrieval");
  assert.equal(selection.cleanText("x\u00b2 + y\u00b2"), "x\u00b2 + y\u00b2");
});

test("merges duplicate rectangles on one selected line", () => {
  const [rect] = selection.mergeSelectionRects([
    { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
    { x: 0.39, y: 0.201, width: 0.2, height: 0.02 },
    { x: 0.1, y: 0.2, width: 0.49, height: 0.02 }
  ]);
  assert.equal(selection.mergeSelectionRects([rect]).length, 1);
  assert.ok(Math.abs(rect.x - 0.1) < 1e-9);
  assert.ok(Math.abs(rect.y - 0.2) < 1e-9);
  assert.ok(Math.abs(rect.width - 0.49) < 1e-9);
  assert.ok(Math.abs(rect.height - 0.021) < 1e-9);
});

test("splits vertical overlap between adjacent selected lines", () => {
  const rects = selection.mergeSelectionRects([
    { x: 0.1, y: 0.2, width: 0.8, height: 0.04 },
    { x: 0.1, y: 0.235, width: 0.7, height: 0.04 }
  ]);
  assert.equal(rects.length, 2);
  assert.ok(Math.abs(rects[0].y + rects[0].height - rects[1].y) < 1e-9);
  assert.ok(Math.abs(rects[0].height - 0.0375) < 1e-9);
  assert.ok(Math.abs(rects[1].height - 0.0375) < 1e-9);
});
