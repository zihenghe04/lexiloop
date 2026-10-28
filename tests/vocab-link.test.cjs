// PDF 阅读与词库打通、词库导入导出，以及基础功能审查修复的回归测试
const test = require("node:test");
const assert = require("node:assert/strict");
const vocab = require("../pdf-vocab.js");
const io = require("../vocab-io.js");
const library = require("../pdf-library.js");
const metadata = require("../paper-metadata.js");
const backup = require("../backup.js");

test("词库词匹配：常见词形变化、连字符复合词里的组成部分、词组（末词可变形）", () => {
  const words = [
    { id: "1", original: "embodiment" },
    { id: "2", original: "state space model" },
    { id: "3", original: "ground" },
    { id: "4", original: "study" },
    { id: "5", original: "plan" },
    { id: "6", original: "你好" }
  ];
  const matcher = vocab.buildVocabMatcher(words);
  const text = "Embodiment-specific interpreters ground them; grounded and grounding. We planned studies of state-space models.";
  const found = vocab.findVocabMatches(text, matcher).map((match) => `${text.slice(match.start, match.end)}→${match.word.id}`);
  assert.deepEqual(found, ["Embodiment→1", "ground→3", "grounded→3", "grounding→3", "planned→5", "studies→4", "state-space models→2"]);
  assert.equal(vocab.findVocabMatches("anything", vocab.buildVocabMatcher([])).length, 0);
});

test("整句语境：缩写（Fig.、e.g.、et al.）后的句点不断句，过长的句子以选区为中心截取", () => {
  const text = "First sentence here. Embodiment-specific interpreters (Fig. 2) ground them, e.g. MV_FWD, as in Smith et al. 2020. Next one starts.";
  assert.equal(vocab.sentenceForSelection(text, "interpreters"), "Embodiment-specific interpreters (Fig. 2) ground them, e.g. MV_FWD, as in Smith et al. 2020.");
  const long = `${"word ".repeat(200)}target ${"tail ".repeat(200)}.`;
  const sentence = vocab.sentenceForSelection(long, "target");
  assert.ok(sentence.length <= 425 && sentence.includes("target") && sentence.startsWith("…"));
});

test("本文查过的词：按文献库 id、PDF 指纹或网址归属，并汇总页码", () => {
  const words = [
    { id: "a", original: "ground", lookups: [
      { at: "2026-10-23T10:00:00Z", source: { kind: "pdf", paperId: "p1", page: 5 } },
      { at: "2026-10-23T11:00:00Z", source: { kind: "pdf", paperId: "p1", page: 2 } },
      { at: "2026-10-22T11:00:00Z", source: { url: "https://example.com" } }
    ] },
    { id: "b", original: "token", lookups: [{ at: "2026-10-23T12:00:00Z", source: { kind: "pdf", documentKey: "fp-9", page: 1 } }] },
    { id: "c", original: "other", lookups: [{ at: "2026-10-23T12:00:00Z", source: { kind: "pdf", paperId: "p2", page: 1 } }] }
  ];
  const result = vocab.wordsForDocument(words, { paperId: "p1", documentKey: "fp-9", url: "" });
  assert.deepEqual(result.map((item) => [item.word.id, item.pages, item.count]), [["b", [1], 1], ["a", [2, 5], 2]]);
});

test("本文高频术语：词组优先、复合词整体、单复数归并、已在词库的标出来", () => {
  const pages = [
    { page: 1, text: "The semantic action space maps semantic action units to robot motion. Semantic action units are discrete. The robot executes each unit." },
    { page: 2, text: "Zero-shot control with frontier models; zero-shot control works. The interpreter grounds the semantic action. Interpreters are deterministic. The interpreter is simple." }
  ];
  const terms = vocab.analyzeTerms(pages, { minCount: 2, known: new Set(["interpreter"]) });
  const byTerm = Object.fromEntries(terms.map((item) => [item.term, item]));
  assert.equal(terms[0].term, "semantic action");
  assert.equal(byTerm["zero-shot control"].firstPage, 2);
  assert.equal(byTerm.interpreter.count, 3);
  assert.equal(byTerm.interpreter.known, true);
  assert.ok(!byTerm.the && !byTerm.are);
});

test("导出 Anki：带文件头，背面含释义、标粗的原句和来源；CSV 带 BOM 并正确转义", () => {
  const words = [{
    original: "embodiment", translated: "具身", phonetics: { us: "ɪmˈbɑːdimənt" },
    meanings: [{ partOfSpeech: "n.", definitions: ["具身", "化身"] }], translationCount: 2,
    lookups: [{ id: "l1", context: "Embodiment-specific interpreters, \"quoted\".", source: { title: "Show-Harness", page: 3, kind: "pdf" } }]
  }];
  const anki = io.toAnki(words);
  assert.ok(anki.startsWith("#separator:tab\n#html:true\n"));
  const line = anki.trim().split("\n").pop().split("\t");
  assert.equal(line.length, 3);
  assert.ok(line[1].includes("<b>Embodiment</b>") && line[1].includes("Show-Harness · 第 3 页") && line[1].includes("n. 具身；化身"));
  assert.equal(line[2], "LexiLoop PDF");
  const csv = io.toCsv(words);
  assert.ok(csv.startsWith("﻿词条,"));
  assert.ok(csv.includes('"Embodiment-specific interpreters, ""quoted""."'));
});

