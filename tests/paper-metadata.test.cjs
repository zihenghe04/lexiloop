const test = require("node:test");
const assert = require("node:assert/strict");

const metadata = require("../paper-metadata.js");

test("detects DOI and arXiv inputs without confusing DOI suffixes for arXiv ids", () => {
  assert.deepEqual(
    metadata.detectInput("https://doi.org/10.1000/2020.12345"),
    { kind: "doi", value: "10.1000/2020.12345" }
  );
  assert.deepEqual(
    metadata.detectInput("https://arxiv.org/pdf/2401.01234v2.pdf"),
    { kind: "arxiv", value: "2401.01234" }
  );
  assert.deepEqual(
    metadata.detectInput("arXiv:hep-th/9901001v3"),
    { kind: "arxiv", value: "hep-th/9901001" }
  );
});

test("parses nested BibTeX values and maps citation metadata", () => {
  const paper = metadata.metadataFromBibTeX(`
    @inproceedings{vaswani2017attention,
      title = {Attention Is {All} You Need},
      author = {Ashish Vaswani and Noam Shazeer},
      year = 2017,
      booktitle = "Advances in " # {Neural Information Processing Systems},
      doi = {10.5555/3295222.3295349},
      keywords = {transformers, sequence modeling},
      abstract = {A {nested} abstract.}
    }
  `);

  assert.equal(paper.title, "Attention Is All You Need");
  assert.deepEqual(paper.authors, ["Ashish Vaswani", "Noam Shazeer"]);
  assert.equal(paper.venue, "Advances in Neural Information Processing Systems");
  assert.equal(paper.citationKey, "vaswani2017attention");
  assert.equal(paper.entryType, "inproceedings");
  assert.equal(paper.doi, "10.5555/3295222.3295349");
  assert.deepEqual(paper.tags, ["transformers", "sequence modeling"]);
});

test("maps Crossref records into the shared paper schema", () => {
  const paper = metadata.metadataFromCrossref({
    title: ["A Reliable Paper"],
    author: [{ given: "Ada", family: "Lovelace" }, { literal: "Research Group" }],
    "published-print": { "date-parts": [[2025, 4, 2]] },
    "container-title": ["Journal of Tests"],
    DOI: "10.1000/TEST.1",
    abstract: "<jats:p>Structured abstract</jats:p>",
    subject: ["Testing"],
    URL: "https://doi.org/10.1000/test.1",
    link: [{ URL: "https://example.com/paper.pdf", "content-type": "application/pdf" }],
    type: "journal-article",
    publisher: "Example Press"
  });

  assert.equal(paper.title, "A Reliable Paper");
  assert.deepEqual(paper.authors, ["Ada Lovelace", "Research Group"]);
  assert.equal(paper.year, 2025);
  assert.equal(paper.venue, "Journal of Tests");
  assert.equal(paper.doi, "10.1000/test.1");
  assert.equal(paper.abstract, "Structured abstract");
  assert.equal(paper.sourceUrl, "https://example.com/paper.pdf");
  assert.equal(paper.publisher, "Example Press");
});

test("maps arXiv Atom entries and normalizes versioned identifiers", () => {
  const paper = metadata.metadataFromArxivAtom(`
    <feed xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry>
        <id>https://arxiv.org/abs/2401.01234v2</id>
        <title> A Paper\nWith Spacing </title>
        <summary> Abstract &amp; details. </summary>
        <published>2024-01-03T00:00:00Z</published>
        <author><name>Ada Lovelace</name></author>
        <author><name>Alan Turing</name></author>
        <category term="cs.CL" />
        <arxiv:doi>10.1000/example</arxiv:doi>
      </entry>
    </feed>
  `);

  assert.equal(paper.title, "A Paper With Spacing");
  assert.equal(paper.arxivId, "2401.01234");
  assert.equal(paper.sourceUrl, "https://arxiv.org/pdf/2401.01234");
  assert.equal(paper.landingUrl, "https://arxiv.org/abs/2401.01234");
  assert.deepEqual(paper.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.deepEqual(paper.tags, ["cs.CL"]);
  assert.equal(paper.doi, "10.1000/example");
});

test("metadata enrichment preserves user fields and fills generic metadata", () => {
  const existing = {
    id: "local-file",
    title: "paper.pdf",
    fileName: "paper.pdf",
    authors: [],
    tags: ["待读"],
    note: "保留我的笔记",
    sourceType: "local"
  };
  const merged = metadata.mergePaperMetadata(existing, {
    kind: "doi",
    title: "Resolved Title",
    authors: ["Ada Lovelace"],
    tags: ["Testing", "待读"],
    abstract: "Resolved abstract",
    doi: "10.1000/example"
  });

  assert.equal(merged.title, "Resolved Title");
  assert.deepEqual(merged.authors, ["Ada Lovelace"]);
  assert.deepEqual(merged.tags, ["待读", "Testing"]);
  assert.equal(merged.note, "保留我的笔记");
  assert.equal(merged.abstract, "Resolved abstract");
  assert.equal(merged.importKind, "doi");

  const customTitle = metadata.mergePaperMetadata({ ...existing, title: "我的标题" }, { title: "Remote Title" });
  assert.equal(customTitle.title, "我的标题");
});
