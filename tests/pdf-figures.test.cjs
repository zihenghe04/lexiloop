const test = require("node:test");
const assert = require("node:assert/strict");
const figures = require("../pdf-figures.js");
const layout = require("../pdf-layout.js");
const bilingual = require("../pdf-bilingual.js");

// 生成一张白底 RGBA 页面，并在指定矩形里画黑
function page(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const r of rects) {
    for (let y = r.top; y < r.top + r.height; y += 1) {
      for (let x = r.x; x < r.x + r.width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 20;
      }
    }
  }
  return data;
}

test("插图区域：去掉正文段落后剩下的墨迹块，相邻部分合并，正文和零星小点不算", () => {
  const W = 300;
  const H = 400;
  const text = { x: 20, top: 20, width: 260, height: 60 };
  const figurePartA = { x: 40, top: 120, width: 100, height: 70 };
  const figurePartB = { x: 150, top: 125, width: 90, height: 60 }; // 与 A 间距 10，属于同一张图
  const pageNumber = { x: 148, top: 380, width: 4, height: 6 };
  const data = page(W, H, [text, figurePartA, figurePartB, pageNumber]);
  const grid = figures.buildInkGrid(data, W, H, 1);
  figures.clearRects(grid, [text]);
  const regions = figures.findRegions(grid, [text]);
  assert.equal(regions.length, 1);
  const [region] = regions;
  assert.ok(region.x <= 40 && region.x + region.width >= 240);
  assert.ok(region.top <= 120 && region.top + region.height >= 190);
  assert.equal(region.kind, "figure");
});

test("插图区域：两块墨迹之间隔着正文段落时不合并；扁长区域判为公式", () => {
  const W = 300;
  const H = 400;
  const equation = { x: 60, top: 40, width: 180, height: 22 };
  const text = { x: 20, top: 80, width: 260, height: 40 };
  const figure = { x: 60, top: 130, width: 180, height: 120 };
  const grid = figures.buildInkGrid(page(W, H, [equation, text, figure]), W, H, 1);
  figures.clearRects(grid, [text]);
  const regions = figures.findRegions(grid, [text]);
  assert.equal(regions.length, 2);
  assert.equal(regions[0].kind, "equation");
  assert.equal(regions[1].kind, "figure");
});

const item = (text, x, top, height = 10) => ({ text, x, top, width: text.length * height * 0.48, height });

test("列表项的悬挂缩进：续行并回同一段，不会一句拆成两段", () => {
  const items = [
    item("• Show-Harness demonstrates the feasibility of directly unlocking closed-source frontier VLMs for", 50, 100),
    item("zero-shot control, and efficiently adapting small-scale models for low-cost deployment.", 58, 112),
    item("• Show-Harness-equipped VLM agents demonstrate strong generalization across tasks, embodiments,", 50, 126),
    item("and environments, outperforming representative agentic and VLA paradigms. Further studies on", 58, 138),
    item("physical and semantic adaptability reveal key properties of effective VLM–robot interfaces.", 58, 150)
  ];
  const blocks = layout.buildTranslationBlocks(items, 612);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].text.endsWith("low-cost deployment."));
  assert.ok(blocks[1].text.includes("and environments") && blocks[1].text.endsWith("interfaces."));
});

test("编号参考文献的悬挂缩进同样合并", () => {
  const items = [
    item("[1] K. He, X. Zhang, S. Ren, and J. Sun. Deep residual learning for image", 50, 100, 9),
    item("recognition. In CVPR, 2016.", 62, 111, 9),
    item("[2] A. Vaswani et al. Attention is all you need. In NeurIPS, 2017.", 50, 124, 9)
  ];
  const texts = layout.buildTranslationBlocks(items, 612).map((block) => block.text);
  assert.equal(texts.length, 2);
  assert.ok(texts[0].endsWith("In CVPR, 2016."));
});

test("断句接续：换栏、隔着图注脚注的半句接回同一句，已结束的句子不接", () => {
  const blocks = [
    { text: "Deep networks naturally integrate low/mid/high-level features and the levels of features can be enriched by the number of stacked", kind: "body" },
    { text: "1http://image-net.org/challenges", kind: "footnote" },
    { text: "layers (depth). Recent evidence reveals that network depth is of crucial importance.", kind: "body" },
    { text: "Driven by the significance of depth, a question arises.", kind: "body" },
    { text: "this sentence starts lowercase but the previous one ended.", kind: "body" }
  ];
  const linked = layout.linkContinuations(blocks);
  assert.equal(linked[2].continuationOf, 0);
  assert.equal(linked[0].joinedText, `${blocks[0].text} ${blocks[2].text}`);
  assert.equal(linked[0].segments.length, 2);
  assert.equal(linked[0].segments[1].index, 2);
  assert.ok(Math.abs(linked[0].segments[1].end - 1) < 1e-9);
  assert.equal(linked[4].continuationOf, undefined);
  assert.equal(layout.joinContinuation("learn-", "ing residual"), "learning residual");
  assert.equal(layout.isOpenEnded("ends with a comma,"), true);
  assert.equal(layout.isOpenEnded("Finished (Fig. 2)."), false);
});

