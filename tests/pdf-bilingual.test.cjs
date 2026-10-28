const test = require("node:test");
const assert = require("node:assert/strict");
const bilingual = require("../pdf-bilingual.js");
const { orderBlocksForReading, classifyBlock } = require("../pdf-layout.js");

test("阅读模式只接受三种取值", () => {
  assert.equal(bilingual.normalizeMode("parallel"), "parallel");
  assert.equal(bilingual.normalizeMode("translation"), "translation");
  assert.equal(bilingual.normalizeMode("bogus"), "source");
  assert.equal(bilingual.normalizeMode(undefined), "source");
});

test("分栏比例与译文字号限制在可读范围内", () => {
  assert.equal(bilingual.clampSplit(10), 25);
  assert.equal(bilingual.clampSplit(90), 75);
  assert.equal(bilingual.clampSplit(48.26), 48.3);
  assert.equal(bilingual.clampSplit("abc"), 25);
  assert.equal(bilingual.clampFontSize(8), 13);
  assert.equal(bilingual.clampFontSize(40), 24);
  assert.equal(bilingual.clampFontSize(17.4), 17);
});

test("译文排版先转义再标出文献引用编号", () => {
  const html = bilingual.formatTranslationHtml("<b>MVSGT</b> [17] 和 MVSGA [16, 20] 以及 [3–5] & 2[x]");
  assert.ok(html.startsWith("&lt;b&gt;MVSGT&lt;/b&gt; "));
  assert.ok(html.includes('<span class="tp-cite">[17]</span>'));
  assert.ok(html.includes('<span class="tp-cite">[16, 20]</span>'));
  assert.ok(html.includes('<span class="tp-cite">[3–5]</span>'));
  assert.ok(html.includes("&amp; 2[x]"));
  assert.ok(!html.includes("<b>"));
});

test("按坐标找段落：框内命中，框外取同栏最近的段落", () => {
  const layout = [
    { x: 50, top: 100, width: 230, height: 60 },   // 左栏第一段
    { x: 50, top: 170, width: 230, height: 80 },   // 左栏第二段
    { x: 310, top: 100, width: 230, height: 150 }  // 右栏
  ];
  const inside = bilingual.pickBlockAt(layout, 100, 130);
  assert.equal(inside.index, 0);
  assert.equal(inside.inside, true);
  assert.equal(inside.fraction, 0.5);
  // 左栏两段之间的空隙（y=165）：仍落在左栏，不会跳到同高度的右栏
  const gap = bilingual.pickBlockAt(layout, 120, 165);
  assert.ok([0, 1].includes(gap.index));
  assert.equal(gap.inside, false);
  // 右栏内
  assert.equal(bilingual.pickBlockAt(layout, 400, 120).index, 2);
  // 容差：贴着边缘 2px 也算框内
  assert.equal(bilingual.pickBlockAt(layout, 48, 130, 3).inside, true);
  assert.equal(bilingual.pickBlockAt([], 1, 1), null);
});

test("排队翻译：当前页优先，其次往后，跳过已开始或失败的页", () => {
  const states = { 1: "complete", 2: "idle", 3: "loading", 4: "idle", 5: "error", 6: "idle" };
  const get = (page) => states[page];
  assert.equal(bilingual.nextPageToTranslate(get, 4, 6), 4);
  states[4] = "complete";
  // 当前第 4 页：后面的第 6 页（距离 2）与前面的第 2 页（距离 2）同距离时先往后
  assert.equal(bilingual.nextPageToTranslate(get, 4, 6), 6);
  states[6] = "complete";
  assert.equal(bilingual.nextPageToTranslate(get, 4, 6), 2);
  states[2] = "complete";
  assert.equal(bilingual.nextPageToTranslate(get, 4, 6), 0);
});

test("双栏页面按先左栏、后右栏排列，通栏段落把页面切成上下两段", () => {
  const W = 612;
  const blocks = [
    { text: "Title", x: 100, top: 60, width: 412, height: 30 },
    { text: "L1", x: 50, top: 120, width: 236, height: 100 },
    { text: "R1", x: 310, top: 120, width: 236, height: 120 },
    { text: "L2", x: 50, top: 230, width: 236, height: 80 },
    { text: "Figure 1 wide caption", x: 50, top: 330, width: 500, height: 24 },
    { text: "L3", x: 50, top: 370, width: 236, height: 80 },
    { text: "R2", x: 310, top: 370, width: 236, height: 90 }
  ];
  assert.deepEqual(orderBlocksForReading(blocks, W).map((b) => b.text), ["Title", "L1", "L2", "R1", "Figure 1 wide caption", "L3", "R2"]);
});

test("单栏页面保持自上而下的顺序", () => {
  const blocks = [
    { text: "B", x: 72, top: 200, width: 468, height: 80 },
    { text: "H", x: 72, top: 170, width: 160, height: 14 },
    { text: "A", x: 72, top: 90, width: 468, height: 60 }
  ];
  assert.deepEqual(orderBlocksForReading(blocks, 612).map((b) => b.text), ["A", "H", "B"]);
});

