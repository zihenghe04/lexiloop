const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const textLayer = require("../pdf-textlayer.js");

// 假的测量函数：内嵌字体每个字符 50（100px 下），通用字体每个字符 58
const measure = (text, family) => text.length * (family.startsWith('"g_d0_f1"') ? 50 : 58);
const item = (str, fontSize = 10, extra = {}) => ({
  str,
  fontName: "g_d0_f1",
  transform: [fontSize, 0, 0, fontSize, 72, 700],
  width: str.length * fontSize * 0.5,
  ...extra
});

test("内嵌字体量出的宽度更贴合 PDF 记录时改用内嵌字体", () => {
  const items = [item("Deep residual learning"), item("framework to ease"), item("training of networks")];
  const choice = textLayer.chooseFontFamily({ fontName: "g_d0_f1", genericFamily: "sans-serif", items, measure, loaded: true });
  assert.equal(choice.family, '"g_d0_f1", sans-serif');
  assert.ok(choice.embeddedError < 0.001);
  assert.ok(choice.genericError > 0.1);
});

test("内嵌字体映射不可信（宽度对不上）时保持 pdf.js 默认字体", () => {
  const broken = (text, family) => text.length * (family.startsWith('"g_d0_f1"') ? 80 : 52);
  const items = [item("Deep residual learning"), item("framework to ease")];
  const choice = textLayer.chooseFontFamily({ fontName: "g_d0_f1", genericFamily: "serif", items, measure: broken, loaded: true });
  assert.equal(choice.family, null);
});

test("字体未加载或样本不足时不下结论，留到下一页再判", () => {
  const items = [item("Deep residual learning"), item("framework")];
  assert.equal(textLayer.chooseFontFamily({ fontName: "g_d0_f1", items, measure, loaded: false }), null);
  assert.equal(textLayer.chooseFontFamily({ fontName: "g_d0_f1", items: [item("ab"), item("Deep residual")], measure, loaded: true }), null);
});

test("抽样跳过旋转文字、短片段和其他字体", () => {
  const items = [
    item("arXiv:1512.03385v1", 20, { transform: [0, 20, -20, 0, 30, 400] }),
    item("a"),
    item("Other font text", 10, { fontName: "g_d0_f2" }),
    item("Residual learning")
  ];
  const samples = textLayer.sampleItems(items, "g_d0_f1");
  assert.deepEqual(samples.map((sample) => sample.text), ["Residual learning"]);
  assert.equal(samples[0].fontSize, 10);
});

test("阅读器：文字层用与测量画布一致的 lang、先画画布再排文字层，并接入选区占位块", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  assert.match(source, /view\.textLayer\.setAttribute\("lang", textLayerContent\.lang \|\| ""\)/);
  assert.match(source, /await Promise\.all\(\[textContentPromise, view\.renderTask\.promise\]\)[\s\S]*new pdfjs\.TextLayer/);
  assert.match(source, /LexiLoopTextLayer\.attachEndOfContent\(view\.textLayer\)/);
  const html = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.html"), "utf8");
  assert.ok(html.indexOf("pdf-textlayer.js") > 0 && html.indexOf("pdf-textlayer.js") < html.indexOf("pdf-reader.js"));
  const css = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.css"), "utf8");
  assert.match(css, /\.textLayer\.selecting \.endOfContent \{ top: 0; \}/);
});