test("脚注：小字号、编号开头", () => {
  assert.equal(layout.classifyBlock({ text: "1http://image-net.org/challenges/LSVRC/2015/", lineCount: 1, lineHeight: 8 }, 10), "footnote");
  assert.equal(layout.classifyBlock({ text: "2D convolution is applied to every frame of the input video.", lineCount: 1, lineHeight: 10 }, 10), "body");
});

test("链接锚文本：按比例截取矩形内的字符", () => {
  const items = [{ text: "networks [12, 20] have", x: 100, top: 50, width: 110, height: 10 }];
  // 每字 5 个单位宽："[" 在第 9 个字符（x=145），"12" 在 x=150–160
  assert.equal(bilingual.anchorTextForRect(items, { x: 150, top: 49, width: 10, height: 12 }), "12");
  assert.equal(bilingual.anchorTextForRect(items, { x: 400, top: 49, width: 10, height: 12 }), "");
  assert.equal(bilingual.normalizeAnchor("Figure 3"), "3");
  assert.equal(bilingual.normalizeAnchor("[12],"), "12");
});

test("合并句的译文按比例在标点处拆回各段", () => {
  const [a, b] = bilingual.splitTranslation("零样本控制，以及高效适配小规模模型以实现低成本部署。", 0.4);
  assert.equal(a + b, "零样本控制，以及高效适配小规模模型以实现低成本部署。");
  assert.ok(a.endsWith("，"));
});

test("段落在合并句中的位置换算", () => {
  const segments = layout.segmentRanges([{ page: 1, index: 3, length: 300 }, { page: 2, index: 0, length: 100 }]);
  assert.equal(bilingual.rootFraction(segments, 2, 0, 0.5), 0.875);
  const hit = bilingual.segmentAt(segments, 0.875);
  assert.equal(hit.page, 2);
  assert.equal(hit.index, 0);
  assert.ok(Math.abs(hit.fraction - 0.5) < 1e-9);
});

test("链接目标处的段落：取目标点下方、同一栏里最近的段落", () => {
  const blocks = [
    { x: 50, top: 100, width: 230, height: 30 },
    { x: 50, top: 140, width: 230, height: 30 },
    { x: 310, top: 100, width: 230, height: 30 }
  ];
  assert.equal(bilingual.blockAtDestination(blocks, 50, 138), 1);
  assert.equal(bilingual.blockAtDestination(blocks, 310, 95), 2);
  assert.equal(bilingual.blockAtDestination(blocks, 0, 120), 0);
  assert.equal(bilingual.blockAtDestination(blocks, 0, 135), 1);
});

test("链接锚文本对齐到完整编号：截偏到逗号或跨两个编号时取最近的编号", () => {
  const items = [{ text: "[24, 40, 82, 97] and [6, 9]", x: 0, top: 0, width: 135, height: 10 }];
  const at = (x, width) => bilingual.anchorTextForRect(items, { x, top: -1, width, height: 12 });
  assert.equal(at(5, 10), "24");
  assert.equal(at(20, 12), "40");
  assert.equal(at(104, 8), "6");
});

test("带底色的摘要框不算插图；插图里的说明文字不单独翻译", () => {
  const W = 300;
  const H = 400;
  const box = { x: 20, top: 20, width: 260, height: 120 }; // 底色框
  const text = { x: 30, top: 30, width: 240, height: 100 }; // 框里的正文
  const data = page(W, H, [box]);
  // 底色改成浅灰（仍低于墨迹阈值）
  for (let i = 0; i < data.length; i += 4) if (data[i] === 20) { data[i] = data[i + 1] = data[i + 2] = 215; }
  const grid = figures.buildInkGrid(data, W, H, 1);
  figures.clearRects(grid, [text]);
  assert.equal(figures.findRegions(grid, [text]).length, 0);
  const region = { x: 50, top: 150, width: 200, height: 150 };
  const inside = figures.blocksInsideRegions([
    { x: 60, top: 160, width: 120, height: 20, kind: "body" },
    { x: 50, top: 305, width: 200, height: 20, kind: "caption" },
    { x: 60, top: 160, width: 120, height: 20, kind: "caption" }
  ], [region]);
  assert.deepEqual([...inside], [0]);
});

