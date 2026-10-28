(function initializePdfAiContext(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LexiLoopPdfAiContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const STOP_WORDS = new Set([
    "about", "and", "are", "can", "does", "explain", "for", "from", "how", "into", "is", "of", "on", "the", "this", "to", "what", "why", "with"
  ]);

  function pageTextFromItems(items) {
    let text = "";
    let previousEndedLine = false;
    for (const item of Array.isArray(items) ? items : []) {
      const value = String(item?.str || "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      if (text) text += previousEndedLine ? "\n" : " ";
      text += value;
      previousEndedLine = Boolean(item?.hasEOL);
    }
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function selectPdfContext(pages, question, currentPage, options = {}) {
    const normalizedPages = (Array.isArray(pages) ? pages : [])
      .map((page, index) => ({
        pageNumber: Math.max(1, Number(page?.pageNumber || index + 1)),
        text: String(page?.text || "").trim()
      }))
      .filter((page) => page.text);
    const mode = classifyQuestion(question, options.mode);
    const defaultPages = mode === "current" || mode === "screenshot" ? 1 : mode === "broad" ? 6 : 4;
    const defaultChars = mode === "current" || mode === "screenshot" ? 8000 : mode === "broad" ? 20_000 : 14_000;
    const maxPages = clampNumber(options.maxPages, 1, 8, defaultPages);
    const maxChars = clampNumber(options.maxChars, 2000, 24_000, defaultChars);
    const tokens = queryTokens(question);
    if (!normalizedPages.length) return { context: "", pageNumbers: [], mode, fragmentCount: 0 };

    if (mode === "current" || mode === "screenshot") {
      const page = normalizedPages.find((item) => item.pageNumber === Number(currentPage)) || normalizedPages[0];
      const context = appendWithinBudget("Relevant current-page excerpt:\n", `\n[p. ${page.pageNumber}]\n${page.text}\n`, maxChars);
      return { context, pageNumbers: [page.pageNumber], mode, fragmentCount: 1 };
    }

    if (mode === "broad") {
      const selected = selectBroadPages(normalizedPages, currentPage, maxPages);
      const map = samplePages(normalizedPages, Math.min(18, normalizedPages.length))
        .map((page) => `[p. ${page.pageNumber}] ${compactSnippet(page.text, 140)}`)
        .join("\n");
      let context = map ? `Document map:\n${map}\n\nRepresentative excerpts:\n` : "Representative excerpts:\n";
      for (const page of selected) {
        context = appendWithinBudget(context, `\n[p. ${page.pageNumber}]\n${page.text.slice(0, 2600)}\n`, maxChars);
      }
      return {
        context,
        pageNumbers: selected.map((page) => page.pageNumber),
        mode,
        fragmentCount: selected.length
      };
    }

    const selectedFragments = selectRelevantFragments(normalizedPages, tokens, currentPage, maxPages);
    let context = "Retrieved PDF excerpts:\n";
    for (const fragment of selectedFragments) {
      context = appendWithinBudget(
        context,
        `\n[p. ${fragment.pageNumber}]\n[excerpt ${fragment.fragmentNumber}]\n${fragment.text}\n`,
        maxChars
      );
    }
    return {
      context,
      pageNumbers: uniqueNumbers(selectedFragments.map((fragment) => fragment.pageNumber)),
      mode,
      fragmentCount: selectedFragments.length
    };
  }

  function classifyQuestion(question, requestedMode = "") {
    if (["current", "screenshot", "specific", "broad"].includes(requestedMode)) return requestedMode;
    const value = String(question || "");
    if (/总结|概括|全文|整份|主要内容|核心观点|overview|summar|whole document|main idea/i.test(value)) return "broad";
    if (/当前页|这一页|本页|current page|this page/i.test(value)) return "current";
    return "specific";
  }

  function selectRelevantFragments(pages, tokens, currentPage, limit) {
    const fragments = pages.flatMap((page) => pageFragments(page).map((fragment) => ({
      ...fragment,
      score: scorePage(fragment.text, tokens)
    })));
    const selected = [];
    const add = (fragment) => {
      if (fragment && !selected.some((item) => item.pageNumber === fragment.pageNumber && item.fragmentNumber === fragment.fragmentNumber)) {
        selected.push(fragment);
      }
    };
    const currentFragments = fragments.filter((fragment) => fragment.pageNumber === Number(currentPage));
    currentFragments.sort((a, b) => b.score - a.score || a.fragmentNumber - b.fragmentNumber);
    add(currentFragments[0]);
    fragments
      .filter((fragment) => fragment.score > 0)
      .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber || a.fragmentNumber - b.fragmentNumber)
      .forEach(add);
    if (selected.length < 2) {
      const neighbors = fragments.filter((fragment) => Math.abs(fragment.pageNumber - Number(currentPage)) <= 1);
      neighbors.sort((a, b) => Math.abs(a.pageNumber - Number(currentPage)) - Math.abs(b.pageNumber - Number(currentPage)));
      neighbors.forEach(add);
    }
    return selected.slice(0, limit);
  }

  function pageFragments(page, size = 2400, overlap = 240) {
    const text = String(page.text || "").trim();
    const fragments = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) {
        const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end), text.lastIndexOf("。", end));
        if (boundary > start + Math.floor(size * 0.55)) end = boundary + 1;
      }
      fragments.push({
        pageNumber: page.pageNumber,
        fragmentNumber: fragments.length + 1,
        text: text.slice(start, end).trim()
      });
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
    return fragments.filter((fragment) => fragment.text);
  }

  function selectBroadPages(pages, currentPage, limit) {
    const selected = [];
    const add = (page) => {
      if (page && !selected.some((item) => item.pageNumber === page.pageNumber)) selected.push(page);
    };
    add(pages.find((page) => page.pageNumber === Number(currentPage)));
    pages.filter((page) => /\b(?:abstract|introduction|conclusion)\b|摘要|引言|结论/i.test(page.text.slice(0, 1600))).forEach(add);
    add(pages[0]);
    add(pages.at(-1));
    samplePages(pages, limit).forEach(add);
    return selected.slice(0, limit);
  }

  function appendWithinBudget(current, addition, maxChars) {
    const remaining = maxChars - current.length;
    if (remaining <= 0) return current.slice(0, maxChars).trim();
    return `${current}${addition.slice(0, remaining)}`.slice(0, maxChars).trim();
  }

  function uniqueNumbers(values) {
    return [...new Set(values.map(Number).filter(Number.isFinite))];
  }

  function queryTokens(value) {
    const text = String(value || "").toLowerCase();
    const tokens = (text.match(/[a-z0-9][a-z0-9'-]{1,}/g) || [])
      .filter((token) => !STOP_WORDS.has(token));
    const cjkRuns = text.match(/[\u3400-\u9fff]+/gu) || [];
    for (const run of cjkRuns) {
      if (run.length === 1) tokens.push(run);
      for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
    }
    return [...new Set(tokens)].slice(0, 24);
  }

  function scorePage(text, tokens) {
    const haystack = String(text || "").toLowerCase();
    return tokens.reduce((score, token) => {
      const first = haystack.indexOf(token);
      if (first < 0) return score;
      const second = haystack.indexOf(token, first + token.length);
      return score + (second >= 0 ? 3 : 2);
    }, 0);
  }

  function samplePages(pages, limit) {
    if (pages.length <= limit) return [...pages];
    const sampled = [];
    for (let index = 0; index < limit; index += 1) {
      const pageIndex = Math.round(index * (pages.length - 1) / Math.max(1, limit - 1));
      const page = pages[pageIndex];
      if (page && !sampled.includes(page)) sampled.push(page);
    }
    return sampled;
  }

  function compactSnippet(text, limit) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
  }

  return { pageTextFromItems, selectPdfContext, classifyQuestion, pageFragments, queryTokens };
});
