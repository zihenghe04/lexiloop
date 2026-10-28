// PDF 原文/译文对照阅读：纯逻辑部分（阅读模式、段落定位、翻译排队、译文排版、分栏比例）。
// 段落坐标与 LexiLoopPdfLayout.buildTranslationBlocks 一致：以 PDF 页面基准视口（scale=1）为坐标系。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopPdfBilingual = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MODES = ["source", "parallel", "translation"];
  const MIN_SPLIT = 25;
  const MAX_SPLIT = 75;
  const MIN_FONT_SIZE = 13;
  const MAX_FONT_SIZE = 24;
  const DEFAULT_FONT_SIZE = 16;

  function normalizeMode(mode) {
    return MODES.includes(mode) ? mode : "source";
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.min(maximum, Math.max(minimum, number));
  }

  // 原文栏占比（%），限制在 25–75 之间，避免某一栏被拖到不可读
  function clampSplit(value) {
    return Math.round(clamp(value, MIN_SPLIT, MAX_SPLIT) * 10) / 10;
  }

  function clampFontSize(value) {
    return Math.round(clamp(value, MIN_FONT_SIZE, MAX_FONT_SIZE));
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]);
  }

  // 译文排版：先整体转义，再把 [12]、[3, 5]、[7–9] 这类文献引用编号标出来（与 Reader 一样用链接色显示）
  function formatTranslationHtml(text) {
    return escapeHtml(text).replace(/\[(\d{1,3}(?:\s*[,，;；–—-]\s*\d{1,3})*)\]/g, "<span class=\"tp-cite\">[$1]</span>");
  }

  // 在页面坐标 (x, y) 处找对应段落。点在段落框内时 inside=true；
  // 否则取最近的段落：横向距离权重更高，保证双栏页面优先落在同一栏。
  // fraction 是 y 在该段落内的相对位置（0–1），用于两栏滚动时对齐到段落内部。
  function pickBlockAt(layout, x, y, tolerance = 0) {
    let best = null;
    (Array.isArray(layout) ? layout : []).forEach((block, index) => {
      if (!block) return;
      const left = Number(block.x) || 0;
      const top = Number(block.top) || 0;
      const right = left + (Number(block.width) || 0);
      const bottom = top + (Number(block.height) || 0);
      const dx = x < left - tolerance ? left - x : x > right + tolerance ? x - right : 0;
      const dy = y < top - tolerance ? top - y : y > bottom + tolerance ? y - bottom : 0;
      const score = dy + dx * 2;
      if (!best || score < best.score) {
        const height = Math.max(1, bottom - top);
        best = { index, score, inside: dx === 0 && dy === 0, fraction: clamp((y - top) / height, 0, 1) };
      }
    });
    if (!best) return null;
    return { index: best.index, inside: best.inside, fraction: best.fraction };
  }

  // 下一页该翻哪页：只挑尚未开始（idle）的页，离当前页最近者优先，同距离时先往后翻（阅读方向）。
  function nextPageToTranslate(getState, currentPage, totalPages) {
    const total = Math.max(0, Math.floor(Number(totalPages) || 0));
    const current = clamp(Math.round(Number(currentPage) || 1), 1, Math.max(1, total));
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= total; page += 1) {
      if (getState(page) !== "idle") continue;
      const score = page >= current ? page - current : (current - page) * 1.5 + 0.5;
      if (score < bestScore) {
        best = page;
        bestScore = score;
      }
    }
    return best;
  }


  // 下一页翻哪一页。暂停时不翻；只翻某一页时，那一页还没译完就译它，译完就停。
  function translationTarget(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => "complete";
    if (options.paused) return 0;
    const onlyPage = Math.floor(Number(options.onlyPage) || 0);
    if (onlyPage > 0) {
      const state = getState(onlyPage);
      return state === "idle" || state === "error" ? onlyPage : 0;
    }
    const priority = Math.floor(Number(options.priority) || 0);
    if (priority > 0 && getState(priority) === "idle") return priority;
    return nextPageToTranslate(getState, options.currentPage, options.totalPages);
  }

  // ---- 超链接 ----
  // PDF 链接注释的矩形里有哪些字：按横向比例截取文本条目中落在矩形内的部分
  function anchorTextForRect(items, rect) {
    if (!rect) return "";
    const parts = [];
    for (const item of Array.isArray(items) ? items : []) {
      const text = String(item?.text ?? "");
      const width = Number(item?.width) || 0;
      if (!text || width <= 0) continue;
      const centerY = Number(item.top) + Number(item.height) / 2;
      if (centerY < rect.top - 1 || centerY > rect.top + rect.height + 1) continue;
      const left = Math.max(rect.x, item.x);
      const right = Math.min(rect.x + rect.width, item.x + width);
      if (right - left < 0.5) continue;
      const start = Math.max(0, Math.floor(((left - item.x) / width) * text.length + 0.3));
      const end = Math.min(text.length, Math.ceil(((right - item.x) / width) * text.length - 0.3));
      const anchor = snapAnchor(text, start, Math.max(start + 1, end));
      if (anchor) parts.push({ x: left, top: Number(item.top), text: anchor });
    }
    parts.sort((a, b) => a.top - b.top || a.x - b.x);
    return parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
  }

  // 按字宽比例截出的范围会差一两个字符（逗号、括号比数字窄）：对齐到完整的词；
  // 截到「6, 9」这种跨了两个编号的，取离链接框中心最近的那个
  function snapAnchor(text, start, end) {
    const tokens = [];
    const pattern = /[^\s,;[\]()（）]+/g;
    let match;
    while ((match = pattern.exec(text))) tokens.push({ start: match.index, end: match.index + match[0].length });
    const overlapping = tokens.filter((token) => token.start < end && token.end > start);
    if (!overlapping.length) {
      // 只截到了标点：取最近的词
      const center = (start + end) / 2;
      const nearest = tokens.sort((a, b) => Math.abs((a.start + a.end) / 2 - center) - Math.abs((b.start + b.end) / 2 - center))[0];
      return nearest && Math.abs((nearest.start + nearest.end) / 2 - center) <= 3 ? text.slice(nearest.start, nearest.end) : "";
    }
    const numeric = overlapping.every((token) => /^\d{1,4}[a-z]?$/.test(text.slice(token.start, token.end)));
    if (numeric && overlapping.length > 1) {
      const center = (start + end) / 2;
      overlapping.sort((a, b) => Math.abs((a.start + a.end) / 2 - center) - Math.abs((b.start + b.end) / 2 - center));
      const best = overlapping[0];
      return text.slice(best.start, best.end);
    }
    return text.slice(overlapping[0].start, overlapping[overlapping.length - 1].end);
  }

  const REF_ANCHOR_PATTERN = /^(?:Figures?|Figs?\.|Tables?|Tabs?\.|Sections?|Secs?\.|§|Eqs?\.|Equations?|Algorithms?|Algs?\.|Appendix|App\.|Theorems?|Lemmas?|Definitions?)\s*(\S+)$/i;
  function normalizeAnchor(anchor) {
    let value = String(anchor || "").replace(/\s+/g, " ").trim();
    const reference = value.match(REF_ANCHOR_PATTERN);
    if (reference) value = reference[1];
    return value.replace(/^[[(（]+/, "").replace(/[\])）.,;:，；]+$/, "").trim();
  }


  function trimUrl(value) {
    let url = String(value || "");
    while (/[.,;:!?)\]}>'"]$/.test(url)) url = url.slice(0, -1);
    return url;
  }

  function normalizeHref(value) {
    const url = trimUrl(value);
    if (/^www\./i.test(url)) return `https://${url}`;
    if (/^10\.\d{4,9}\//.test(url)) return `https://doi.org/${url}`;
    return url;
  }

  // 只放行 http(s) 与 mailto，其余协议（javascript: 等）一律不当作链接
  function safeHref(value) {
    const href = normalizeHref(value);
    return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : "";
  }





  // 合并翻译的句子要拆回几段（版面对照里各段各占原位置）：在比例位置附近的标点处切开
  function splitTranslation(text, ratio) {
    const value = String(text ?? "");
    if (value.length < 2) return [value, ""];
    const target = Math.round(value.length * clamp(ratio, 0, 1));
    const window = Math.max(4, Math.round(value.length * 0.2));
    let cut = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let index = Math.max(1, target - window); index <= Math.min(value.length - 1, target + window); index += 1) {
      if (!/[，,。；;：:、\s）)]/.test(value[index - 1])) continue;
      const distance = Math.abs(index - target);
      if (distance < best) {
        best = distance;
        cut = index;
      }
    }
    if (cut < 0) cut = clamp(target, 1, value.length - 1);
    return [value.slice(0, cut).trim(), value.slice(cut).trim()];
  }

  // 内部链接目标点 (x, y) 处的段落：取目标点下方最近、横向覆盖目标点的段落（参考文献条目、图注等）
  function blockAtDestination(blocks, x, y) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
      if (!block) return;
      const bottom = block.top + block.height;
      if (bottom < y - 2) return;
      if (x > 0 && (block.x > x + 48 || block.x + block.width < x - 4)) return;
      const score = Math.max(0, block.top - y) + (block.top < y - 2 ? 1 : 0);
      if (score < bestScore) {
        best = index;
        bestScore = score;
      }
    });
    return best;
  }

  // 断句接续：段落在合并译文中的位置 ↔ 合并译文中的比例
  function rootFraction(segments, page, index, fraction) {
    const segment = (segments || []).find((item) => item.index === index && (item.page === undefined || item.page === page));
    if (!segment) return clamp(fraction, 0, 1);
    return segment.start + (segment.end - segment.start) * clamp(fraction, 0, 1);
  }

  function segmentAt(segments, fraction) {
    if (!segments?.length) return null;
    const value = clamp(fraction, 0, 1);
    const segment = segments.find((item) => value <= item.end + 1e-9) || segments[segments.length - 1];
    return {
      page: segment.page,
      index: segment.index,
      fraction: clamp((value - segment.start) / Math.max(1e-6, segment.end - segment.start), 0, 1)
    };
  }

  function isChineseText(text) {
    return /[㐀-鿿]/u.test(String(text || ""));
  }

  return {
    MODES,
    MIN_SPLIT,
    MAX_SPLIT,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
    DEFAULT_FONT_SIZE,
    normalizeMode,
    clampSplit,
    clampFontSize,
    escapeHtml,
    formatTranslationHtml,
    pickBlockAt,
    nextPageToTranslate,
    translationTarget,
    isChineseText,
    anchorTextForRect,
    normalizeAnchor,
    safeHref,
    splitTranslation,
    blockAtDestination,
    rootFraction,
    segmentAt
  };
});
