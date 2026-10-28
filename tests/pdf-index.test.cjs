const test = require("node:test");
const assert = require("node:assert/strict");

const pdfIndex = require("../pdf-index.js");

test("builds page text with character ranges and normalized PDF coordinates", () => {
  const page = pdfIndex.pageIndexFromTextContent({
    items: [
      { str: "Neural", width: 42, height: 10, transform: [10, 0, 0, 10, 50, 700] },
      { str: "retrieval", width: 55, height: 10, transform: [10, 0, 0, 10, 96, 700], hasEOL: true },
      { str: "Second line", width: 70, height: 10, transform: [10, 0, 0, 10, 50, 680] }
    ]
  }, { width: 600, height: 800 }, 2);

  assert.equal(page.pageNumber, 2);
  assert.equal(page.text, "Neural retrieval\nSecond line");
  assert.deepEqual(page.segments.map(({ start, end }) => [start, end]), [[0, 6], [7, 16], [17, 28]]);
  assert.deepEqual(page.segments[0].rect, { x: 50 / 600, y: 0.11250000000000004, width: 42 / 600, height: 10 / 800 });
});

test("searches English and whitespace-separated Chinese PDF text across papers", () => {
  const indexes = [
    pdfIndex.createDocumentIndex({
      id: "paper-a",
      title: "Retrieval Paper",
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: "A general introduction", segments: [] },
        { pageNumber: 2, text: "Dense neural retrieval improves recall.", segments: [] }
      ]
    }),
    pdfIndex.createDocumentIndex({
      id: "paper-b",
      title: "Chinese Paper",
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "机 器 学 习 系 统", segments: [] }]
    })
  ];

  const english = pdfIndex.searchIndexes(indexes, "neural retrieval");
  assert.equal(english.length, 1);
  assert.equal(english[0].paperId, "paper-a");
  assert.equal(english[0].matches[0].pageNumber, 2);
  assert.match(english[0].matches[0].snippet, /neural retrieval/i);

  const chinese = pdfIndex.searchIndexes(indexes, "机器学习");
  assert.equal(chinese.length, 1);
  assert.equal(chinese[0].paperId, "paper-b");
});

test("marks nearly textless multi-page documents as needing OCR", () => {
  const scanned = pdfIndex.createDocumentIndex({
    id: "scan",
    pageCount: 10,
    pages: [{ pageNumber: 1, text: "1", segments: [] }]
  });
  const textPdf = pdfIndex.createDocumentIndex({
    id: "text",
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: "This page contains enough selectable text for indexing and search.", segments: [] },
      { pageNumber: 2, text: "The second page also contains readable text and useful context.", segments: [] }
    ]
  });

  assert.equal(pdfIndex.needsOcr(scanned), true);
  assert.equal(pdfIndex.needsOcr(textPdf), false);
});
