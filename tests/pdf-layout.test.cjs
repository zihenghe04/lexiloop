const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTranslationLines, shouldTranslateText } = require("../pdf-layout.js");

test("keeps table symbols separate from translatable meaning cells", () => {
  const lines = buildTranslationLines([
    { text: "Symbol", x: 40, top: 20, width: 45, height: 12 },
    { text: "Typical meaning", x: 180, top: 20, width: 90, height: 12 },
    { text: "A, B, C", x: 40, top: 40, width: 50, height: 12 },
    { text: "Matrices are bold uppercase", x: 180, top: 40, width: 150, height: 12 }
  ], 420);

  assert.deepEqual(lines.map((line) => line.text), [
    "Symbol",
    "Typical meaning",
    "Matrices are bold uppercase"
  ]);
  assert.equal(lines[0].x, 40);
  assert.ok(lines[0].width < 140);
  assert.equal(lines[2].x, 180);
});

test("joins nearby PDF text fragments into one sentence", () => {
  const lines = buildTranslationLines([
    { text: "Resilient", x: 64, top: 80, width: 48, height: 12 },
    { text: "reading tools", x: 116, top: 80, width: 70, height: 12 },
    { text: "preserve context.", x: 190, top: 80, width: 92, height: 12 }
  ], 500);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Resilient reading tools preserve context.");
});

test("does not translate standalone formulas or mathematical identifiers", () => {
  ["A, B, C", "x^T y", "dim", "ker(Phi)", "R^n", "https://example.com"]
    .forEach((text) => assert.equal(shouldTranslateText(text), false, text));
  assert.equal(shouldTranslateText("Dimensionality of vector space"), true);
  assert.equal(shouldTranslateText("Sets"), true);
  assert.equal(shouldTranslateText("符号的典型含义"), true);
});

const { buildTranslationBlocks } = require("../pdf-layout.js");
// 构造两栏正文：每栏 4 行，行高 10、行距 12；左栏 x=50..286，右栏 x=309..545
function twoColumnPage() {
  const items = [];
  const left = ["Deeper neural networks are more difficult to train. We", "present a residual learning framework to ease the train-", "ing of networks that are substantially deeper than those", "used previously."];
  const right = ["Driven by the significance of depth, a question arises: Is", "learning better networks as easy as stacking more layers?", "An obstacle to answering this question was the notorious", "problem of vanishing gradients."];
  left.forEach((text, i) => items.push({ text, x: 50, top: 100 + i * 12, width: i === 3 ? 70 : 236, height: 10 }));
  right.forEach((text, i) => items.push({ text, x: 309, top: 100 + i * 12, width: i === 3 ? 140 : 236, height: 10 }));
  return items;
}

test("paragraph blocks keep the two columns apart and join hyphenated lines", () => {
  const blocks = buildTranslationBlocks(twoColumnPage(), 612);
  assert.equal(blocks.length, 2);
  const [left, right] = blocks.sort((a, b) => a.x - b.x);
  assert.equal(left.x, 50);
  assert.ok(left.x + left.width <= 290, "left block must not cross into the right column");
  assert.equal(right.x, 309);
  assert.equal(left.lineCount, 4);
  assert.match(left.text, /ease the training of networks/);
  assert.doesNotMatch(left.text, /train- ing/);
});

test("section headings, captions and rotated watermarks stay out of body paragraphs", () => {
  const items = [
    { text: "3.1. Residual Learning", x: 50, top: 80, width: 106, height: 11 },
    { text: "Let us consider H(x) as an underlying mapping to be fit by", x: 50, top: 96, width: 236, height: 10 },
    { text: "a few stacked layers, with x denoting the inputs.", x: 50, top: 108, width: 200, height: 10 },
    { text: "Figure 2. Residual learning: a building block.", x: 50, top: 124, width: 200, height: 10 },
    { text: "arXiv:1512.03385v1 [cs.CV] 10 Dec 2015", x: 32, top: 90, width: 351, height: 20, rotated: true }
  ];
  const texts = buildTranslationBlocks(items, 612).map((block) => block.text);
  assert.deepEqual(texts, [
    "3.1. Residual Learning",
    "Let us consider H(x) as an underlying mapping to be fit by a few stacked layers, with x denoting the inputs.",
    "Figure 2. Residual learning: a building block."
  ]);
});

test("作者姓名保留原文、机构和编号脚注不因字号较小而被过滤", () => {
  const items = [
    { text: "Ziheng He Yixiang Chen Ning Yang", x: 120, top: 40, width: 190, height: 8 },
    { text: "1Institute of Automation, Chinese Academy of Sciences", x: 100, top: 52, width: 250, height: 7 },
    { text: "2University of Chinese Academy of Sciences", x: 100, top: 62, width: 230, height: 7 },
    { text: "*Corresponding authors yhuang@example.com", x: 100, top: 72, width: 240, height: 7 }
  ];
  const blocks = buildTranslationBlocks(items, 612);
  assert.deepEqual(blocks.map((block) => [block.text, block.kind]), [
    ["Ziheng He Yixiang Chen Ning Yang", "author"],
    ["1Institute of Automation, Chinese Academy of Sciences", "affiliation"],
    ["2University of Chinese Academy of Sciences", "affiliation"],
    ["*Corresponding authors yhuang@example.com", "footnote"]
  ]);
});

test("作者行与机构行保持独立，避免上标归属和翻译请求混在一起", () => {
  const items = [
    { text: "Ziheng He Yixiang Chen Ning Yang", x: 120, top: 40, width: 190, height: 8 },
    { text: "1Institute of Automation, Chinese Academy of Sciences", x: 100, top: 48, width: 250, height: 7 }
  ];
  const blocks = buildTranslationBlocks(items, 612);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "author");
  assert.equal(blocks[1].kind, "affiliation");
});

test("formulas and table rows are not sent for translation", () => {
  const items = [
    { text: "Attention(Q, K, V) = softmax(QK", x: 220, top: 100, width: 150, height: 10 },
    { text: "method", x: 60, top: 200, width: 30, height: 9 },
    { text: "top-1 err.", x: 160, top: 200, width: 40, height: 9 },
    { text: "top-5 err.", x: 260, top: 200, width: 40, height: 9 },
    { text: "test error", x: 360, top: 200, width: 40, height: 9 }
  ];
  assert.deepEqual(buildTranslationBlocks(items, 612), []);
});