test("段落类型：大标题、小节标题、图注与正文", () => {
  assert.equal(classifyBlock({ text: "Deep Residual Learning for Image Recognition", lineCount: 1, lineHeight: 17 }, 10), "title");
  assert.equal(classifyBlock({ text: "3.1. Residual Learning", lineCount: 1, lineHeight: 10 }, 10), "heading");
  assert.equal(classifyBlock({ text: "Abstract", lineCount: 1, lineHeight: 10 }, 10), "heading");
  assert.equal(classifyBlock({ text: "Figure 2. Residual learning: a building block.", lineCount: 1, lineHeight: 9 }, 10), "caption");
  assert.equal(classifyBlock({ text: "Deeper neural networks are more difficult to train. We present a framework.", lineCount: 3, lineHeight: 10 }, 10), "body");
});

test("插图里的零散标签不翻译，短的小节标题保留", () => {
  const { buildTranslationBlocks } = require("../pdf-layout.js");
  const item = (text, x, top, height = 10) => ({ text, x, top, width: text.length * height * 0.5, height });
  const items = [
    item("Deeper neural networks are more difficult to train and we present a framework.", 72, 100),
    item("used previously in the literature that we review in this section of the paper.", 72, 112),
    item("weight layer", 300, 200),
    item("relu", 300, 230),
    item("Abstract", 72, 300),
    item("2. Related Work", 72, 360)
  ];
  const texts = buildTranslationBlocks(items, 612).map((block) => block.text);
  assert.ok(!texts.includes("weight layer"));
  assert.ok(!texts.includes("relu"));
  assert.ok(texts.includes("Abstract"));
  assert.ok(texts.includes("2. Related Work"));
});

test("阅读器页面：对照阅读脚本在主脚本之前加载，三种模式与译文栏都在", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.html"), "utf8");
  const bilingualAt = html.indexOf('src="pdf-bilingual.js"');
  const layoutAt = html.indexOf('src="pdf-layout.js"');
  const readerAt = html.indexOf('src="pdf-reader.js"');
  assert.ok(layoutAt > 0 && bilingualAt > layoutAt && readerAt > bilingualAt);
  for (const mode of ["source", "parallel", "translation"]) {
    assert.ok(html.includes(`data-reading-mode-option="${mode}"`), mode);
  }
  const figuresAt = html.indexOf('src="pdf-figures.js"');
  const inlineAt = html.indexOf('src="pdf-inline.js"');
  assert.ok(figuresAt > bilingualAt && readerAt > figuresAt);
  assert.ok(inlineAt > 0 && readerAt > inlineAt);
  for (const id of ["readingPanes", "paneDivider", "paneSwapButton", "translationPane", "translationScroll", "translationDoc", "tpBlockTools", "translationProgress", "linkPreview", "linkPreviewJump", "linkReturn", "linkReturnButton", "figureLightbox", "figureLightboxImage"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  // 旧的「全文翻译」开关已被三种阅读模式取代
  assert.ok(!html.includes('id="translationModeButton"'));
});

test("阅读器页面：点原文也能定位译文（与点译文定位原文对称）", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  // 译文点击 → 原文定位
  assert.ok(source.includes('translationDoc.addEventListener("click", handleTranslationClick)'));
  assert.ok(source.includes("function focusSourceBlock("));
  // 原文点击 → 译文定位
  assert.ok(source.includes('pageStage.addEventListener("click", handleSourceClick)'));
  assert.ok(source.includes('pageStage.addEventListener("pointerdown", handleSourceClickStart)'));
  assert.ok(source.includes("function focusTranslationBlock("));
  // 点链接、拖选文字、截图问 AI 模式都不该搬动译文位置
  const click = source.slice(source.indexOf("function handleSourceClick(event)"));
  const body = click.slice(0, click.indexOf("\n}\n"));
  for (const guard of [".pdf-link", "Math.hypot", "pdfCaptureMode", "isCollapsed"]) {
    assert.ok(body.includes(guard), `handleSourceClick 缺少 ${guard} 保护`);
  }
  // 由原文发起的这次滚动，不能让译文栏的滚动事件反过来把原文拽走
  const focus = source.slice(source.indexOf("function focusTranslationBlock("));
  assert.ok(focus.slice(0, focus.indexOf("\n}\n")).includes('paneLeader = "source"'));
  // 定位期间原文栏哪怕 1px 抖动也会触发「阅读线 → 译文」同步把译文拽回去，必须临时锁住
  assert.ok(focus.slice(0, focus.indexOf("\n}\n")).includes("translationFocusLockUntil"));
  assert.ok(source.includes("performance.now() >= translationFocusLockUntil"));
});
