const test = require("node:test");
const assert = require("node:assert/strict");

const { prepareRichText } = require("../pdf-ai-renderer.js");

test("extracts inline and display LaTeX without changing Markdown code", () => {
  const prepared = prepareRichText([
    "**结论**：\\(\\prod_{n=1}^N x_n\\)",
    "",
    "\\[\\frac{a}{b} = c\\]",
    "",
    "`\\(not_math\\)`"
  ].join("\n"));

  assert.equal(prepared.math.length, 2);
  const product = prepared.math.find((expression) => expression.formula.includes("prod"));
  const fraction = prepared.math.find((expression) => expression.formula.includes("frac"));
  assert.equal(product.formula, "\\prod_{n=1}^N x_n");
  assert.equal(product.displayMode, false);
  assert.equal(fraction.formula, "\\frac{a}{b} = c");
  assert.match(prepared.markdown, /\*\*结论\*\*/);
  assert.match(prepared.markdown, /`\\\(not_math\\\)`/);
});
