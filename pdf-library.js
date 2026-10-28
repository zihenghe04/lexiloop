(() => {
  const LIBRARY_KEY = "lexiloopPdfLibrary";
  const DATABASE_NAME = "lexiloopPdfFiles";
  const DATABASE_VERSION = 2;
  const FILE_STORE = "files";
  const INDEX_STORE = "indexes";
  const VALID_STATUSES = new Set(["unread", "reading", "finished"]);
  const VALID_INDEX_STATUSES = new Set(["idle", "indexing", "ready", "needs-ocr", "error"]);

  function normalizePaper(value) {
    if (!value || typeof value !== "object") return null;
    const sourceUrl = normalizeUrl(value.sourceUrl);
    const landingUrl = normalizeUrl(value.landingUrl);
    const sourceType = value.sourceType === "local" ? "local" : "remote";
    const id = clean(value.id || (sourceUrl ? paperIdForUrl(sourceUrl) : (landingUrl ? paperIdForUrl(landingUrl) : "")), 500);
    if (!id) return null;
    const pageCount = positiveInteger(value.pageCount, 0);
    const currentPage = pageCount
      ? Math.min(pageCount, Math.max(1, positiveInteger(value.currentPage, 1)))
      : Math.max(1, positiveInteger(value.currentPage, 1));
    const progress = pageCount ? Math.min(1, currentPage / pageCount) : clamp(Number(value.progress) || 0, 0, 1);
    const indexStatus = VALID_INDEX_STATUSES.has(value.indexStatus) ? value.indexStatus : "idle";
    const now = new Date().toISOString();
    return {
      id,
      fingerprint: clean(value.fingerprint, 500),
      title: clean(value.title || value.fileName || "未命名文献", 500),
      authors: list(value.authors, 30, 160),
      year: normalizeYear(value.year),
      venue: clean(value.venue, 300),
      doi: normalizeDoi(value.doi),
      arxivId: normalizeArxivId(value.arxivId),
      abstract: clean(value.abstract),
      note: clean(value.note),
      tags: list(value.tags, 30, 80),
      favorite: Boolean(value.favorite),
      status: VALID_STATUSES.has(value.status) ? value.status : (progress > 0 ? "reading" : "unread"),
      sourceType,
      sourceUrl: sourceType === "remote" ? sourceUrl : "",
      landingUrl,
      fileName: clean(value.fileName || fileNameFromUrl(sourceUrl), 500),
      citationKey: clean(value.citationKey, 200),
      entryType: clean(value.entryType, 80),
      publisher: clean(value.publisher, 300),
      importKind: clean(value.importKind, 40),
      fileSize: Math.max(0, Number(value.fileSize) || 0),
      pageCount,
      currentPage,
      progress,
      indexStatus,
      indexVersion: positiveInteger(value.indexVersion, 0),
      indexedPageCount: pageCount
        ? Math.min(pageCount, positiveInteger(value.indexedPageCount, 0))
        : positiveInteger(value.indexedPageCount, 0),
      indexCharacterCount: Math.max(0, Math.floor(Number(value.indexCharacterCount) || 0)),
      indexTruncated: Boolean(value.indexTruncated),
      indexedAt: validDate(value.indexedAt),
      indexError: clean(value.indexError, 500),
      addedAt: validDate(value.addedAt) || now,
      updatedAt: validDate(value.updatedAt) || now,
      lastOpenedAt: validDate(value.lastOpenedAt)
    };
  }

  function normalizeLibrary(value) {
    const input = Array.isArray(value) ? value : [];
    const seen = new Set();
    return input
      .map(normalizePaper)
      .filter((paper) => paper && !seen.has(paper.id) && seen.add(paper.id));
  }

  function findPaper(library, reference = {}) {
    const papers = normalizeLibrary(library);
    const doi = normalizeDoi(reference.doi);
    const arxivId = normalizeArxivId(reference.arxivId);
    const fingerprint = clean(reference.fingerprint, 500);
    const sourceUrl = normalizeUrl(reference.sourceUrl);
    const id = clean(reference.id, 500);
    // 明确指定了库里已有的条目时以它为准，避免同一份 PDF 的两条记录互相改写
    if (id) {
      const match = papers.find((paper) => paper.id === id);
      if (match) return match;
    }
    if (doi) {
      const match = papers.find((paper) => paper.doi === doi);
      if (match) return match;
    }
    if (arxivId) {
      const match = papers.find((paper) => paper.arxivId === arxivId);
      if (match) return match;
    }
    if (fingerprint) {
      const match = papers.find((paper) => paper.fingerprint === fingerprint);
      if (match) return match;
    }
    if (sourceUrl) {
      const match = papers.find((paper) => normalizeUrl(paper.sourceUrl) === sourceUrl);
      if (match) return match;
    }
    return (id && papers.find((paper) => paper.id === id)) || null;
  }

  function upsertPaper(library, value) {
    const papers = normalizeLibrary(library);
    const existing = findPaper(papers, value);
    const now = new Date().toISOString();
    // 已存了本地文件的条目保持本地：从网页再次打开同一份 PDF 时只记下网址，不清掉本地文件
    const keepLocal = existing?.sourceType === "local" && value?.sourceType !== "local";
    const incoming = keepLocal
      ? { ...value, sourceType: "local", landingUrl: existing.landingUrl || value.landingUrl || value.sourceUrl }
      : value;
    const merged = normalizePaper({
      ...(existing || {}),
      ...incoming,
      id: existing?.id || value?.id,
      addedAt: existing?.addedAt || value?.addedAt || now,
      updatedAt: value?.updatedAt || now,
      authors: value?.authors === undefined ? existing?.authors : value.authors,
      tags: value?.tags === undefined ? existing?.tags : value.tags
    });
    if (!merged) return { papers, paper: null };
    const next = existing
      ? papers.map((paper) => paper.id === existing.id ? merged : paper)
      : [merged, ...papers];
    return { papers: next, paper: merged };
  }

  function patchPaper(library, id, changes) {
    const papers = normalizeLibrary(library);
    const existing = papers.find((paper) => paper.id === id);
    if (!existing) return { papers, paper: null };
    const patched = normalizePaper({
      ...existing,
      ...changes,
      id: existing.id,
      addedAt: existing.addedAt,
      updatedAt: new Date().toISOString(),
      authors: changes?.authors === undefined ? existing.authors : changes.authors,
      tags: changes?.tags === undefined ? existing.tags : changes.tags
    });
    if (!patched) return { papers, paper: null };
    return {
      papers: papers.map((paper) => paper.id === existing.id ? patched : paper),
      paper: patched
    };
  }

  function removePaper(library, id) {
    return normalizeLibrary(library).filter((paper) => paper.id !== id);
  }

  function resetPaperIndexes(library, ids) {
    const papers = normalizeLibrary(library);
    const selected = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    return papers.map((paper) => {
      if (selected && !selected.has(paper.id)) return paper;
      return normalizePaper({
        ...paper,
        indexStatus: "idle",
        indexVersion: 0,
        indexedPageCount: 0,
        indexCharacterCount: 0,
        indexTruncated: false,
        indexedAt: "",
        indexError: ""
      });
    });
  }

  function filterAndSort(library, options = {}) {
    const query = clean(options.query, 500).toLocaleLowerCase();
    const status = String(options.status || "all");
    const papers = normalizeLibrary(library).filter((paper) => {
      if (status === "favorite" && !paper.favorite) return false;
      if (VALID_STATUSES.has(status) && paper.status !== status) return false;
      if (!query) return true;
      return searchableText(paper).includes(query);
    });
    if (options.sort === "title") {
      papers.sort((a, b) => a.title.localeCompare(b.title));
    } else if (options.sort === "added") {
      papers.sort((a, b) => dateValue(b.addedAt) - dateValue(a.addedAt));
    } else if (options.sort === "progress") {
      papers.sort((a, b) => b.progress - a.progress || dateValue(b.lastOpenedAt) - dateValue(a.lastOpenedAt));
    } else {
      papers.sort((a, b) => dateValue(b.lastOpenedAt || b.updatedAt) - dateValue(a.lastOpenedAt || a.updatedAt));
    }
    return papers;
  }

  function libraryStats(library) {
    const papers = normalizeLibrary(library);
    return {
      total: papers.length,
      unread: papers.filter((paper) => paper.status === "unread").length,
      reading: papers.filter((paper) => paper.status === "reading").length,
      finished: papers.filter((paper) => paper.status === "finished").length,
      favorite: papers.filter((paper) => paper.favorite).length
    };
  }

  function paperIdForUrl(value) {
    const normalized = normalizeUrl(value);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `url-${(hash >>> 0).toString(36)}`;
  }

  function parsePdfDate(value) {
    const match = String(value || "").match(/(?:D:)?((?:19|20)\d{2})/);
    return match ? Number(match[1]) : "";
  }

  function splitPdfAuthors(value) {
    return list(String(value || "").replace(/\s+(?:and|&)\s+/gi, ";"), 30, 160);
  }

  function normalizeUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      if (!/^https?:$/.test(parsed.protocol)) return "";
      parsed.hash = "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function searchableText(paper) {
    return [
      paper.title,
      paper.authors.join(" "),
      paper.year,
      paper.venue,
      paper.doi,
      paper.arxivId,
      paper.abstract,
      paper.note,
      paper.tags.join(" "),
      paper.fileName,
      paper.sourceUrl,
      paper.landingUrl,
      paper.citationKey,
      paper.publisher
    ].join(" ").toLocaleLowerCase();
  }

  function list(value, maximumItems, maximumLength) {
    const input = Array.isArray(value) ? value : String(value || "").split(/[,;；、\n]/);
    const seen = new Set();
    return input
      .map((item) => clean(item, maximumLength))
      .filter((item) => item && !seen.has(item.toLocaleLowerCase()) && seen.add(item.toLocaleLowerCase()))
      .slice(0, maximumItems);
  }

  function normalizeYear(value) {
    const year = Number(String(value || "").match(/\d{4}/)?.[0]);
    return year >= 1400 && year <= 2200 ? year : "";
  }

  function normalizeDoi(value) {
    const match = String(value || "").match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
    return match ? match[0].replace(/[.,;:)\]}]+$/, "").toLocaleLowerCase() : "";
  }

  function normalizeArxivId(value) {
    const input = decodeURIComponentSafe(String(value || ""));
    const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:[?#]|$)/i);
    const match = urlMatch?.[1]
      || input.match(/(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?)/i)?.[1]
      || "";
    return match.replace(/\.pdf$/i, "").replace(/v\d+$/i, "").trim();
  }

  function fileNameFromUrl(value) {
    try {
      return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
    } catch {
      return "";
    }
  }

  function decodeURIComponentSafe(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function clean(value, maximumLength) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return Number.isFinite(maximumLength) ? normalized.slice(0, maximumLength) : normalized;
  }

  function positiveInteger(value, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function validDate(value) {
    const date = new Date(value || 0);
    return value && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
  }

  function dateValue(value) {
    const date = new Date(value || 0).getTime();
    return Number.isNaN(date) ? 0 : date;
  }

  async function putPdfBlob(id, blob) {
    if (!(blob instanceof Blob)) throw new Error("PDF 文件无效");
    return runStoreTransaction(FILE_STORE, "readwrite", (store) => store.put({ id, blob, updatedAt: Date.now() }));
  }

  async function getPdfBlob(id) {
    const record = await runStoreTransaction(FILE_STORE, "readonly", (store) => store.get(id));
    return record?.blob instanceof Blob ? record.blob : null;
  }

  async function deletePdfBlob(id) {
    return runStoreTransaction(FILE_STORE, "readwrite", (store) => store.delete(id));
  }

  async function putPdfIndex(id, index) {
    const paperId = clean(id, 500);
    if (!paperId || !index || typeof index !== "object") throw new Error("PDF 索引无效");
    return runStoreTransaction(INDEX_STORE, "readwrite", (store) => store.put({ ...index, id: paperId }));
  }

  async function getPdfIndex(id) {
    return runStoreTransaction(INDEX_STORE, "readonly", (store) => store.get(clean(id, 500)));
  }

  async function getAllPdfIndexes() {
    const records = await runStoreTransaction(INDEX_STORE, "readonly", (store) => store.getAll());
    return Array.isArray(records) ? records : [];
  }

  async function scanPdfIndexes(visitor) {
    if (typeof visitor !== "function") throw new Error("PDF 索引扫描器无效");
    const database = await openFileDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(INDEX_STORE, "readonly");
      const request = transaction.objectStore(INDEX_STORE).openCursor();
      let count = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          visitor(cursor.value);
          count += 1;
          cursor.continue();
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error || new Error("PDF 索引扫描失败"));
      transaction.oncomplete = () => {
        database.close();
        resolve(count);
      };
      transaction.onabort = () => database.close();
    });
  }

  async function getPdfIndexSummaries() {
    const summaries = [];
    await scanPdfIndexes((index) => {
      summaries.push({
        id: clean(index?.id, 500),
        version: positiveInteger(index?.version, 0),
        fingerprint: clean(index?.fingerprint, 500),
        title: clean(index?.title, 500),
        pageCount: positiveInteger(index?.pageCount, 0),
        indexedPageCount: positiveInteger(index?.indexedPageCount, 0),
        characterCount: Math.max(0, Math.floor(Number(index?.characterCount) || 0)),
        indexedAt: validDate(index?.indexedAt),
        truncated: Boolean(index?.truncated)
      });
    });
    return summaries.filter((summary) => summary.id);
  }

  async function deletePdfIndex(id) {
    return runStoreTransaction(INDEX_STORE, "readwrite", (store) => store.delete(clean(id, 500)));
  }

  async function clearPdfIndexes() {
    return runStoreTransaction(INDEX_STORE, "readwrite", (store) => store.clear());
  }

  function runStoreTransaction(storeName, mode, operation) {
    return openFileDatabase().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let request;
      try { request = operation(transaction.objectStore(storeName)); }
      catch (error) { transaction.abort(); database.close(); reject(error); return; }
      request.onerror = () => reject(request.error || new Error("本地 PDF 数据存储失败"));
      // A successful request can still be rolled back; only acknowledge a committed transaction.
      transaction.oncomplete = () => { database.close(); resolve(request.result); };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("本地 PDF 数据存储已取消"));
      };
    }));
  }

  function openFileDatabase() {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("浏览器不支持本地 PDF 数据存储"));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(INDEX_STORE)) database.createObjectStore(INDEX_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本地 PDF 数据存储"));
    });
  }

  const api = Object.freeze({
    LIBRARY_KEY,
    normalizePaper,
    normalizeLibrary,
    findPaper,
    upsertPaper,
    patchPaper,
    removePaper,
    resetPaperIndexes,
    filterAndSort,
    libraryStats,
    paperIdForUrl,
    parsePdfDate,
    splitPdfAuthors,
    normalizeUrl,
    normalizeDoi,
    normalizeArxivId,
    putPdfBlob,
    getPdfBlob,
    deletePdfBlob,
    putPdfIndex,
    getPdfIndex,
    getAllPdfIndexes,
    scanPdfIndexes,
    getPdfIndexSummaries,
    deletePdfIndex,
    clearPdfIndexes
  });

  globalThis.LexiLoopPdfLibrary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
