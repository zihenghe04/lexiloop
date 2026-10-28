const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const readerSource = fs.readFileSync(require.resolve("../pdf-reader.js"), "utf8");
const readerHtml = fs.readFileSync(require.resolve("../pdf-reader.html"), "utf8");
const readerCss = fs.readFileSync(require.resolve("../pdf-reader.css"), "utf8");

test("renders Markdown during PDF AI streaming instead of waiting for completion", () => {
  const streamFunction = readerSource.match(/function appendAiStreamChunk[\s\S]*?\n}\n\nfunction completeAiMessage/)?.[0] || "";
  assert.match(streamFunction, /LexiLoopPdfAiRenderer\.renderInto\(target\.body, target\.streamContent\)/);
  assert.doesNotMatch(streamFunction, /appendData|createTextNode/);
});

test("provides previewable jump nodes for PDF AI conversation turns", () => {
  assert.match(readerHtml, /id="aiMessageNodeRail"/);
  assert.match(readerHtml, /id="aiMessageNodeList"/);
  assert.match(readerHtml, /id="aiMessageNodePreview"/);
  assert.match(readerSource, /function renderAiMessageNodes\(\)/);
  assert.match(readerSource, /message\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(readerSource, /function showAiMessageNodePreview\(/);
  assert.match(readerSource, /mouseenter/);
  assert.match(readerCss, /\.pdf-ai-node-preview-layer\s*\{[^}]*position:\s*fixed/);
  assert.ok(
    readerHtml.indexOf('id="aiMessageNodePreview"') < readerHtml.indexOf('id="aiMessageNodeRail"'),
    "the preview layer must live outside the clipped node rail"
  );
});

test("provides a copy action for completed assistant answers", () => {
  const appendFunction = readerSource.match(/function appendAiMessage\([\s\S]*?\n}\n\nfunction appendAiStreamChunk/)?.[0] || "";
  const completeFunction = readerSource.match(/function completeAiMessage\([\s\S]*?\n}\n\nfunction resetAiStreamTarget/)?.[0] || "";
  assert.match(appendFunction, /message\.dataset\.rawContent/);
  assert.match(appendFunction, /appendAiMessageActions\(message\)/);
  assert.match(completeFunction, /target\.message\.dataset\.rawContent = options\.error \? "" : rawContent/);
  assert.match(completeFunction, /appendAiMessageActions\(target\.message\)/);
  assert.match(readerSource, /navigator\.clipboard\?\.writeText/);
  assert.match(readerSource, /navigator\.clipboard\?\.write/);
  assert.match(readerSource, /text\/html/);
  assert.match(readerSource, /message\?\.dataset\?\.rawContent/);
  assert.match(readerSource, /document\.execCommand\("copy"\)/);
  assert.match(readerSource, /showToast\("回答已复制"\)/);
  assert.match(readerSource, /className = "pdf-ai-message-copy icon-button compact"/);
  assert.match(readerCss, /\.pdf-ai-message-actions\s*\{/);
});
