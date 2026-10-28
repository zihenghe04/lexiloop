// 词库导入导出：纯逻辑（侧边栏与后台共用，可在 Node 中测试）。
// 导出：完整 JSON、Anki（带表头的制表符分隔文本，正面词条、背面释义 + 原句 + 来源）、CSV（Excel 可直接打开）。
// 导入：LexiLoop 导出的 JSON，或每行「词条 [分隔符] 释义」的 CSV / TSV / TXT；按词条合并，查询记录去重。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopVocabIO = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_IMPORT_WORDS = 20000;

  function normalizeTerm(value) {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function phoneticText(word) {
    const value = word.phonetics?.us || word.phonetics?.uk || word.phonetics?.generic || "";
    return value ? `/${String(value).replace(/^\/|\/$/g, "")}/` : "";
  }

  function meaningLines(word) {
    const groups = (word.meanings || [])
      .map((group) => `${group.partOfSpeech ? `${group.partOfSpeech} ` : ""}${(group.definitions || []).join("；")}`.trim())
      .filter(Boolean);
    return groups.length ? groups : [String(word.translated || "")].filter(Boolean);
  }

  // 最有代表性的一次查询：优先有原句的，其次最近的
  function bestLookup(word) {
    const lookups = Array.isArray(word.lookups) ? word.lookups : [];
    return lookups.find((lookup) => lookup.context && lookup.context !== word.original) || lookups[0] || null;
  }

  function sourceLabel(source) {
    if (!source) return "";
    const page = Number(source.page) > 0 ? ` · 第 ${source.page} 页` : "";
    return `${source.title || ""}${page}`.trim();
  }

  // 原句里把词条（含常见词形）标粗；先整体转义再加标签
  function highlightTerm(sentence, term, open = "<b>", close = "</b>") {
    const text = escapeHtml(sentence);
    const value = String(term || "").trim();
    if (!value) return text;
    const stem = value.length > 4 ? value.replace(/(e|y|es|s)$/i, "") : value;
    const pattern = new RegExp(`\\b(${escapeRegExp(escapeHtml(stem))}[A-Za-z]*)`, "gi");
    return text.replace(pattern, `${open}$1${close}`);
  }

  // Anki：Anki 2.1.54+ 识别文件头指令，导入时自动按制表符分列、按 HTML 显示
  function toAnki(words) {
    const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
    const lines = ["#separator:tab", "#html:true", "#columns:正面\t背面\t标签", "#tags column:3"];
    for (const word of words || []) {
      if (!word?.original) continue;
      const phonetic = phoneticText(word);
      const front = `${escapeHtml(word.original)}${phonetic ? `<br><span style="color:#888;font-size:.85em">${escapeHtml(phonetic)}</span>` : ""}`;
      const lookup = bestLookup(word);
      const parts = [meaningLines(word).map(escapeHtml).join("<br>")];
      if (lookup?.context && lookup.context !== word.original) parts.push(`<i>${highlightTerm(lookup.context, word.original)}</i>`);
      const label = sourceLabel(lookup?.source);
      if (label) parts.push(`<small style="color:#888">${escapeHtml(label)}</small>`);
      const tags = ["LexiLoop", lookup?.source?.kind === "pdf" ? "PDF" : ""].filter(Boolean).join(" ");
      lines.push([clean(front), clean(parts.join("<br><br>")), tags].join("\t"));
    }
    return `${lines.join("\n")}\n`;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  // CSV：带 BOM，Excel 打开不乱码
  function toCsv(words) {
    const header = ["词条", "音标", "释义", "详细释义", "原句", "来源", "页码", "查询次数", "首次查询", "下次复习"];
    const rows = [header];
    for (const word of words || []) {
      if (!word?.original) continue;
      const lookup = bestLookup(word);
      rows.push([
        word.original,
        phoneticText(word),
        word.translated || "",
        meaningLines(word).join(" | "),
        lookup?.context && lookup.context !== word.original ? lookup.context : "",
        lookup?.source?.title || "",
        Number(lookup?.source?.page) > 0 ? lookup.source.page : "",
        Number(word.translationCount) || (word.lookups || []).length || 1,
        word.createdAt || "",
        word.review?.dueAt || ""
      ]);
    }
    return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  }

  // ---- 导入 ----

  function parseDelimitedLine(line, delimiter) {
    if (delimiter !== ",") return line.split(delimiter);
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (quoted) {
        if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"' && !cell) quoted = true;
      else if (character === ",") { cells.push(cell); cell = ""; }
      else cell += character;
    }
    cells.push(cell);
    return cells;
  }

  // 返回 { words: [...完整或简单条目], format }，简单条目形如 { original, translated }
  function parseImport(text, fileName = "") {
    const source = String(text ?? "").replace(/^﻿/, "");
    const trimmed = source.trim();
    if (!trimmed) throw new Error("文件是空的");
    if (/^[[{]/.test(trimmed)) {
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch {
        throw new Error("JSON 格式不正确");
      }
      const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : Array.isArray(data?.local?.lexiloopWords) ? data.local.lexiloopWords : null;
      if (!list) throw new Error("没有在 JSON 里找到词条列表");
      const words = list
        .filter((item) => item && typeof item === "object" && typeof item.original === "string" && item.original.trim())
        .slice(0, MAX_IMPORT_WORDS);
      return { words, format: "json" };
    }
    const lines = source.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
    const sample = lines.slice(0, 20).join("\n");
    const delimiter = /\.tsv$/i.test(fileName) || sample.includes("\t") ? "\t" : /\.csv$/i.test(fileName) || /,/.test(sample) ? "," : null;
    const words = [];
    lines.forEach((line, index) => {
      const cells = delimiter ? parseDelimitedLine(line, delimiter).map((cell) => cell.trim()) : [line.trim()];
      const [original = "", translated = "", ...rest] = cells;
      // 表头行（LexiLoop 自己导出的 CSV 或常见的 word/meaning 表头）跳过
      if (index === 0 && /^(词条|单词|word|term|front|正面)$/i.test(original)) return;
      const term = original.replace(/<[^>]+>/g, "").trim();
      if (!term || term.length > 200) return;
      words.push({ original: term, translated: translated.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), context: delimiter === "," ? (rest[2] || "") : "" });
    });
    if (!words.length) throw new Error("没有找到可导入的词条");
    return { words: words.slice(0, MAX_IMPORT_WORDS), format: delimiter === "\t" ? "tsv" : delimiter === "," ? "csv" : "txt" };
  }

  // 把导入的条目合并进现有词库。完整条目（带 lookups）合并查询记录；简单条目新建或补释义。
  // options.now、options.uuid 便于测试注入。返回 { words, added, merged, skipped }
  function mergeImported(existing, imported, options = {}) {
    const now = options.now || new Date().toISOString();
    const uuid = options.uuid || (() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`));
    const words = (Array.isArray(existing) ? existing : []).map((word) => ({ ...word, lookups: [...(word.lookups || [])] }));
    const index = new Map(words.map((word, position) => [normalizeTerm(word.original), position]));
    let added = 0;
    let merged = 0;
    let skipped = 0;
    for (const item of imported || []) {
      const term = normalizeTerm(item?.original);
      if (!term) { skipped += 1; continue; }
      const full = Array.isArray(item.lookups);
      const lookups = full
        ? item.lookups.filter((lookup) => lookup && typeof lookup === "object").map((lookup) => ({ ...lookup, id: String(lookup.id || uuid()) }))
        : [{ id: uuid(), at: now, source: { title: "导入" }, context: String(item.context || "").slice(0, 420), trigger: "import" }];
      const position = index.get(term);
      if (position === undefined) {
        const entry = full
          ? { ...item, id: String(item.id || uuid()), lookups }
          : {
              id: uuid(),
              original: String(item.original).trim(),
              translated: String(item.translated || ""),
              detectedLanguage: /[㐀-鿿]/.test(item.original) ? "zh" : "en",
              targetLanguage: /[㐀-鿿]/.test(item.original) ? "en" : "zh-CN",
              phonetics: {},
              audio: {},
              meanings: [],
              service: "导入",
              context: String(item.context || "").slice(0, 420),
              source: { title: "导入" },
              createdAt: now,
              updatedAt: now,
              translationCount: 1,
              lookups,
              review: { stage: 0, dueAt: now }
            };
        if (!entry.review) entry.review = { stage: 0, dueAt: now };
        entry.translationCount = Math.max(1, Number(entry.translationCount) || 0, entry.lookups.length);
        index.set(term, words.length);
        words.push(entry);
        added += 1;
        continue;
      }
      const current = words[position];
      const known = new Set(current.lookups.map((lookup) => lookup.id));
      const fresh = full ? lookups.filter((lookup) => !known.has(lookup.id)) : [];
      if (full) {
        current.lookups = [...current.lookups, ...fresh].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
        current.translationCount = Math.max(Number(current.translationCount) || 0, Number(item.translationCount) || 0, current.lookups.length);
        if (!current.meanings?.length && item.meanings?.length) current.meanings = item.meanings;
        if (!current.phonetics || !Object.keys(current.phonetics).length) current.phonetics = item.phonetics || current.phonetics || {};
        // 复习进度取更靠后的一方
        if ((Number(item.review?.stage) || 0) > (Number(current.review?.stage) || 0)) current.review = item.review;
        if (String(item.createdAt || "") && String(item.createdAt) < String(current.createdAt || "9")) current.createdAt = item.createdAt;
      }
      let changed = fresh.length > 0;
      if (!current.translated && item.translated) {
        current.translated = String(item.translated);
        changed = true;
      }
      if (changed) merged += 1;
      else skipped += 1;
    }
    return { words, added, merged, skipped };
  }

  return { toAnki, toCsv, parseImport, mergeImported, highlightTerm, bestLookup, sourceLabel, normalizeTerm };
});
