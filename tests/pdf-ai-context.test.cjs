const test = require("node:test");
const assert = require("node:assert/strict");

const { pageTextFromItems, selectPdfContext } = require("../pdf-ai-context.js");

test("builds readable page text from PDF text items", () => {
  assert.equal(pageTextFromItems([
    { str: "Linear maps", hasEOL: true },
    { str: "preserve", hasEOL: false },
    { str: "addition.", hasEOL: true }
  ]), "Linear maps\npreserve addition.");
});

test("selects the current page and lexically relevant PDF pages", () => {
  const result = selectPdfContext([
    { pageNumber: 1, text: "Preface and notation." },
    { pageNumber: 2, text: "Vectors and matrix multiplication." },
    { pageNumber: 3, text: "A linear map preserves vector addition and scalar multiplication." },
    { pageNumber: 4, text: "Eigenvalues and eigenvectors." }
  ], "What does a linear map preserve?", 2);

  assert.equal(result.pageNumbers[0], 2);
  assert.ok(result.pageNumbers.includes(3));
  assert.match(result.context, /\[p\. 3\]/);
});

test("samples the document for broad summary questions", () => {
  const pages = Array.from({ length: 20 }, (_, index) => ({
    pageNumber: index + 1,
    text: `Chapter content on page ${index + 1}.`
  }));
  const result = selectPdfContext(pages, "总结整份文档", 10, { maxPages: 5 });

  assert.equal(result.pageNumbers[0], 10);
  assert.ok(result.pageNumbers.length <= 5);
  assert.match(result.context, /Document map/);
});

test("uses fragment-level retrieval and a bounded context for specific questions", () => {
  const pages = [
    { pageNumber: 1, text: "Unrelated preface. ".repeat(500) },
    { pageNumber: 2, text: `${"General discussion. ".repeat(200)}The spectral theorem applies to normal operators.${" More detail. ".repeat(200)}` },
    { pageNumber: 3, text: "Appendix material. ".repeat(500) }
  ];
  const result = selectPdfContext(pages, "Where is the spectral theorem discussed?", 1);

  assert.equal(result.mode, "specific");
  assert.ok(result.pageNumbers.includes(2));
  assert.ok(result.fragmentCount <= 4);
  assert.ok(result.context.length <= 14_000);
  assert.match(result.context, /spectral theorem/i);
});

test("keeps current-page questions on the current page", () => {
  const result = selectPdfContext([
    { pageNumber: 1, text: "First page." },
    { pageNumber: 2, text: "Current page evidence." },
    { pageNumber: 3, text: "Third page." }
  ], "请解释本页", 2);

  assert.equal(result.mode, "current");
  assert.deepEqual(result.pageNumbers, [2]);
  assert.doesNotMatch(result.context, /Third page/);
});