test("三线表：两条以上对齐的横线 + Table 标题 → 整块表格；没有标题的分隔线不算", () => {
  const W = 400;
  const H = 300;
  const rules = [
    { x: 40, top: 60, width: 320, height: 1 },
    { x: 40, top: 80, width: 320, height: 1 },
    { x: 40, top: 160, width: 320, height: 1 }
  ];
  const data = page(W, H, [...rules, { x: 40, top: 250, width: 200, height: 1 }]);
  const found = figures.findHorizontalRules(data, W, H, 1);
  assert.equal(found.length, 4);
  const caption = { text: "Table 1. Results on ImageNet.", x: 40, top: 40, width: 320, height: 12 };
  const tables = figures.findTableRegions(found, [caption]);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].kind, "table");
  assert.ok(tables[0].top <= 60 && tables[0].top + tables[0].height >= 160);
  assert.equal(figures.findTableRegions(found, []).length, 0);
  // 照片这类实心色块不是横线
  const photo = page(W, H, [{ x: 40, top: 40, width: 300, height: 100 }]);
  assert.equal(figures.findHorizontalRules(photo, W, H, 1).length, 0);
});

// ---- 图片块裁切：照片大面积是浅色，按墨迹会碎成机械臂和标签两块；改用图片对象自身的矩形 ----

test("图片块：单位正方形经 CTM 与视口变换落成矩形，save/restore 正确恢复", () => {
  const fns = [10, 12, 85, 11, 12, 85];
  const args = [];
  args[1] = [200, 0, 0, 150, 50, 400];
  args[4] = [100, 0, 0, 100, 300, 420];
  // 视口：y 翻转到左上原点，页面高 800
  const rects = figures.imageRectsFromOperators(fns, args, [1, 0, 0, -1, 0, 800]);
  assert.equal(rects.length, 2);
  assert.deepEqual(
    rects.map((r) => [r.x, r.top, r.width, r.height]),
    [[50, 250, 200, 150], [300, 280, 100, 100]]
  );
  assert.ok(rects.every((r) => r.kind === "figure" && r.source === "image"));
  // 画在 restore 之后，不能受前一张图的变换影响
  const savedOnly = figures.imageRectsFromOperators([10, 12, 85, 11, 12, 85], [null, [400, 0, 0, 400, 0, 0], null, null, [100, 0, 0, 100, 0, 0], null], [1, 0, 0, -1, 0, 800]);
  assert.deepEqual(savedOnly.map((r) => r.width), [400, 100]);
});

test("图片块：图标和装饰线这类小图不算插图", () => {
  const fns = [10, 12, 85, 11, 10, 12, 85, 11];
  const args = [];
  args[1] = [10, 0, 0, 10, 0, 0];
  args[5] = [40, 0, 0, 400, 0, 0];
  const rects = figures.imageRectsFromOperators(fns, args, [1, 0, 0, -1, 0, 800]);
  assert.equal(rects.length, 1);
  assert.equal(rects[0].width, 40);
  assert.equal(figures.imageRectsFromOperators([], [], null).length, 0);
});

test("图片块合并：同一张图的左右两半和图上标签并成一块，不吞正文", () => {
  const text = [{ x: 0, top: 0, width: 400, height: 120 }];
  const images = [
    { x: 40, top: 200, width: 100, height: 80 },
    { x: 150, top: 205, width: 90, height: 70 }
  ];
  const ink = [
    { x: 60, top: 285, width: 40, height: 12 },
    { x: 40, top: 20, width: 300, height: 40 }
  ];
  const merged = figures.absorbImageRegions(images, ink, text, { gap: 20 });
  const photos = merged.filter((box) => box.source === "image");
  assert.equal(photos.length, 1);
  assert.ok(photos[0].x <= 40 && photos[0].x + photos[0].width >= 240);
  assert.ok(photos[0].top + photos[0].height >= 297);
  assert.ok(merged.some((box) => box.source !== "image" && box.top <= 20));
});

test("图片块合并：紧贴图片但会带进大片正文时不合并", () => {
  const text = [{ x: 40, top: 145, width: 200, height: 120 }];
  const images = [{ x: 40, top: 100, width: 60, height: 40 }];
  const merged = figures.absorbImageRegions(images, [], text, { gap: 20 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].height, 40);
});
