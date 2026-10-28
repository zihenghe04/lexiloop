// 译文里的行内元素保护：引用编号、图表/章节/公式编号、网址、带超链接的文字。
// 翻译前把它们整体替换成占位符 {v1}{v2}…，翻译服务只决定它们在译文里的位置；
// 翻译后再从原文放回（内容不会被改写或丢失），并重新挂上 PDF 里的超链接。
// 占位符被翻译服务弄丢时，按它在原文中的相对位置补回到最近的标点前，不会堆到段末。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopPdfInline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 兼容翻译服务改写后的形式：{V1}、{ v1 }、全角括号
  const PLACEHOLDER_PATTERN = /[{｛]\s*[vV]\s*(\d{1,3})\s*[}｝]/g;
  const URL_PATTERN = /(?:\bhttps?:\/\/|\bwww\.)[^\s<>"'，。；、）】」]+|\b10\.\d{4,9}\/[^\s<>"'，。；、）】」]+/gi;
  const CITE_PATTERN = /\[(\d{1,4}[a-z]?(?:\s*[,;–—-]\s*\d{1,4}[a-z]?)*)\]/g;
  const REF_WORDS = "Figures?|Figs?\\.|Tables?|Tabs?\\.|Sections?|Secs?\\.|§§?|Equations?|Eqs?\\.|Algorithms?|Algs?\\.|Appendix|Appendices|App\\.|Theorems?|Thms?\\.|Lemmas?|Definitions?|Defs?\\.|Propositions?|Props?\\.|Corollar(?:y|ies)|Chapters?|Ch\\.|Lines?";
  const REF_NUMBER = "\\(?[A-Z]?\\d+(?:\\.\\d+)*[a-z]?\\)?|[A-Z](?![A-Za-z])";
  const REF_PATTERN = new RegExp(
    `(?<![A-Za-z])(${REF_WORDS})(?:\\s|~)*(${REF_NUMBER})((?:\\s*(?:,|and|&|–|—|-|to)\\s*(?:${REF_NUMBER}))*)`,
    "g"
  );
  const REF_LABELS = [
    [/^Fig/i, (n) => `图 ${n}`],
    [/^Tab/i, (n) => `表 ${n}`],
    [/^(?:Sec|§)/i, (n) => `第 ${n} 节`],
    [/^Eq/i, (n) => `式 ${n}`],
    [/^Alg/i, (n) => `算法 ${n}`],
    [/^App/i, (n) => `附录 ${n}`],
    [/^Th/i, (n) => `定理 ${n}`],
    [/^Lem/i, (n) => `引理 ${n}`],
    [/^Def/i, (n) => `定义 ${n}`],
    [/^Prop/i, (n) => `命题 ${n}`],
    [/^Cor/i, (n) => `推论 ${n}`],
    [/^Ch/i, (n) => `第 ${n} 章`],
    [/^Line/i, (n) => `第 ${n} 行`]
  ];
  const CJK = /[㐀-鿿　-〿＀-￯]/u;
  // 只在汉字与英文/数字之间留空格；中文标点前后不留
  const HAN = /[㐀-鿿]/u;
  const BREAK_BEFORE = /[，。；：、！？,.;:!?)）」』】]/;

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]);
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

  function comparableUrl(value) {
    return normalizeHref(value).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  }

  // 链接锚文本归一成编号：「Figure 3」「[12],」「(2)」→ 3、12、2
  function anchorNumber(anchor) {
    let value = String(anchor || "").replace(/\s+/g, " ").trim();
    const reference = value.match(new RegExp(`^(?:${REF_WORDS})\\s*(\\S+)$`, "i"));
    if (reference) value = reference[1];
    value = value.replace(/^[[(（]+/, "").replace(/[\])）.,;:，；]+$/, "").trim();
    return /^[A-Z]?\d{1,4}(?:\.\d{1,3})*[a-z]?$|^[A-Z]$/.test(value) ? value : "";
  }

  // 引用组、编号列表里的各项：「24, 40, 82」→ [{text:"24",start,end}]，start/end 相对整个片段
  function listItems(source) {
    const items = [];
    const pattern = /[A-Z]?\d+(?:\.\d+)*[a-z]?|(?<![A-Za-z])[A-Z](?![A-Za-z])/g;
    let match;
    while ((match = pattern.exec(source))) items.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    return items;
  }

  function overlaps(tokens, start, end) {
    return tokens.some((token) => start < token.end && token.start < end);
  }

  function nearest(candidates, offset) {
    if (!candidates.length) return null;
    if (!Number.isFinite(offset)) return candidates[0];
    return candidates.reduce((best, item) => (Math.abs(item.start - offset) < Math.abs(best.start - offset) ? item : best));
  }

  // 同一组引用里的链接框按从左到右排列。按字宽比例估出的锚文本偶尔会认错成相邻编号（「92」认成「76」），
  // 所以：链接数与编号数相同时按顺序一一对应；否则重复认领的链接顺延到后面还没被认领的编号。
  function assignListItems(token) {
    if (token.kind !== "cite" && token.kind !== "ref") return;
    const numbered = token.links.filter((link) => link.item);
    if (numbered.length < 2) return;
    const items = listItems(token.kind === "ref" ? token.source.slice((token.word || "").length) : token.source).map((item) => item.text);
    const ordered = [...numbered].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (ordered.length === items.length) {
      ordered.forEach((link, index) => { link.item = items[index]; });
      return;
    }
    const used = new Set();
    let last = -1;
    for (const link of ordered) {
      let index = items.indexOf(link.item);
      if (index < 0 || used.has(index) || index <= last) {
        const next = items.findIndex((item, position) => position > last && !used.has(position));
        if (next >= 0) index = next;
      }
      if (index >= 0 && !used.has(index)) {
        used.add(index);
        link.item = items[index];
        last = index;
      }
    }
  }

  // text：段落原文；links：[{ key, anchor, url, kind, offset }]，offset 是链接在原文中的大致字符位置
  function protectInline(text, links = []) {
    const source = String(text ?? "");
    const tokens = [];
    const add = (token) => {
      if (token.end > token.start && !overlaps(tokens, token.start, token.end)) tokens.push({ ...token, links: [] });
    };
    for (const match of source.matchAll(URL_PATTERN)) {
      const raw = trimUrl(match[0]);
      if (raw.length >= 6) add({ kind: "url", start: match.index, end: match.index + raw.length, source: raw });
    }
    for (const match of source.matchAll(CITE_PATTERN)) {
      add({ kind: "cite", start: match.index, end: match.index + match[0].length, source: match[0] });
    }
    for (const match of source.matchAll(REF_PATTERN)) {
      // 「Line」「Lines」后面不是编号时不算（例如 Lines of code）
      add({ kind: "ref", start: match.index, end: match.index + match[0].length, source: match[0], word: match[1] });
    }

    const ordered = [...(links || [])].filter(Boolean).sort((a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0));
    for (const [order, link] of ordered.entries()) {
      const entry = { key: link.key || "", url: safeHref(link.url || ""), kind: link.kind || "", anchor: String(link.anchor || ""), order };
      if (link.url && !entry.url) continue;
      const offset = Number(link.offset);
      let target = null;
      if (entry.url) {
        target = nearest(tokens.filter((token) => token.kind === "url" && comparableUrl(token.source) === comparableUrl(entry.url)), offset);
      }
      const number = anchorNumber(entry.anchor);
      if (!target && number) {
        const preferred = entry.kind === "cite" ? "cite" : "ref";
        const containing = tokens.filter((token) => (token.kind === "cite" || token.kind === "ref")
          && listItems(token.source).some((item) => item.text === number));
        target = nearest(containing.filter((token) => token.kind === preferred), offset) || nearest(containing, offset);
        if (target) entry.item = number;
      }
      if (!target) {
        // 其它带链接的文字（作者-年份引用、模型名、项目主页等）：原样保留并挂上链接
        const anchor = entry.anchor.replace(/\s+/g, " ").trim().replace(/^[([{（]+|[)\]}）.,;:，；]+$/g, "");
        if (anchor.length >= 1) {
          const occurrences = [];
          let from = 0;
          while (from <= source.length) {
            const start = source.indexOf(anchor, from);
            if (start < 0) break;
            const end = start + anchor.length;
            const wordBefore = /[A-Za-z0-9]/.test(source[start - 1] || "") && /^[A-Za-z0-9]/.test(anchor);
            const wordAfter = /[A-Za-z0-9]/.test(source[end] || "") && /[A-Za-z0-9]$/.test(anchor);
            if (!wordBefore && !wordAfter) occurrences.push({ start, end });
            from = start + 1;
          }
          const inside = occurrences.map((range) => tokens.find((token) => range.start >= token.start && range.end <= token.end)).filter(Boolean);
          const free = occurrences.filter((range) => !overlaps(tokens, range.start, range.end));
          const hit = nearest(free, offset);
          const host = nearest(inside, offset);
          if (hit && (!host || !Number.isFinite(offset) || Math.abs(hit.start - offset) <= Math.abs(host.start - offset))) {
            tokens.push({ kind: "name", start: hit.start, end: hit.end, source: source.slice(hit.start, hit.end), links: [] });
            target = tokens[tokens.length - 1];
          } else if (host) {
            target = host;
          }
        }
      }
      if (!target && entry.url && Number.isFinite(offset)) {
        // 锚文本在段落里找不到（字形提取差异）：在链接所在位置补一个链接
        let position = Math.max(0, Math.min(source.length, Math.round(offset)));
        while (position < source.length && /[A-Za-z0-9]/.test(source[position - 1] || "") && /[A-Za-z0-9]/.test(source[position])) position += 1;
        if (!overlaps(tokens, position, position + 1) || position === source.length) {
          const label = entry.anchor.trim() || comparableUrl(entry.url);
          tokens.push({ kind: "insert", start: position, end: position, source: "", label, links: [] });
          target = tokens[tokens.length - 1];
        }
      }
      if (target) target.links.push(entry);
    }

    tokens.forEach(assignListItems);
    tokens.sort((a, b) => a.start - b.start || a.end - b.end);
    let protectedText = "";
    let position = 0;
    tokens.forEach((token, index) => {
      token.id = index + 1;
      token.ratio = source.length ? token.start / source.length : 0;
      const before = source.slice(position, token.start);
      const gap = token.kind === "insert" && before && !/\s$/.test(before) ? " " : "";
      protectedText += `${before}${gap}{v${token.id}}`;
      position = token.end;
    });
    protectedText += source.slice(position);
    return { text: protectedText, tokens };
  }

  // ---- 放回 ----

  function localizedRef(token) {
    const word = token.word || "";
    const numbers = token.source.slice(word.length).replace(/^[\s~]+/, "")
      .replace(/\s*,\s*/g, "、")
      .replace(/\s+(?:and|&)\s+/g, " 和 ")
      .replace(/\s*(?:–|—|-|to)\s*/g, "–");
    const label = REF_LABELS.find(([pattern]) => pattern.test(word));
    return label ? label[1](numbers) : token.source;
  }

  function linkAttributes(entry) {
    const key = entry.key ? ` data-link="${escapeHtml(entry.key)}"` : "";
    return entry.url
      ? `class="tp-link is-external" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer"${key}`
      : `class="tp-link" href="#"${key}`;
  }

  // 列表（引用组、编号列表）：各编号分别挂自己的链接
  function renderList(text, token, html) {
    if (!html) return text;
    const items = listItems(text);
    const used = new Set();
    let output = "";
    let position = 0;
    for (const item of items) {
      const entry = token.links.find((link) => link.item === item.text && !used.has(link));
      if (!entry) continue;
      used.add(entry);
      output += `${escapeHtml(text.slice(position, item.start))}<a ${linkAttributes(entry)}>${escapeHtml(item.text)}</a>`;
      position = item.end;
    }
    return output + escapeHtml(text.slice(position));
  }

  function renderToken(token, { html, chinese }) {
    if (token.kind === "cite") {
      const body = renderList(token.source, token, html);
      return html ? `<span class="tp-cite">${body}</span>` : token.source;
    }
    if (token.kind === "ref") {
      const text = chinese ? localizedRef(token) : token.source;
      if (!html) return text;
      // 单个编号：整个「图 3」都可点；多个编号：各编号分别可点
      if (token.links.length === 1 && listItems(token.source.slice(token.word.length)).length === 1) {
        return `<a ${linkAttributes(token.links[0])}>${escapeHtml(text)}</a>`;
      }
      return renderList(text, token, true);
    }
    const text = token.kind === "insert" ? token.label : token.source;
    if (!html) return text;
    const entry = token.links[0] || (token.kind === "url" && safeHref(token.source) ? { url: safeHref(token.source), key: "" } : null);
    return entry ? `<a ${linkAttributes(entry)}>${escapeHtml(text)}</a>` : escapeHtml(text);
  }

  // 丢失的占位符：按原文相对位置补回，优先放在最近的标点前，不拆开英文单词和数字
  function insertionPoint(text, ratio) {
    const length = text.length;
    if (!length) return 0;
    const target = Math.round(Math.max(0, Math.min(1, ratio)) * length);
    const window = Math.max(6, Math.round(length * 0.12));
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = Math.max(1, target - window); index <= Math.min(length, target + window); index += 1) {
      if (!BREAK_BEFORE.test(text[index] || "")) continue;
      const distance = Math.abs(index - target);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best >= 0) return best;
    let index = Math.min(length, target);
    while (index < length && /[A-Za-z0-9]/.test(text[index - 1] || "") && /[A-Za-z0-9]/.test(text[index])) index += 1;
    return index;
  }

  // translated：带占位符的译文；返回 HTML（html=true）或纯文本
  function renderInline(translated, tokens = [], options = {}) {
    const value = String(translated ?? "");
    const byId = new Map((tokens || []).map((token) => [token.id, token]));
    const pieces = [];
    const used = new Set();
    let position = 0;
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      pieces.push({ text: value.slice(position, match.index) });
      const token = byId.get(Number(match[1]));
      if (token && !used.has(token)) {
        used.add(token);
        pieces.push({ token });
      }
      position = match.index + match[0].length;
    }
    pieces.push({ text: value.slice(position) });
    const plain = pieces.map((piece) => piece.text || "").join("");
    const chinese = options.chinese ?? CJK.test(plain);

    // 补回丢失的占位符
    for (const token of tokens || []) {
      if (used.has(token)) continue;
      const textOnly = pieces.map((piece) => piece.text ?? "").join("");
      const point = insertionPoint(textOnly, token.ratio ?? 1);
      let walked = 0;
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        if (piece.token) continue;
        if (walked + piece.text.length >= point) {
          const cut = point - walked;
          pieces.splice(index, 1, { text: piece.text.slice(0, cut) }, { token }, { text: piece.text.slice(cut) });
          break;
        }
        walked += piece.text.length;
      }
      used.add(token);
    }

    // 拼接：中文与英文/数字片段之间留一个空格
    let output = "";
    let previousChar = "";
    let lastWasToken = false;
    for (const piece of pieces) {
      if (piece.token) {
        lastWasToken = true;
        const plainToken = renderToken(piece.token, { html: false, chinese });
        const rendered = options.html ? renderToken(piece.token, { html: true, chinese }) : plainToken;
        const first = plainToken[0] || "";
        if (previousChar && HAN.test(previousChar) && /[A-Za-z0-9[(]/.test(first)) output += " ";
        if (previousChar && /[A-Za-z0-9\])]/.test(previousChar) && HAN.test(first)) output += " ";
        output += rendered;
        previousChar = plainToken[plainToken.length - 1] || previousChar;
      } else if (piece.text) {
        const first = piece.text[0];
        if (lastWasToken && previousChar && /[A-Za-z0-9\])]/.test(previousChar) && HAN.test(first)) output += " ";
        output += options.html ? escapeHtml(piece.text) : piece.text;
        previousChar = piece.text[piece.text.length - 1];
        lastWasToken = false;
      }
    }
    return output.replace(/ {2,}/g, " ");
  }

  return { PLACEHOLDER_PATTERN, protectInline, renderInline, anchorNumber, safeHref, localizedRef, insertionPoint };
});
