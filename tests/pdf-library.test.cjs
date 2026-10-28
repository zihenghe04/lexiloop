const test = require("node:test");
const assert = require("node:assert/strict");

const library = require("../pdf-library.js");

test("preserves a library over 1000 papers and long user notes", () => {
  const papers = Array.from({ length: 1005 }, (_, index) => ({ id: `paper-${index}`, title: `Paper ${index}` }));
  papers[0].note = '笔记'.repeat(4000);
  const normalized = library.normalizeLibrary(papers);
  assert.equal(normalized.length, 1005);
  assert.equal(normalized[0].note, papers[0].note);
  assert.equal(library.upsertPaper(normalized, { id: 'paper-new', title: 'New' }).papers.length, 1006);
});

test("deduplicates a PDF by normalized source URL and preserves its library identity", () => {
  const first = library.upsertPaper([], {
    id: "temporary-url-entry",
    title: "paper",
    sourceUrl: "https://example.com/paper.pdf#page=2",
    sourceType: "remote",
    tags: ["RAG"]
  });
  const second = library.upsertPaper(first.papers, {
    id: "pdf-fingerprint",
    fingerprint: "pdf-fingerprint",
    title: "A Better Paper Title",
    sourceUrl: "https://example.com/paper.pdf",
    pageCount: 10,
    currentPage: 4,
    status: "reading"
  });

  assert.equal(second.papers.length, 1);
  assert.equal(second.paper.id, "temporary-url-entry");
  assert.equal(second.paper.fingerprint, "pdf-fingerprint");
  assert.deepEqual(second.paper.tags, ["RAG"]);
  assert.equal(second.paper.progress, 0.4);
});

test("deduplicates papers by DOI then arXiv id before PDF location", () => {
  const papers = library.normalizeLibrary([
    {
      id: "doi-record",
      title: "DOI record",
      doi: "https://doi.org/10.1000/EXAMPLE",
      sourceUrl: "https://example.com/old.pdf"
    },
    {
      id: "arxiv-record",
      title: "arXiv record",
      arxivId: "2401.01234v1",
      sourceUrl: "https://arxiv.org/pdf/2401.01234v1.pdf"
    }
  ]);

  assert.equal(library.findPaper(papers, {
    doi: "10.1000/example",
    sourceUrl: "https://example.com/new.pdf"
  }).id, "doi-record");
  assert.equal(library.findPaper(papers, {
    arxivId: "https://arxiv.org/abs/2401.01234v3",
    sourceUrl: "https://example.com/unrelated.pdf"
  }).id, "arxiv-record");
});

test("searches paper metadata and filters reading states", () => {
  const papers = [
    { id: "a", title: "Attention Is All You Need", authors: ["Vaswani"], tags: ["Transformer"], status: "finished", favorite: true },
    { id: "b", title: "Retrieval Systems", authors: ["Chen"], note: "dense vector index", status: "reading", lastOpenedAt: "2026-08-18T00:00:00Z" },
    { id: "c", title: "Evaluation", venue: "ACL", status: "unread" }
  ];

  assert.deepEqual(library.filterAndSort(papers, { query: "vector" }).map((paper) => paper.id), ["b"]);
  assert.deepEqual(library.filterAndSort(papers, { status: "favorite" }).map((paper) => paper.id), ["a"]);
  assert.deepEqual(library.filterAndSort(papers, { status: "reading" }).map((paper) => paper.id), ["b"]);
  assert.deepEqual(library.libraryStats(papers), { total: 3, unread: 1, reading: 1, finished: 1, favorite: 1 });
});

test("normalizes PDF metadata, reading progress, and list fields", () => {
  const paper = library.normalizePaper({
    id: "paper-a",
    title: "  Example   Paper  ",
    authors: "Alice and Bob; Alice",
    tags: "AI, Reading；AI",
    year: "Published in 2024",
    pageCount: 12,
    currentPage: 99,
    status: "reading"
  });

  assert.equal(paper.title, "Example Paper");
  assert.deepEqual(paper.tags, ["AI", "Reading"]);
  assert.equal(paper.year, 2024);
  assert.equal(paper.currentPage, 12);
  assert.equal(paper.progress, 1);
  assert.equal(library.normalizeDoi("https://doi.org/10.1000/TEST.2"), "10.1000/test.2");
  assert.equal(library.normalizeArxivId("https://arxiv.org/pdf/2401.01234v4.pdf"), "2401.01234");
  assert.equal(library.parsePdfDate("D:20210302120000+08'00'"), 2021);
  assert.deepEqual(library.splitPdfAuthors("Alice and Bob & Carol"), ["Alice", "Bob", "Carol"]);
});

test("patches and removes a paper without losing unrelated metadata", () => {
  const original = library.normalizeLibrary([{
    id: "paper-a",
    title: "Paper A",
    authors: ["Alice"],
    tags: ["NLP"],
    status: "unread"
  }]);
  const patched = library.patchPaper(original, "paper-a", { status: "finished", favorite: true });

  assert.equal(patched.paper.status, "finished");
  assert.equal(patched.paper.favorite, true);
  assert.deepEqual(patched.paper.authors, ["Alice"]);
  assert.deepEqual(patched.paper.tags, ["NLP"]);
  assert.deepEqual(library.removePaper(patched.papers, "paper-a"), []);
});

test("patches the requested paper id even when a changed DOI matches another record", () => {
  const original = library.normalizeLibrary([
    { id: "paper-a", title: "Paper A", doi: "10.1000/a" },
    { id: "paper-b", title: "Paper B", doi: "10.1000/b" }
  ]);
  const patched = library.patchPaper(original, "paper-a", { title: "Updated A", doi: "10.1000/b" });

  assert.equal(patched.paper.id, "paper-a");
  assert.equal(patched.papers.find((paper) => paper.id === "paper-a").title, "Updated A");
  assert.equal(patched.papers.find((paper) => paper.id === "paper-b").title, "Paper B");
});

test("normalizes and resets PDF full-text index state", () => {
  const paper = library.normalizePaper({
    id: "indexed-paper",
    title: "Indexed",
    pageCount: 12,
    indexStatus: "ready",
    indexVersion: 1,
    indexedPageCount: 99,
    indexCharacterCount: 12345,
    indexTruncated: true,
    indexedAt: "2026-08-19T08:00:00Z"
  });

  assert.equal(paper.indexStatus, "ready");
  assert.equal(paper.indexedPageCount, 12);
  assert.equal(paper.indexCharacterCount, 12345);
  assert.equal(paper.indexTruncated, true);
  const reset = library.resetPaperIndexes([paper]);
  assert.equal(reset[0].indexStatus, "idle");
  assert.equal(reset[0].indexedPageCount, 0);
  assert.equal(reset[0].indexedAt, "");
});