test("阅读器：触控板捏合（Ctrl + 滚轮）以非 passive 监听拦截，缩放期间不按中间比例重绘", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  assert.match(source, /window\.addEventListener\("wheel", handleZoomWheel, \{ passive: false \}\)/);
  assert.match(source, /function handleZoomWheel\(event\) \{\n  if \(!\(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(source, /async function renderPage\(view\) \{\n  if \(!view \|\| view\.renderedScale === scale \|\| pinchScale !== null\) return;/);
  // 状态变量必须声明在文件顶部，避免初始化顺序（TDZ）错误
  assert.ok(source.indexOf("let pinchScale = null;") < source.indexOf("function handleZoomWheel"));
  assert.ok(source.indexOf("const vocabMeasureContext") < source.indexOf("function textLayerFontFamily"));
});

// ---- 词间距（0.23.0）----
test("两端对齐多出的宽度只落在空格上，字母保持原宽", () => {
  // 10 个空格，自然宽 20em，PDF 记录 21em：每个空格多 0.1em，字母不拉伸
  const fit = textLayer.fitWordSpacing({ text: "a b c d e f g h i j k", naturalEm: 20, targetEm: 21 });
  assert.ok(Math.abs(fit.wordSpacing - 0.1) < 1e-9);
  assert.ok(Math.abs(fit.scaleX - 1) < 1e-9);
});

test("microtype 字体扩展留在 scaleX，剩下的差值才进词间距", () => {
  // 字形本身横向放大 2%：自然宽 20em → 20.4em，PDF 记录 20.9em，空格补 0.5em / 5 / 1.02
  const fit = textLayer.fitWordSpacing({ text: "aa bb cc dd ee ff", naturalEm: 20, targetEm: 20.9, glyphScale: 1.02 });
  assert.ok(Math.abs(fit.scaleX - 1.02) < 1e-9);
  assert.ok(Math.abs(fit.wordSpacing - (20.9 / 1.02 - 20) / 5) < 1e-9);
  // 最终宽度仍等于 PDF 记录
  assert.ok(Math.abs(fit.scaleX * (20 + fit.wordSpacing * 5) - 20.9) < 1e-9);
});

test("词间距压到下限后，剩余差值退回整体缩放；没有空格时不处理", () => {
  const fit = textLayer.fitWordSpacing({ text: "ab cd", naturalEm: 10, targetEm: 9 });
  assert.equal(fit.wordSpacing, textLayer.MIN_WORD_SPACING);
  assert.ok(Math.abs(fit.scaleX * (10 + fit.wordSpacing) - 9) < 1e-9);
  assert.equal(textLayer.fitWordSpacing({ text: "abcdef", naturalEm: 10, targetEm: 11 }), null);
  assert.equal(textLayer.fitWordSpacing({ text: "a b", naturalEm: 0, targetEm: 11 }), null);
});

test("glyphScaleOf 只认横排的水平拉伸，旋转条目返回 null", () => {
  assert.ok(Math.abs(textLayer.glyphScaleOf([9.8, 0, 0, 10, 0, 0]) - 0.98) < 1e-9);
  assert.equal(textLayer.glyphScaleOf([10, 0, 0, 10, 0, 0]), 1);
  assert.equal(textLayer.glyphScaleOf([0, 10, -10, 0, 0, 0]), null);
});

function fakeDiv(text, scaleX, family = "g_d0_f1, sans-serif") {
  const props = new Map(scaleX ? [["--scale-x", String(scaleX)]] : []);
  return {
    textContent: text,
    style: {
      fontFamily: family,
      wordSpacing: "",
      getPropertyValue: (name) => props.get(name) || "",
      setProperty: (name, value) => props.set(name, value)
    }
  };
}

test("refineTextLayer 只改可信字体、带空格的片段，并按条目一一对应", () => {
  // 每个字符 50（100px 下）→ 自然宽 = 长度 × 0.5em
  const measure = (text) => text.length * 50;
  const items = [
    { str: "deep residual nets", fontName: "g_d0_f1", transform: [10, 0, 0, 10, 0, 0] },
    { type: "beginMarkedContent" },
    { str: "untrusted font here", fontName: "g_d0_f9", transform: [10, 0, 0, 10, 0, 0] },
    { str: "nospace", fontName: "g_d0_f1", transform: [10, 0, 0, 10, 0, 0] }
  ];
  const divs = [fakeDiv("deep residual nets", 1.05), fakeDiv("untrusted font here", 1.05), fakeDiv("nospace", 1.05)];
  const changed = textLayer.refineTextLayer({ divs, items, trusted: (name) => name === "g_d0_f1", measure });
  assert.equal(changed, 1);
  assert.equal(divs[0].style.getPropertyValue("--scale-x"), "1");
  // 9em × 0.05 = 0.45em 分给 2 个空格
  assert.equal(divs[0].style.wordSpacing, "0.2250em");
  assert.equal(divs[1].style.getPropertyValue("--scale-x"), "1.05");
  assert.equal(divs[2].style.wordSpacing, "");
  // 数量对不上（pdf.js 内部变化）时整层不动
  assert.equal(textLayer.refineTextLayer({ divs: divs.slice(1), items, trusted: () => true, measure }), 0);
});

test("阅读器：文字层渲染后调用 refineTextLayer，测量画布 lang 与文字层一致", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8");
  assert.match(source, /await textLayer\.render\(\);[\s\S]{0,200}LexiLoopTextLayer\.refineTextLayer\(\{\s*divs: textLayer\.textDivs/);
  assert.match(source, /measureTextLayerWidth\(text, family, textLayerContent\.lang \|\| ""\)/);
  assert.match(source, /canvas\.lang = lang;/);
});

test("拖选期间链接不接收指针：mousedown 在文字层时给根元素加标记，松手或失焦时移除", () => {
  const handlers = {};
  const winHandlers = {};
  class FakeElement {
    constructor(inLayer) { this.inLayer = inLayer; this.classList = classList(); }
    closest(selector) { return selector === ".textLayer" && this.inLayer ? this.layer : null; }
  }
  function classList() {
    const set = new Set();
    return { add: (name) => set.add(name), remove: (name) => set.delete(name), contains: (name) => set.has(name) };
  }
  const root = { classList: classList() };
  const doc = {
    documentElement: root,
    defaultView: { Element: FakeElement, addEventListener: (type, fn) => { winHandlers[type] = fn; } },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    querySelectorAll: () => [],
    createElement: () => ({ style: {} })
  };
  const layer = { ownerDocument: doc, append() {}, classList: classList(), style: {} };
  const target = new FakeElement(true);
  target.layer = layer;
  textLayer.attachEndOfContent(layer);
  handlers.mousedown({ target, button: 0 });
  assert.equal(root.classList.contains("lexiloop-text-selecting"), true);
  handlers.pointerup();
  assert.equal(root.classList.contains("lexiloop-text-selecting"), false);
  handlers.mousedown({ target, button: 2 });
  assert.equal(root.classList.contains("lexiloop-text-selecting"), false);
  handlers.mousedown({ target: new FakeElement(false), button: 0 });
  assert.equal(root.classList.contains("lexiloop-text-selecting"), false);
  handlers.mousedown({ target, button: 0 });
  winHandlers.blur();
  assert.equal(root.classList.contains("lexiloop-text-selecting"), false);
  const css = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.css"), "utf8");
  assert.match(css, /\.lexiloop-text-selecting \.pdf-link[^{]*\{ pointer-events: none; \}/);
});
