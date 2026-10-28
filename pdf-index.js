(function initializePdfIndex(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LexiLoopPdfIndex = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const INDEX_VERSION = 1;
  const MAX_INDEX_PAGES = 3000;
  const MAX_INDEX_CHARACTERS = 5_000_000;
  const MAX_PAGE_CHARACTERS = 100_000;
  const MAX_SEGMENTS_PER_PAGE = 5000;

  function pageIndexFromTextContent(textContent, viewport, pageNumber, options = {}) {
    const maximumCharacters = clampInteger(options.maximumCharacters, 1, MAX_PAGE_CHARACTERS, MAX_PAGE_CHARACTERS);
    const maximumSegments = clampInteger(options.maximumSegments, 1, MAX_SEGMENTS_PER_PAGE, MAX_SEGMENTS_PER_PAGE);
    const width = positiveNumber(viewport?.width, 1);
    const height = positiveNumber(viewport?.height, 1);
    let text = "";
    let previousEndedLine = false;
    let truncated = false;
    const segments = [];

    for (const item of Array.isArray(textContent?.items) ? textContent.items : []) {
      const value = cleanText(item?.str);
      if (!value) continue;
      const separator = text ? (previousEndedLine ? "\n" : " ") : "";
      const remaining = maximumCharacters - text.length - separator.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const storedValue = value.slice(0, remaining);
      if (separator) text += separator;
      const start = text.length;
      text += storedValue;
      const end = text.length;
      if (segments.length < maximumSegments) {
        segments.push({ start, end, rect: normalizedItemRect(item, width, height) });
      } else {
        truncated = true;
      }
      if (storedValue.length < value.length) {
        truncated = true;
        break;
      }
      previousEndedLine = Boolean(item?.hasEOL);
    }

    return {
      pageNumber: Math.max(1, Math.floor(Number(pageNumber) || 1)),
      text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
      segments,
      truncated
    };
  }

  function createDocumentIndex(value = {}) {
    const totalPages = Math.max(0, Math.floor(Number(value.pageCount) || 0));
    const inputPages = Array.isArray(value.pages) ? value.pages : [];
    const pages = [];
    let characterCount = 0;
    let truncated = Boolean(value.truncated);

    for (const input of inputPages) {
      if (pages.length >= MAX_INDEX_PAGES || characterCount >= MAX_INDEX_CHARACTERS) {
        truncated = true;
        break;
      }
      const remaining = MAX_INDEX_CHARACTERS - characterCount;
      const page = normalizePageIndex(input, remaining);
      pages.push(page);
      characterCount += page.text.length;
      truncated ||= page.truncated;
    }
    if (totalPages && pages.length < totalPages) truncated = true;

    return {
      id: clean(value.id, 500),
      version: INDEX_VERSION,
      fingerprint: clean(value.fingerprint, 500),
      title: clean(value.title, 500),
      pageCount: totalPages || pages.length,
      indexedPageCount: pages.length,
      characterCount,
      indexedAt: validDate(value.indexedAt) || new Date().toISOString(),
      truncated,
      pages
    };
  }

  function normalizeDocumentIndex(value) {
    if (!value || typeof value !== "object" || !clean(value.id, 500)) return null;
    return createDocumentIndex(value);
  }

  function searchIndexes(indexes, query, options = {}) {
    const normalizedQuery = cleanSearchText(query);
    if (!normalizedQuery) return [];
    const compactQuery = compactSearchText(normalizedQuery);
    const terms = queryTerms(normalizedQuery);
    const maximumPapers = clampInteger(options.maximumPapers, 1, 200, 80);
    const matchesPerPaper = clampInteger(options.matchesPerPaper, 1, 10, 3);
    const allowedIds = Array.isArray(options.paperIds) ? new Set(options.paperIds.map(String)) : null;
    const results = [];

    for (const rawIndex of Array.isArray(indexes) ? indexes : []) {
      const index = rawIndex?.id && Array.isArray(rawIndex.pages) ? rawIndex : normalizeDocumentIndex(rawIndex);
      if (!index || (allowedIds && !allowedIds.has(index.id))) continue;
      const matches = [];
      let score = 0;
      for (const page of index.pages) {
        const pageMatch = searchPage(page, normalizedQuery, compactQuery, terms);
        if (!pageMatch) continue;
        score += pageMatch.score;
        matches.push(pageMatch);
      }
      if (!matches.length) continue;
      matches.sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);
      results.push({
        paperId: index.id,
        title: index.title,
        score,
        matches: matches.slice(0, matchesPerPaper)
      });
    }

    return results
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, maximumPapers);
  }

  function searchPage(page, normalizedQuery, compactQuery, terms) {
    const text = String(page.text || "");
    if (!text) return null;
    const searchable = cleanSearchText(text);
    const compact = compactSearchText(searchable);
    const exactIndex = searchable.indexOf(normalizedQuery);
    const compactExactIndex = compactQuery.length > 1 ? compact.indexOf(compactQuery) : -1;
    const termPositions = terms.map((term) => ({
      term,
      position: searchable.indexOf(term),
      compactPosition: compact.indexOf(compactSearchText(term))
    }));
    const allTermsMatch = termPositions.length > 0
      && termPositions.every((entry) => entry.position >= 0 || entry.compactPosition >= 0);
    if (exactIndex < 0 && compactExactIndex < 0 && !allTermsMatch) return null;

    let score = exactIndex >= 0 ? 40 : compactExactIndex >= 0 ? 32 : 0;
    for (const entry of termPositions) {
      if (entry.position < 0 && entry.compactPosition < 0) continue;
      const occurrences = countOccurrences(entry.position >= 0 ? searchable : compact, entry.position >= 0 ? entry.term : compactSearchText(entry.term));
      score += 4 + Math.min(occurrences, 8);
    }
    const anchor = exactIndex >= 0
      ? exactIndex
      : Math.max(0, termPositions.find((entry) => entry.position >= 0)?.position || findOriginalAnchor(searchable, normalizedQuery));
    const rangeEnd = Math.min(text.length, anchor + Math.max(normalizedQuery.length, 1));
    return {
      pageNumber: page.pageNumber,
      score,
      snippet: snippetAround(text, anchor, 240),
      matchStart: anchor,
      matchEnd: rangeEnd,
      rects: rectsForRange(page.segments, anchor, rangeEnd)
    };
  }

  function queryTerms(value) {
    const input = cleanSearchText(value);
    const terms = input.match(/[a-z0-9][a-z0-9'._-]*|[\u3400-\u9fff]+/gu) || [];
    return [...new Set(terms.filter((term) => /[\u3400-\u9fff]/u.test(term) || term.length >= 2))].slice(0, 20);
  }

  function needsOcr(index, options = {}) {
    const normalized = normalizeDocumentIndex(index);
    if (!normalized || !normalized.pageCount) return false;
    const minimumCharactersPerPage = clampInteger(options.minimumCharactersPerPage, 1, 200, 24);
    const minimumTextPages = Math.max(1, Math.ceil(normalized.pageCount * 0.1));
    const textPages = normalized.pages.filter((page) => page.text.length >= minimumCharactersPerPage).length;
    return normalized.characterCount < normalized.pageCount * minimumCharactersPerPage
      || textPages < Math.min(normalized.pageCount, minimumTextPages);
  }

  function normalizePageIndex(value, remainingCharacters = MAX_INDEX_CHARACTERS) {
    const text = String(value?.text || "").slice(0, Math.max(0, remainingCharacters));
    const segments = (Array.isArray(value?.segments) ? value.segments : [])
      .slice(0, MAX_SEGMENTS_PER_PAGE)
      .map((segment) => ({
        start: clampInteger(segment?.start, 0, text.length, 0),
        end: clampInteger(segment?.end, 0, text.length, 0),
        rect: normalizeRect(segment?.rect)
      }))
      .filter((segment) => segment.end > segment.start);
    return {
      pageNumber: Math.max(1, Math.floor(Number(value?.pageNumber) || 1)),
      text,
      segments,
      truncated: Boolean(value?.truncated || String(value?.text || "").length > text.length)
    };
  }

  function normalizedItemRect(item, pageWidth, pageHeight) {
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const fontHeight = Math.abs(Number(transform[3]) || Number(item?.height) || 0);
    return normalizeRect({
      x: (Number(transform[4]) || 0) / pageWidth,
      y: 1 - ((Number(transform[5]) || 0) + fontHeight) / pageHeight,
      width: (Number(item?.width) || 0) / pageWidth,
      height: fontHeight / pageHeight
    });
  }

  function normalizeRect(value) {
    return {
      x: clampNumber(value?.x, 0, 1, 0),
      y: clampNumber(value?.y, 0, 1, 0),
      width: clampNumber(value?.width, 0, 1, 0),
      height: clampNumber(value?.height, 0, 1, 0)
    };
  }

  function rectsForRange(segments, start, end) {
    return (Array.isArray(segments) ? segments : [])
      .filter((segment) => segment.end > start && segment.start < end)
      .slice(0, 12)
      .map((segment) => normalizeRect(segment.rect));
  }

  function snippetAround(text, position, limit) {
    const input = String(text || "").replace(/\s+/g, " ").trim();
    if (input.length <= limit) return input;
    const safePosition = Math.min(input.length, Math.max(0, Number(position) || 0));
    const start = Math.max(0, safePosition - Math.floor(limit * 0.38));
    const end = Math.min(input.length, start + limit);
    return `${start ? "..." : ""}${input.slice(start, end).trim()}${end < input.length ? "..." : ""}`;
  }

  function findOriginalAnchor(text, query) {
    const firstTerm = queryTerms(query)[0] || "";
    return firstTerm ? Math.max(0, text.indexOf(firstTerm)) : 0;
  }

  function countOccurrences(text, term) {
    if (!term) return 0;
    let count = 0;
    let position = 0;
    while (count < 20 && (position = text.indexOf(term, position)) >= 0) {
      count += 1;
      position += Math.max(1, term.length);
    }
    return count;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanSearchText(value) {
    return cleanText(value).toLocaleLowerCase();
  }

  function compactSearchText(value) {
    return cleanSearchText(value).replace(/\s+/g, "");
  }

  function clean(value, maximumLength) {
    return cleanText(value).slice(0, maximumLength);
  }

  function validDate(value) {
    const date = new Date(value || 0);
    return value && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  return Object.freeze({
    INDEX_VERSION,
    MAX_INDEX_PAGES,
    MAX_INDEX_CHARACTERS,
    MAX_PAGE_CHARACTERS,
    MAX_SEGMENTS_PER_PAGE,
    pageIndexFromTextContent,
    createDocumentIndex,
    normalizeDocumentIndex,
    searchIndexes,
    queryTerms,
    needsOcr
  });
});
