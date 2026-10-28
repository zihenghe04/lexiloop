// 阅读器侧栏底部「我的学习」：词库、待复习、文献库三个入口和它们的数量。
// 点击由 pdf-reader.js 统一转给个人中心（OPEN_PANEL_TAB）；这里只负责数量，跟着存储变化实时更新。
(function (root, factory) {
  const api = factory();
  root.LexiLoopReaderCenter = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORDS_KEY = "lexiloopWords";
  const LIBRARY_KEY = "lexiloopPdfLibrary";

  function timeOf(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  // 与个人中心的 dueWords 一致：没有排期或排期已到的词都算待复习
  function centerCounts(words, papers, now = Date.now()) {
    const list = Array.isArray(words) ? words : [];
    return {
      words: list.length,
      due: list.filter((word) => !word?.review?.dueAt || timeOf(word.review.dueAt) <= now).length,
      papers: Array.isArray(papers) ? papers.length : 0
    };
  }

  function render(doc, counts) {
    const set = (id, value, emphasize = false) => {
      const node = doc.getElementById(id);
      if (!node) return;
      node.textContent = value ? String(value) : "";
      node.classList.toggle("is-attention", emphasize && value > 0);
    };
    set("centerWordCount", counts.words);
    set("centerDueCount", counts.due, true);
    set("centerPaperCount", counts.papers);
  }

  function bind(doc = globalThis.document, storage = globalThis.chrome?.storage) {
    if (!doc || !storage?.local) return;
    let words = [];
    let papers = [];
    const refresh = () => render(doc, centerCounts(words, papers));
    storage.local.get([WORDS_KEY, LIBRARY_KEY]).then((value) => {
      words = value?.[WORDS_KEY] || [];
      papers = value?.[LIBRARY_KEY] || [];
      refresh();
    }).catch(() => {});
    storage.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[WORDS_KEY]) words = changes[WORDS_KEY].newValue || [];
      if (changes[LIBRARY_KEY]) papers = changes[LIBRARY_KEY].newValue || [];
      if (changes[WORDS_KEY] || changes[LIBRARY_KEY]) refresh();
    });
    // 复习排期随时间到期，每分钟重算一次
    globalThis.setInterval?.(refresh, 60000);
  }

  return { centerCounts, render, bind, WORDS_KEY, LIBRARY_KEY };
});
