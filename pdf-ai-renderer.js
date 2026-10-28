(() => {
  const MATH_TOKEN_PREFIX = "LEXILOOPMATHEXPRESSION";
  const CODE_TOKEN_PREFIX = "LEXILOOPCODESEGMENT";

  function prepareRichText(value) {
    const codeSegments = [];
    const math = [];
    let markdown = String(value || "").replace(/\r\n?/g, "\n");

    markdown = markdown.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|`[^`\n]+`/g, (source) => {
      const token = `${CODE_TOKEN_PREFIX}${codeSegments.length}PLACEHOLDER`;
      codeSegments.push(source);
      return token;
    });

    const addMath = (source, formula, displayMode) => {
      const token = `${MATH_TOKEN_PREFIX}${math.length}PLACEHOLDER`;
      math.push({ formula: String(formula || "").trim(), displayMode, source });
      return token;
    };

    markdown = markdown
      .replace(/\\\[([\s\S]+?)\\\]/g, (source, formula) => addMath(source, formula, true))
      .replace(/\$\$([\s\S]+?)\$\$/g, (source, formula) => addMath(source, formula, true))
      .replace(/\\\((.+?)\\\)/g, (source, formula) => addMath(source, formula, false))
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (source, prefix, formula) => {
        const looksLikeMath = /[\\_^{}=+\-*/]|^[A-Za-z]$/.test(formula);
        return looksLikeMath ? `${prefix}${addMath(source.slice(prefix.length), formula, false)}` : source;
      });

    codeSegments.forEach((source, index) => {
      markdown = markdown.replace(`${CODE_TOKEN_PREFIX}${index}PLACEHOLDER`, source);
    });
    return { markdown, math };
  }

  function renderInto(container, value) {
    const content = String(value || "");
    container.classList.add("is-rich-text");
    if (!globalThis.marked?.parse || !globalThis.DOMPurify?.sanitize) {
      container.textContent = content;
      return;
    }

    const prepared = prepareRichText(content);
    const rendered = globalThis.marked.parse(prepared.markdown, {
      gfm: true,
      breaks: true,
      async: false
    });
    container.innerHTML = globalThis.DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed"],
      FORBID_ATTR: ["style"]
    });
    restoreMath(container, prepared.math);
    secureLinks(container);
  }

  function restoreMath(container, expressions) {
    if (!expressions.length) return;
    const pattern = new RegExp(`${MATH_TOKEN_PREFIX}(\\d+)PLACEHOLDER`, "g");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.includes(MATH_TOKEN_PREFIX)) nodes.push(walker.currentNode);
    }

    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(node.nodeValue))) {
        if (match.index > cursor) fragment.append(node.nodeValue.slice(cursor, match.index));
        const expression = expressions[Number(match[1])];
        fragment.append(createMathElement(expression));
        cursor = match.index + match[0].length;
      }
      if (cursor < node.nodeValue.length) fragment.append(node.nodeValue.slice(cursor));
      node.replaceWith(fragment);
    });
  }

  function createMathElement(expression) {
    const element = document.createElement("span");
    element.className = expression?.displayMode ? "pdf-ai-math is-display" : "pdf-ai-math is-inline";
    if (!expression?.formula || !globalThis.katex?.render) {
      element.textContent = expression?.source || "";
      return element;
    }
    try {
      globalThis.katex.render(expression.formula, element, {
        displayMode: expression.displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      });
    } catch {
      element.textContent = expression.source;
      element.classList.add("is-invalid");
    }
    return element;
  }

  function secureLinks(container) {
    container.querySelectorAll("a[href]").forEach((link) => {
      let url;
      try {
        url = new URL(link.href);
      } catch {
        link.removeAttribute("href");
        return;
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        link.removeAttribute("href");
        return;
      }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  const api = Object.freeze({ prepareRichText, renderInto });
  globalThis.LexiLoopPdfAiRenderer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
