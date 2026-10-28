const test = require("node:test");
const assert = require("node:assert/strict");
const inline = require("../pdf-inline.js");

const source = "Foundation models encode what manipulation requires [24, 40, 82, 97]. Yet this knowledge does not translate into behavior [8, 12]. See Figure 3 and Sec. 3.2 for details (Eq. (2)); code is at https://github.com/showlab/Show-Harness.";
const links = [
  { key: "2:0", anchor: "24", kind: "cite" },
  { key: "2:1", anchor: "40", kind: "cite" },
  { key: "2:2", anchor: "97", kind: "cite" },
  { key: "2:3", anchor: "12", kind: "cite" },
  { key: "2:4", anchor: "3", kind: "ref" },
  { key: "2:5", anchor: "3.2", kind: "ref" },
  { key: "2:6", anchor: "2", kind: "ref" },
  { key: "2:7", anchor: "https://github.com/showlab/Show-Harness", url: "https://github.com/showlab/Show-Harness", kind: "url" }
].map((link) => ({ ...link, offset: source.indexOf(link.anchor) }));

test("翻译前：引用组、图表/章节/公式编号、网址整体换成占位符", () => {
  const { text, tokens } = inline.protectInline(source, links);
  assert.equal(text, "Foundation models encode what manipulation requires {v1}. Yet this knowledge does not translate into behavior {v2}. See {v3} and {v4} for details ({v5}); code is at {v6}.");
  assert.deepEqual(tokens.map((token) => token.kind), ["cite", "cite", "ref", "ref", "ref", "url"]);
  assert.deepEqual(tokens[0].links.map((link) => link.item), ["24", "40", "97"]);
  assert.equal(tokens[2].links[0].key, "2:4");
  assert.equal(tokens[5].links[0].url, "https://github.com/showlab/Show-Harness");
});

test("翻译后：占位符原位放回，引用每个编号各自可点，编号译成中文写法", () => {
  const { tokens } = inline.protectInline(source, links);
  const translated = "基础模型编码了操作所需的内容{v1}。然而这些知识并不能转化为行为{v2}。详见{v3}和{v4}（{v5}）；代码位于 {v6}。";
  assert.equal(
    inline.renderInline(translated, tokens),
    "基础模型编码了操作所需的内容 [24, 40, 82, 97]。然而这些知识并不能转化为行为 [8, 12]。详见图 3 和第 3.2 节（式 (2)）；代码位于 https://github.com/showlab/Show-Harness。"
  );
  const html = inline.renderInline(translated, tokens, { html: true });
  assert.ok(html.includes('<span class="tp-cite">[<a class="tp-link" href="#" data-link="2:0">24</a>, <a class="tp-link" href="#" data-link="2:1">40</a>, 82, <a class="tp-link" href="#" data-link="2:2">97</a>]</span>'));
  assert.ok(html.includes('<a class="tp-link" href="#" data-link="2:4">图 3</a>'));
  assert.ok(html.includes('<a class="tp-link" href="#" data-link="2:5">第 3.2 节</a>'));
  assert.ok(html.includes('<a class="tp-link is-external" href="https://github.com/showlab/Show-Harness" target="_blank" rel="noopener noreferrer" data-link="2:7">'));
  // 引用、链接都在原句里，不会出现在段末
  assert.ok(html.indexOf("tp-cite") < html.indexOf("然而"));
});

test("占位符被翻译服务弄丢：补回到原文相对位置附近的标点前，而不是堆到段末", () => {
  const { tokens } = inline.protectInline(source, links);
  // 第一组引用丢失
  const translated = "基础模型编码了操作所需的内容。然而这些知识并不能转化为行为{v2}。详见{v3}和{v4}（{v5}）；代码位于 {v6}。";
  const text = inline.renderInline(translated, tokens);
  assert.ok(text.startsWith("基础模型编码了操作所需的内容 [24, 40, 82, 97]。然而"), text);
  // 全部丢失时也按顺序分散回各自的位置
  const all = inline.renderInline("基础模型编码了操作所需的内容。然而这些知识并不能转化为行为。详见图表与章节的说明。代码在仓库里。", tokens);
  assert.ok(all.indexOf("[24, 40, 82, 97]") < all.indexOf("[8, 12]"));
  assert.ok(all.indexOf("[24, 40, 82, 97]") < all.indexOf("然而"));
  assert.ok(!all.endsWith("Show-Harness") || all.length < 10);
});

test("改写过的占位符照样识别；重复的只保留一次；未知编号丢弃", () => {
  const { tokens } = inline.protectInline("A result [5] and Figure 2.", [{ key: "1:0", anchor: "5", kind: "cite" }]);
  const text = inline.renderInline("结果｛V1｝和 { v2 } 以及 {v1} 和 {v9}。", tokens);
  assert.equal(text, "结果 [5] 和 图 2 以及 和 。");
});

test("带链接的名称、作者-年份引用原样保留并可点击", () => {
  const text = "We use Gemini 3.1 Pro following (Smith et al., 2020) as the agent.";
  const { text: protectedText, tokens } = inline.protectInline(text, [
    { key: "4:0", anchor: "Gemini 3.1 Pro", url: "https://deepmind.google/gemini", kind: "url", offset: 7 },
    { key: "4:1", anchor: "Smith et al., 2020", kind: "cite", offset: 33 }
  ]);
  assert.equal(protectedText, "We use {v1} following ({v2}) as the agent.");
  const html = inline.renderInline("我们按照（{v2}）使用 {v1} 作为智能体。", tokens, { html: true });
  assert.ok(html.includes('<a class="tp-link" href="#" data-link="4:1">Smith et al., 2020</a>'));
  assert.ok(html.includes('href="https://deepmind.google/gemini"'));
});

test("安全：危险协议不生成链接，文字照常转义", () => {
  const { tokens } = inline.protectInline("Click <here> now.", [{ key: "1:0", anchor: "here", url: "javascript:alert(1)", kind: "url", offset: 7 }]);
  const html = inline.renderInline("点击 <here> 现在。", tokens, { html: true });
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("&lt;here&gt;"));
  assert.equal(inline.safeHref("10.1109/CVPR.2016.90"), "https://doi.org/10.1109/CVPR.2016.90");
});

test("翻译失败时显示原文：编号保持英文写法", () => {
  const { text, tokens } = inline.protectInline(source, links);
  assert.equal(inline.renderInline(text, tokens, { chinese: false }), source);
});

test("编号列表与附录字母", () => {
  const { tokens } = inline.protectInline("Sections 3 and 4, Figures 2–4, Tables 1, 2 and Appendix A.", []);
  assert.deepEqual(tokens.map((token) => inline.localizedRef(token)), ["第 3 和 4 节", "图 2–4", "表 1、2", "附录 A"]);
});

test("同组引用里锚文本认错成相邻编号时，按链接框先后顺序对应", () => {
  const text = "including subtask-level calls [1, 37, 76, 92] and programs.";
  const at = text.indexOf("[");
  const { tokens } = inline.protectInline(text, [
    { key: "2:8", anchor: "1", kind: "cite", offset: at + 1 },
    { key: "2:9", anchor: "37", kind: "cite", offset: at + 4 },
    { key: "2:10", anchor: "76", kind: "cite", offset: at + 8 },
    { key: "2:11", anchor: "76", kind: "cite", offset: at + 12 }
  ]);
  assert.deepEqual(tokens[0].links.map((link) => link.item), ["1", "37", "76", "92"]);
  const html = inline.renderInline("包括子任务级调用{v1}和程序。", tokens, { html: true });
  assert.ok(html.includes('data-link="2:11">92</a>'));
});