test("导入：JSON（LexiLoop 导出 / 备份）、CSV（带引号与表头）、纯文本每行一个词", () => {
  assert.equal(io.parseImport(JSON.stringify({ words: [{ original: "a" }, { nope: 1 }] })).words.length, 1);
  assert.equal(io.parseImport(JSON.stringify({ local: { lexiloopWords: [{ original: "b" }] } })).words[0].original, "b");
  const csv = io.parseImport('词条,释义\nground,使接地\n"state space model","状态空间模型, SSM"', "x.csv");
  assert.deepEqual(csv.words.map((item) => [item.original, item.translated]), [["ground", "使接地"], ["state space model", "状态空间模型, SSM"]]);
  assert.deepEqual(io.parseImport("alpha\nbeta\n\n# 注释\n").words.map((item) => item.original), ["alpha", "beta"]);
  assert.throws(() => io.parseImport("   "), /空/);
  assert.throws(() => io.parseImport("{bad json"), /JSON/);
});

test("导入合并：新词新增；已有词合并查询记录（按 id 去重）、复习进度取更靠后的；无变化的算跳过", () => {
  const existing = [{ id: "w1", original: "Ground", translated: "", lookups: [{ id: "l1", at: "2026-10-01" }], translationCount: 1, review: { stage: 1, dueAt: "x" } }];
  const imported = [
    { original: "ground", translated: "使接地", lookups: [{ id: "l1", at: "2026-10-01" }, { id: "l2", at: "2026-10-05" }], translationCount: 2, review: { stage: 3, dueAt: "y" } },
    { original: "token", translated: "词元" },
    { original: "token", translated: "重复" }
  ];
  let counter = 0;
  const result = io.mergeImported(existing, imported, { now: "2026-10-23T00:00:00Z", uuid: () => `u${++counter}` });
  assert.equal(result.added, 1);
  assert.equal(result.merged, 1);
  assert.equal(result.skipped, 1);
  const ground = result.words.find((word) => word.id === "w1");
  assert.deepEqual(ground.lookups.map((lookup) => lookup.id), ["l2", "l1"]);
  assert.equal(ground.translated, "使接地");
  assert.equal(ground.review.stage, 3);
  assert.equal(result.words.find((word) => word.original === "token").translated, "词元");
});

test("审查修复：备份里 5 MB 的 PDF 能通过校验（原正则会栈溢出）", () => {
  const base64 = Buffer.alloc(5 * 1024 * 1024, 7).toString("base64");
  const data = { format: "lexiloop-backup", version: 1, local: {}, files: [{ id: "p", base64 }], indexes: [] };
  assert.equal(backup.validate(data), data);
  assert.throws(() => backup.validate({ ...data, files: [{ id: "p", base64: `${base64.slice(0, -4)}%%%%` }] }));
});

test("审查修复：指定了库里已有的 id 时按 id 匹配；本地文件条目不会被改成远程条目", () => {
  let papers = library.upsertPaper([], { id: "remote-1", fingerprint: "fp", sourceType: "remote", sourceUrl: "https://a.org/x.pdf", title: "A" }).papers;
  papers = library.upsertPaper(papers, { id: "local-1", sourceType: "local", title: "A" }).papers;
  // 打开本地条目时阅读器带着指纹同步：不应改写远程条目
  papers = library.upsertPaper(papers, { id: "local-1", fingerprint: "fp", sourceType: "local", currentPage: 4 }).papers;
  const remote = papers.find((paper) => paper.id === "remote-1");
  const local = papers.find((paper) => paper.id === "local-1");
  assert.equal(remote.sourceType, "remote");
  assert.equal(remote.sourceUrl, "https://a.org/x.pdf");
  assert.equal(local.currentPage, 4);
  // 从网页再打开同一份 PDF：本地条目保持本地，网址记为来源页
  papers = library.upsertPaper(papers, { id: "local-1", sourceType: "remote", sourceUrl: "https://b.org/y.pdf" }).papers;
  const after = papers.find((paper) => paper.id === "local-1");
  assert.equal(after.sourceType, "local");
  assert.equal(after.landingUrl, "https://b.org/y.pdf");
});

test("审查修复：arXiv 编号只从 arxiv.org 链接、arXiv: 前缀或完整编号里识别", () => {
  assert.equal(metadata.extractArxivId("https://doi.org/10.1145/3292500.3330701"), "");
  assert.equal(metadata.detectInput("https://ieeexplore.ieee.org/document/9123456").kind, "url");
  assert.equal(metadata.extractArxivId("2500.33307"), "");
  assert.equal(metadata.extractArxivId("arXiv:2609.10522v1"), "2609.10522");
  assert.equal(metadata.extractArxivId("https://arxiv.org/pdf/1512.03385v1"), "1512.03385");
  assert.equal(metadata.extractArxivId("math.GT/0309136"), "math.GT/0309136");
  const bib = metadata.metadataFromBibTeX("@inproceedings{k, title={Programming in C# and F#}, url={https://doi.org/10.1145/3292500.3330701}}");
  assert.equal(bib.title, "Programming in C# and F#");
  assert.equal(bib.arxivId, "");
});
