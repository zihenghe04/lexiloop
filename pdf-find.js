// PDF 文档内查找：纯逻辑部分（构造匹配模式、计数、在文字层文本节点中定位匹配）。
// 页面文本与 pdf.js TextLayer 的文本节点按同样方式拼接（各条目 str 直接相连），
// 因此同一页第 k 个匹配在两边是同一处。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopPdfFind = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_QUERY_LENGTH = 200;

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 查询中的空白匹配任意数量空白（含零个）：PDF 换行处常丢失空格。
  function buildPattern(query, { caseSensitive = false } = {}) {
    const text = String(query || "").trim().slice(0, MAX_QUERY_LENGTH);
    if (!text) return null;
    const source = text
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join("\\s*");
    return new RegExp(source, caseSensitive ? "g" : "gi");
  }

  function pageText(textContent) {
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    return items.filter((item) => typeof item?.str === "string").map((item) => item.str).join("");
  }

  function findAll(text, pattern) {
    if (!pattern || !text) return [];
    const matches = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (!match[0]) { pattern.lastIndex += 1; continue; }
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return matches;
  }

  // 把字符偏移区间映射到文本节点列表上，返回 [{node, offset}] 起止点。
  function locate(nodes, start, end) {
    let position = 0;
    let from = null;
    for (const node of nodes) {
      const length = node.data.length;
      if (!from && start < position + length) from = { node, offset: start - position };
      if (from && end <= position + length) return { from, to: { node, offset: end - position } };
      position += length;
    }
    return null;
  }

  // 把全局匹配序号转换为（页码, 页内序号）。
  function resolveIndex(pageCounts, index) {
    let remaining = index;
    for (const [pageNumber, count] of pageCounts) {
      if (remaining < count) return { pageNumber, ordinal: remaining };
      remaining -= count;
    }
    return null;
  }

  function globalIndex(pageCounts, pageNumber, ordinal) {
    let total = 0;
    for (const [page, count] of pageCounts) {
      if (page === pageNumber) return total + Math.min(ordinal, Math.max(0, count - 1));
      total += count;
    }
    return -1;
  }

  // 从当前页开始找第一个匹配，供输入新关键词时定位。
  function firstIndexFromPage(pageCounts, pageNumber) {
    let total = 0;
    let fallback = -1;
    for (const [page, count] of pageCounts) {
      if (count && fallback < 0) fallback = total;
      if (count && page >= pageNumber) return total;
      total += count;
    }
    return fallback;
  }

  return { buildPattern, pageText, findAll, locate, resolveIndex, globalIndex, firstIndexFromPage, MAX_QUERY_LENGTH };
});
