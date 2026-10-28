(() => {
  const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
  const ARXIV_ID = "(?:\\d{2}(?:0[1-9]|1[0-2])\\.\\d{4,5}|[a-z-]+(?:\\.[a-z-]{2})?\\/\\d{7})(?:v\\d+)?";
  const ARXIV_PREFIX_PATTERN = new RegExp(`\\barxiv\\s*[:：]?\\s*(${ARXIV_ID})(?![\\d.])`, "i");
  const ARXIV_EXACT_PATTERN = new RegExp(`^(${ARXIV_ID})$`, "i");

  function detectInput(value) {
    const input = String(value || "").trim();
    if (!input) return { kind: "unknown", value: "" };
    if (/^@[a-z]+\s*[{(]/i.test(input)) return { kind: "bibtex", value: input };
    const doi = extractDoi(input);
    if (doi) return { kind: "doi", value: doi };
    const arxivId = extractArxivId(input);
    if (arxivId) return { kind: "arxiv", value: arxivId };
    const sourceUrl = normalizeUrl(input);
    if (sourceUrl) return { kind: "url", value: sourceUrl };
    return { kind: "unknown", value: input };
  }

  async function resolvePaperMetadata(value, fetchImpl = globalThis.fetch) {
    const detected = detectInput(value);
    if (detected.kind === "bibtex") return metadataFromBibTeX(detected.value);
    if (detected.kind === "doi") return resolveDoi(detected.value, fetchImpl);
    if (detected.kind === "arxiv") return resolveArxiv(detected.value, fetchImpl);
    if (detected.kind === "url") return metadataFromUrl(detected.value);
    throw new Error("无法识别该内容，请输入 PDF 网址、DOI、arXiv ID 或 BibTeX");
  }

  async function resolveDoi(doi, fetchImpl = globalThis.fetch) {
    const normalized = extractDoi(doi);
    if (!normalized) throw new Error("DOI 格式无效");
    const response = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Crossref 查询失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const record = payload?.message;
    if (!record) throw new Error("Crossref 没有返回文献信息");
    return metadataFromCrossref(record);
  }

  async function resolveArxiv(arxivId, fetchImpl = globalThis.fetch) {
    const normalized = extractArxivId(arxivId);
    if (!normalized) throw new Error("arXiv ID 格式无效");
    const response = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(normalized)}`, {
      headers: { Accept: "application/atom+xml" }
    });
    if (!response.ok) throw new Error(`arXiv 查询失败（HTTP ${response.status}）`);
    const xml = await response.text();
    const metadata = metadataFromArxivAtom(xml, normalized);
    if (!metadata.title) throw new Error("arXiv 没有返回匹配的论文");
    return metadata;
  }

  function metadataFromCrossref(record) {
    const links = Array.isArray(record.link) ? record.link : [];
    const pdfLink = links.find((link) => /pdf/i.test(String(link?.["content-type"] || "")))?.URL
      || links.find((link) => /\.pdf(?:$|[?#])/i.test(String(link?.URL || "")))?.URL
      || "";
    const dateParts = record.published?.["date-parts"]?.[0]
      || record["published-print"]?.["date-parts"]?.[0]
      || record["published-online"]?.["date-parts"]?.[0]
      || record.created?.["date-parts"]?.[0]
      || [];
    return cleanMetadata({
      kind: "doi",
      title: first(record.title),
      authors: (record.author || []).map((author) => author.literal || [author.given, author.family].filter(Boolean).join(" ")),
      year: dateParts[0],
      venue: first(record["container-title"]),
      doi: record.DOI,
      abstract: stripMarkup(record.abstract),
      tags: record.subject,
      sourceUrl: pdfLink,
      landingUrl: record.URL || (record.DOI ? `https://doi.org/${record.DOI}` : ""),
      entryType: record.type,
      publisher: record.publisher
    });
  }

  function metadataFromArxivAtom(xml, fallbackId = "") {
    const entry = firstXmlTag(xml, "entry");
    if (!entry || /<title>\s*Error\s*<\/title>/i.test(entry)) return cleanMetadata({ kind: "arxiv", arxivId: fallbackId });
    const idUrl = decodeXml(firstXmlTag(entry, "id"));
    const arxivId = extractArxivId(idUrl) || extractArxivId(fallbackId);
    const authors = allXmlTags(entry, "name").map(decodeXml);
    const categories = [...entry.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?\s*>/gi)]
      .map((match) => decodeXml(match[1]));
    const published = decodeXml(firstXmlTag(entry, "published"));
    return cleanMetadata({
      kind: "arxiv",
      title: decodeXml(firstXmlTag(entry, "title")),
      authors,
      year: String(published).slice(0, 4),
      venue: "arXiv",
      abstract: decodeXml(firstXmlTag(entry, "summary")),
      tags: categories,
      arxivId,
      sourceUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : "",
      landingUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl,
      doi: decodeXml(firstXmlTag(entry, "arxiv:doi")),
      entryType: "article"
    });
  }

  function metadataFromBibTeX(value) {
    const parsed = parseBibTeX(value);
    const fields = parsed.fields;
    const arxivId = extractArxivId(fields.eprint || fields.url || "");
    const doi = extractDoi(fields.doi || fields.url || "");
    const url = normalizeUrl(fields.pdf || fields.file || fields.url);
    const sourceUrl = /\.pdf(?:$|[?#])/i.test(url) ? url : (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");
    const landingUrl = doi ? `https://doi.org/${doi}` : (arxivId ? `https://arxiv.org/abs/${arxivId}` : url);
    return cleanMetadata({
      kind: "bibtex",
      title: fields.title,
      authors: splitAuthors(fields.author),
      year: fields.year,
      venue: fields.journal || fields.booktitle || fields.publisher || fields.school,
      doi,
      arxivId,
      abstract: fields.abstract,
      tags: fields.keywords,
      sourceUrl,
      landingUrl,
      citationKey: parsed.citationKey,
      entryType: parsed.entryType,
      publisher: fields.publisher
    });
  }

  function metadataFromUrl(value) {
    const sourceUrl = normalizeUrl(value);
    const arxivId = extractArxivId(sourceUrl);
    if (arxivId) return cleanMetadata({
      kind: "arxiv",
      arxivId,
      title: arxivId,
      venue: "arXiv",
      sourceUrl: `https://arxiv.org/pdf/${arxivId}`,
      landingUrl: `https://arxiv.org/abs/${arxivId}`
    });
    let fileName = "PDF 文献";
    try {
      fileName = decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() || fileName);
    } catch {}
    return cleanMetadata({
      kind: "url",
      title: fileName.replace(/\.pdf$/i, "") || "PDF 文献",
      sourceUrl,
      landingUrl: sourceUrl,
      fileName
    });
  }

  function parseBibTeX(value) {
    const input = String(value || "").trim();
    let index = 0;
    if (input[index] !== "@") throw new Error("BibTeX 必须以 @ 开头");
    index += 1;
    const entryType = readWhile((character) => /[a-z]/i.test(character)).toLocaleLowerCase();
    skipWhitespace();
    const open = input[index];
    const close = open === "{" ? "}" : open === "(" ? ")" : "";
    if (!close) throw new Error("BibTeX 条目缺少起始括号");
    index += 1;
    skipWhitespace();
    const citationKey = readUntilTopLevel([","]).trim();
    if (input[index] === ",") index += 1;
    const fields = {};
    while (index < input.length) {
      skipWhitespaceAndCommas();
      if (input[index] === close) break;
      const key = readWhile((character) => /[a-z0-9_:-]/i.test(character)).toLocaleLowerCase();
      skipWhitespace();
      if (!key || input[index] !== "=") throw new Error("BibTeX 字段格式不完整");
      index += 1;
      skipWhitespace();
      fields[key] = cleanBibValue(readValue());
      skipWhitespaceAndCommas();
    }
    if (input[index] !== close) throw new Error("BibTeX 条目括号未闭合");
    return { entryType, citationKey, fields };

    function readWhile(predicate) {
      const start = index;
      while (index < input.length && predicate(input[index])) index += 1;
      return input.slice(start, index);
    }

    function skipWhitespace() {
      while (/\s/.test(input[index] || "")) index += 1;
    }

    function skipWhitespaceAndCommas() {
      while (/\s|,/.test(input[index] || "")) index += 1;
    }

    function readValue() {
      let output = readValueTerm();
      skipWhitespace();
      while (input[index] === "#") {
        index += 1;
        skipWhitespace();
        output += readValueTerm();
        skipWhitespace();
      }
      return output;
    }

    function readValueTerm() {
      if (input[index] === "{") return readBalanced("{", "}");
      if (input[index] === '"') return readQuoted();
      return readUntilTopLevel([",", close, "#"]).trim();
    }

    function readBalanced(opening, closing) {
      index += 1;
      let depth = 1;
      let output = "";
      while (index < input.length && depth > 0) {
        const character = input[index++];
        if (character === "\\" && index < input.length) {
          output += character + input[index++];
        } else if (character === opening) {
          depth += 1;
          output += character;
        } else if (character === closing) {
          depth -= 1;
          if (depth) output += character;
        } else {
          output += character;
        }
      }
      if (depth) throw new Error("BibTeX 字段括号未闭合");
      return output;
    }

    function readQuoted() {
      index += 1;
      let output = "";
      while (index < input.length) {
        const character = input[index++];
        if (character === "\\" && index < input.length) {
          output += character + input[index++];
        } else if (character === '"') {
          return output;
        } else {
          output += character;
        }
      }
      throw new Error("BibTeX 引号未闭合");
    }

    function readUntilTopLevel(stops) {
      const start = index;
      while (index < input.length && !stops.includes(input[index])) index += 1;
      return input.slice(start, index);
    }
  }

  function mergePaperMetadata(existing, incoming) {
    const current = existing && typeof existing === "object" ? existing : {};
    const next = cleanMetadata(incoming);
    const genericTitle = isGenericTitle(current.title, current.fileName);
    return {
      ...current,
      ...(next.kind ? { importKind: next.kind } : {}),
      title: genericTitle && next.title ? next.title : (current.title || next.title),
      authors: current.authors?.length ? current.authors : next.authors,
      year: current.year || next.year,
      venue: current.venue || next.venue,
      doi: current.doi || next.doi,
      arxivId: current.arxivId || next.arxivId,
      abstract: current.abstract || next.abstract,
      tags: unique([...(current.tags || []), ...(next.tags || [])]),
      sourceUrl: current.sourceUrl || next.sourceUrl,
      landingUrl: current.landingUrl || next.landingUrl,
      fileName: current.fileName || next.fileName,
      citationKey: current.citationKey || next.citationKey,
      entryType: current.entryType || next.entryType,
      publisher: current.publisher || next.publisher
    };
  }

  function metadataIdentity(metadata) {
    const doi = extractDoi(metadata?.doi);
    if (doi) return `doi-${hash(doi)}`;
    const arxivId = extractArxivId(metadata?.arxivId);
    if (arxivId) return `arxiv-${arxivId.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const url = normalizeUrl(metadata?.sourceUrl || metadata?.landingUrl);
    if (url) return `url-${hash(url)}`;
    return `paper-${hash(JSON.stringify(metadata || {}))}`;
  }

  function cleanMetadata(value = {}) {
    return {
      kind: clean(value.kind, 40),
      title: cleanLatex(value.title, 500),
      authors: unique(Array.isArray(value.authors) ? value.authors : splitAuthors(value.authors)).map((author) => cleanLatex(author, 160)).filter(Boolean).slice(0, 40),
      year: normalizeYear(value.year),
      venue: cleanLatex(value.venue, 300),
      doi: extractDoi(value.doi),
      arxivId: extractArxivId(value.arxivId),
      abstract: cleanLatex(stripMarkup(value.abstract), 12_000),
      tags: unique(Array.isArray(value.tags) ? value.tags : String(value.tags || "").split(/[,;；、]/)).map((tag) => cleanLatex(tag, 80)).filter(Boolean).slice(0, 30),
      sourceUrl: normalizeUrl(value.sourceUrl),
      landingUrl: normalizeUrl(value.landingUrl),
      fileName: clean(value.fileName, 500),
      citationKey: clean(value.citationKey, 200),
      entryType: clean(value.entryType, 80),
      publisher: cleanLatex(value.publisher, 300)
    };
  }

  function extractDoi(value) {
    const match = String(value || "").match(DOI_PATTERN);
    return match ? match[0].replace(/[.,;:)\]}]+$/, "").toLocaleLowerCase() : "";
  }

  function extractArxivId(value) {
    const input = decodeURIComponentSafe(String(value || ""));
    const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#\s]+?)(?:\.pdf)?(?:[?#\s]|$)/i);
    const trimmed = input.trim();
    const candidate = urlMatch?.[1]
      || input.match(ARXIV_PREFIX_PATTERN)?.[1]
      || trimmed.match(ARXIV_EXACT_PATTERN)?.[1]
      || "";
    const id = candidate.replace(/\.pdf$/i, "").replace(/v\d+$/i, "").trim();
    return ARXIV_EXACT_PATTERN.test(id) ? id : "";
  }

  function splitAuthors(value) {
    return String(value || "").split(/\s+and\s+|[;；]/i).map((item) => item.trim()).filter(Boolean);
  }

  function firstXmlTag(xml, name) {
    const escaped = name.replace(":", "\\:");
    return String(xml || "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] || "";
  }

  function allXmlTags(xml, name) {
    const escaped = name.replace(":", "\\:");
    return [...String(xml || "").matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "gi"))].map((match) => match[1]);
  }

  function decodeXml(value) {
    const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    return String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
      .replace(/&([a-z]+);/gi, (match, name) => entities[name] || match)
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanBibValue(value) {
    return String(value || "").trim();
  }

  function cleanLatex(value, maximumLength) {
    return clean(String(value || "")
      .replace(/\\(?:textit|textbf|emph|url|href)\s*{([^{}]*)}/g, "$1")
      .replace(/[{}]/g, "")
      .replace(/\\([&%_$#])/g, "$1"), maximumLength);
  }

  function stripMarkup(value) {
    return String(value || "").replace(/<[^>]+>/g, " ");
  }

  function isGenericTitle(title, fileName) {
    const normalized = String(title || "").replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
    const file = String(fileName || "").replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
    return !normalized || normalized === file || ["pdf 文献", "pdf 文档", "未命名文献"].includes(normalized);
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

  function normalizeYear(value) {
    const year = Number(String(value || "").match(/\d{4}/)?.[0]);
    return year >= 1400 && year <= 2200 ? year : "";
  }

  function unique(values) {
    const seen = new Set();
    return (values || []).filter((value) => {
      const key = String(value || "").trim().toLocaleLowerCase();
      return key && !seen.has(key) && seen.add(key);
    });
  }

  function first(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function clean(value, maximumLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximumLength);
  }

  function hash(value) {
    let result = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function decodeURIComponentSafe(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  const api = Object.freeze({
    detectInput,
    resolvePaperMetadata,
    resolveDoi,
    resolveArxiv,
    metadataFromCrossref,
    metadataFromArxivAtom,
    metadataFromBibTeX,
    metadataFromUrl,
    parseBibTeX,
    mergePaperMetadata,
    metadataIdentity,
    cleanMetadata,
    extractDoi,
    extractArxivId
  });

  globalThis.LexiLoopPaperMetadata = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
