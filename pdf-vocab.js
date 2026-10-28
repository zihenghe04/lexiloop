// PDF 阅读与词库打通：纯逻辑部分（可在 Node 中测试）。
// - 词库词在正文中的匹配（含常见词形变化：复数、过去式、进行时、比较级）
// - 划词所在的整句提取（作为词条语境）
// - 某篇文献里查过的词、出现在文中的词库词
// - 本文高频术语（本地分析，不调用网络）
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopPdfVocab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_PHRASE_WORDS = 5;
  // 连字符拆开处理：Embodiment-specific 里的 embodiment 也能匹配到
  const WORD_PATTERN = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g;

  // 常见英文虚词与学术写作高频词：不作为「术语」候选
  const STOPWORDS = new Set((
    "a about above according across actually after again against all almost along already also although always am among an and another any anyone anything are around as at away " +
    "back based be became because become becomes been before being below between beyond both but by can cannot could did different do does doing done down due during each either else " +
    "enough especially etc even ever every example few first following for found from further furthermore general generally get given gives go good got great had has have having " +
    "he her here hers him his how however i ie if in including indeed instead into is it its itself just keep known large last later least less let like likely made main mainly make " +
    "makes making many may me might more moreover most mostly much must my namely near nearly need neither never new next no nor not now number of off often on once one only onto or " +
    "other others otherwise our out over overall own paper part per perhaps possible present provide provided provides quite rather really recent recently respectively result results " +
    "same see seen several shall she should show shown shows significant significantly similar similarly simply since so some such than that the their them themselves then there " +
    "therefore these they this those though three through throughout thus to together too toward towards two under unlike until up upon us use used uses using usually various very " +
    "via was way we well were what when where whereas whether which while who whom whose why will with within without would yet you your section figure table fig eq et al also " +
    "approach approaches method methods work works study studies propose proposed show shows shown first second third different able data model models based task tasks set sets " +
    "time times case cases value values problem problems order terms term level levels single multiple specific various existing previous prior directly simple high low small " +
    "large larger smaller better best performance results compared compare comparison following without within across often each other non pre " +
    "arxiv preprint proceedings conference journal ieee acm springer vol volume pages pp doi http https www com org github url abs pdf html " +
    "university institute lab department email corresponding author authors equal contribution appendix supplementary acknowledgments acknowledgements"
  ).split(/\s+/));

  const ABBREVIATION_PATTERN = /(?:^|[\s(])(?:Fig|Figs|Eq|Eqs|Sec|Secs|Tab|Ref|Refs|No|Vol|al|e\.g|i\.e|etc|vs|cf|approx|resp|Dr|Mr|Ms|Prof|St|[A-Z])\.$/;

  function normalizeTerm(value) {
    return String(value || "").toLocaleLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  }

  function isEnglishTerm(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z][A-Za-z'’ -]*[A-Za-z]$/.test(text) && text.split(/\s+/).length <= MAX_PHRASE_WORDS;
  }

  // 单词的常见屈折变化（不追求完整，只覆盖学术文本里最常见的几类）
  function inflections(word) {
    const w = word.toLowerCase();
    const forms = new Set([w]);
    if (w.length < 3) return forms;
    const last = w[w.length - 1];
    const stem = w.slice(0, -1);
    const consonantY = last === "y" && !/[aeiou]/.test(w[w.length - 2]);
    forms.add(/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : consonantY ? `${stem}ies` : `${w}s`);
    if (last === "e") {
      forms.add(`${w}d`);
      forms.add(`${stem}ing`);
      forms.add(`${w}r`);
      forms.add(`${w}st`);
    } else if (consonantY) {
      forms.add(`${stem}ied`);
      forms.add(`${w}ing`);
      forms.add(`${stem}ier`);
      forms.add(`${stem}iest`);
    } else {
      forms.add(`${w}ed`);
      forms.add(`${w}ing`);
      forms.add(`${w}er`);
      forms.add(`${w}est`);
      // 重读闭音节双写：plan → planned / planning
      if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w) && w.length <= 6) {
        forms.add(`${w}${last}ed`);
        forms.add(`${w}${last}ing`);
      }
    }
    if (w.endsWith("ies") && w.length > 4) forms.add(`${w.slice(0, -3)}y`);
    if (w.endsWith("es") && w.length > 4) forms.add(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) forms.add(w.slice(0, -1));
    return forms;
  }

  // words：词库条目 [{ id, original, translated, ... }]
  function buildVocabMatcher(words) {
    const single = new Map();
    const phrases = new Map();
    for (const word of Array.isArray(words) ? words : []) {
      if (!word || !isEnglishTerm(word.original)) continue;
      const term = normalizeTerm(word.original);
      const parts = term.split(/[\s-]+/).filter(Boolean);
      if (parts.length === 1) {
        if (term.length < 2) continue;
        for (const form of inflections(term)) {
          // 已有同形的原词条优先（例如词库里同时有 model 与 models）
          if (!single.has(form) || form === term) single.set(form, word);
        }
      } else {
        // 词组：最后一个词允许屈折变化（state space model → state space models）
        const head = parts.slice(0, -1).join(" ");
        for (const form of inflections(parts[parts.length - 1])) phrases.set(`${head} ${form}`, word);
      }
    }
    const maxPhrase = Math.max(1, ...[...phrases.keys()].map((key) => key.split(" ").length));
    return { single, phrases, maxPhrase, size: single.size + phrases.size };
  }

  // 术语分析把带连字符的复合词（zero-shot、fine-grained）当作一个词
  const COMPOUND_PATTERN = /[A-Za-z][A-Za-z'’]*(?:-[A-Za-z][A-Za-z'’]*)*/g;

  function tokenize(text, pattern = WORD_PATTERN) {
    const tokens = [];
    const source = String(text || "");
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      tokens.push({ start: match.index, end: match.index + match[0].length, lower: normalizeTerm(match[0]) });
    }
    return tokens;
  }

  // 返回 [{ start, end, word }]，不重叠，词组优先于单词
  function findVocabMatches(text, matcher) {
    if (!matcher?.size) return [];
    const tokens = tokenize(text);
    const matches = [];
    for (let index = 0; index < tokens.length; index += 1) {
      let found = null;
      for (let length = Math.min(matcher.maxPhrase, tokens.length - index); length >= 2; length -= 1) {
        const slice = tokens.slice(index, index + length);
        // 词组内部只允许空白或连字符分隔（不跨句号、括号）
        let contiguous = true;
        for (let k = 1; k < slice.length; k += 1) {
          if (!/^[\s-]+$/.test(String(text).slice(slice[k - 1].end, slice[k].start))) { contiguous = false; break; }
        }
        if (!contiguous) continue;
        const key = slice.map((token) => token.lower).join(" ");
        const word = matcher.phrases.get(key);
        if (word) {
          found = { start: slice[0].start, end: slice[slice.length - 1].end, word, length };
          break;
        }
      }
      if (!found) {
        const word = matcher.single.get(tokens[index].lower);
        if (word) found = { start: tokens[index].start, end: tokens[index].end, word, length: 1 };
      }
      if (found) {
        matches.push({ start: found.start, end: found.end, word: found.word });
        index += found.length - 1;
      }
    }
    return matches;
  }

  // 选区所在的整句：向前找到句首、向后找到句末（. ! ? 后接空格与大写/数字/引号，或段落结束），最长 420 字
  function extractSentence(text, start, end, maxLength = 420) {
    const source = String(text || "").replace(/\s+/g, " ");
    const from = Math.max(0, Math.min(source.length, Number(start) || 0));
    const to = Math.max(from, Math.min(source.length, Number(end) || from));
    const boundary = /[.!?。！？](?=["”')\]]*\s+(?:["“(\[]?[A-Z0-9]))/g;
    let sentenceStart = 0;
    let sentenceEnd = source.length;
    boundary.lastIndex = 0;
    let match;
    while ((match = boundary.exec(source))) {
      // 「Fig.」「e.g.」「et al.」「Eq.」这类缩写后的句点不是句末
      if (source[match.index] === "." && ABBREVIATION_PATTERN.test(source.slice(Math.max(0, match.index - 8), match.index + 1))) continue;
      const stop = match.index + 1;
      if (stop <= from) sentenceStart = stop;
      else if (match.index >= to) {
        sentenceEnd = stop;
        break;
      }
    }
    // 引号、括号紧跟句号时一并带上
    while (sentenceEnd < source.length && /["”')\]]/.test(source[sentenceEnd])) sentenceEnd += 1;
    let sentence = source.slice(sentenceStart, sentenceEnd).trim();
    if (sentence.length > maxLength) {
      const relative = from - sentenceStart;
      const half = Math.floor(maxLength / 2);
      const cut = Math.max(0, Math.min(sentence.length - maxLength, relative - half));
      sentence = `${cut > 0 ? "…" : ""}${sentence.slice(cut, cut + maxLength).trim()}${cut + maxLength < sentence.length ? "…" : ""}`;
    }
    return sentence;
  }

  // 在一页文字里定位选中文本（忽略多余空白），返回整句语境
  function sentenceForSelection(pageText, selected) {
    const text = String(pageText || "").replace(/\s+/g, " ");
    const needle = String(selected || "").replace(/\s+/g, " ").trim();
    if (!needle) return "";
    let index = text.indexOf(needle);
    if (index < 0) index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return needle;
    return extractSentence(text, index, index + needle.length);
  }

  // 查词来源是否属于这篇文献：优先文献库 id，其次 PDF 指纹，最后网址
  function lookupMatchesDocument(lookup, doc) {
    const source = lookup?.source || {};
    if (doc.paperId && source.paperId) return source.paperId === doc.paperId;
    if (doc.documentKey && source.documentKey) return source.documentKey === doc.documentKey;
    if (doc.url && source.url) return source.url === doc.url;
    return false;
  }

  // 在这篇文献里查过的词：[{ word, lookups, pages, count, lastAt }]，按最近查询排序
  function wordsForDocument(words, doc) {
    const results = [];
    for (const word of Array.isArray(words) ? words : []) {
      const lookups = (word.lookups || []).filter((lookup) => lookupMatchesDocument(lookup, doc));
      if (!lookups.length) continue;
      const pages = [...new Set(lookups.map((lookup) => Number(lookup.source?.page)).filter((page) => page > 0))].sort((a, b) => a - b);
      const lastAt = lookups.reduce((latest, lookup) => (String(lookup.at) > latest ? String(lookup.at) : latest), "");
      results.push({ word, lookups, pages, count: lookups.length, lastAt });
    }
    return results.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  // 统计词库词在全文出现的次数：pageTexts 为 [{ page, text }]
  function vocabOccurrences(pageTexts, matcher) {
    const byWord = new Map();
    for (const { page, text } of pageTexts || []) {
      for (const match of findVocabMatches(text, matcher)) {
        const entry = byWord.get(match.word.id) || { word: match.word, count: 0, pages: [] };
        entry.count += 1;
        if (!entry.pages.includes(page)) entry.pages.push(page);
        byWord.set(match.word.id, entry);
      }
    }
    return [...byWord.values()].sort((a, b) => b.count - a.count || a.pages[0] - b.pages[0]);
  }

  function singularize(word) {
    if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
    return word;
  }

  // 展示用：同一术语的各种词形里选单数形式（若出现过），否则选最常见的
  function displayForm(forms, key) {
    const entries = [...forms.entries()];
    const singular = entries.filter(([form]) => form.split(/[\s-]/).map(singularize).join(" ") === form.replace(/-/g, " ") || form === key);
    const pool = singular.length ? singular : entries;
    return pool.sort((a, b) => b[1] - a[1])[0][0];
  }

  function isCandidate(lower) {
    return lower.length >= 4 && !STOPWORDS.has(lower) && /^[a-z][a-z-]*[a-z]$/.test(lower);
  }

  // 参考文献开始处之后的文字不参与术语分析（作者名、会议名会刷屏）
  const REFERENCES_PATTERN = /(?:^|\s)(?:References|REFERENCES|Bibliography|BIBLIOGRAPHY|参考文献)\s+(?=\[1\]|1\.\s|\(1\)|[A-Z][A-Za-z'’-]+,\s)/;

  function trimForAnalysis(pageTexts) {
    const pages = (pageTexts || []).map((page) => ({ page: page.page, text: String(page.text || "") }));
    // 每页开头 / 结尾重复出现的页眉页脚（论文名、实验室名、会议名）
    const stripRepeated = (fromEnd) => {
      const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
      for (let size = 6; size >= 2; size -= 1) {
        const counts = new Map();
        for (const page of pages) {
          const words = page.text.trim().split(/\s+/);
          if (words.length < size + 5) continue;
          const key = (fromEnd ? words.slice(-size) : words.slice(0, size)).join(" ");
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const [key, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
        if (key && count >= threshold && /[A-Za-z]{3}/.test(key)) {
          for (const page of pages) {
            const text = page.text.trim();
            if (fromEnd ? text.endsWith(key) : text.startsWith(key)) page.text = fromEnd ? text.slice(0, -key.length) : text.slice(key.length);
          }
          return;
        }
      }
    };
    if (pages.length >= 3) {
      stripRepeated(false);
      stripRepeated(true);
    }
    const result = [];
    for (const page of pages) {
      const match = REFERENCES_PATTERN.exec(page.text);
      if (match && page.page > 1) {
        const before = page.text.slice(0, match.index);
        if (before.trim()) result.push({ page: page.page, text: before });
        break;
      }
      result.push(page);
    }
    return result;
  }

  // 本文高频术语：单词与二元词组，按「出现次数（开方，弱化泛用词）× 长度权重」排序
  // known：已在词库中的词（小写集合），这些词会被标记出来而不是排除
  function analyzeTerms(pageTexts, options = {}) {
    const limit = options.limit || 24;
    const minCount = options.minCount || 3;
    const known = options.known || new Set();
    const unigrams = new Map();
    const bigrams = new Map();
    const note = (map, key, display, page, start, text) => {
      const entry = map.get(key) || { term: display, count: 0, page, firstPage: page, forms: new Map(), sample: "" };
      entry.count += 1;
      entry.forms.set(display, (entry.forms.get(display) || 0) + 1);
      if (!entry.sample) entry.sample = extractSentence(text, start, start + display.length, 240);
      map.set(key, entry);
    };
    for (const { page, text } of trimForAnalysis(pageTexts)) {
      const tokens = tokenize(text, COMPOUND_PATTERN);
      tokens.forEach((token, index) => {
        const original = String(text).slice(token.start, token.end);
        const lower = token.lower.replace(/[’']s$/, "");
        // 句子中间首字母大写的多半是专有名词（人名、模型名），不作为术语候选；句首的照常统计
        const sentenceStart = /(?:^|[.!?:;]["”')\]]*)\s*["“(\[]?$/.test(String(text).slice(Math.max(0, token.start - 6), token.start));
        if (isCandidate(lower) && (sentenceStart || !/^[A-Z][a-z]/.test(original))) {
          note(unigrams, singularize(lower), original.toLowerCase(), page, token.start, text);
        }
        const next = tokens[index + 1];
        if (!next) return;
        const between = String(text).slice(token.end, next.start);
        if (!/^\s+$/.test(between)) return;
        const nextLower = next.lower.replace(/[’']s$/, "");
        if (lower.length < 3 || nextLower.length < 3 || STOPWORDS.has(lower) || STOPWORDS.has(nextLower)) return;
        if (!/^[a-z][a-z-]*$/.test(lower) || !/^[a-z][a-z-]*$/.test(nextLower)) return;
        const display = `${lower} ${nextLower}`;
        note(bigrams, `${lower} ${singularize(nextLower)}`, display, page, token.start, text);
      });
    }
    const pickForm = (entry, key) => displayForm(entry.forms, key);
    const scored = [];
    for (const [key, entry] of bigrams) {
      if (entry.count < minCount) continue;
      scored.push({ term: pickForm(entry, key), count: entry.count, firstPage: entry.firstPage, sample: entry.sample, score: Math.sqrt(entry.count) * 4.6, kind: "phrase" });
    }
    // 被高频词组覆盖的单词降权，避免「semantic」「action」和「semantic action」同时霸榜
    const phraseWords = new Map();
    for (const item of scored) for (const part of item.term.split(/[\s-]/)) phraseWords.set(singularize(part), Math.max(phraseWords.get(singularize(part)) || 0, item.count));
    for (const [key, entry] of unigrams) {
      if (entry.count < minCount) continue;
      const covered = phraseWords.get(key) || 0;
      const effective = entry.count - covered * 0.6;
      if (effective < minCount * 0.8) continue;
      scored.push({ term: pickForm(entry, key), count: entry.count, firstPage: entry.firstPage, sample: entry.sample, score: Math.sqrt(effective) * Math.log2(Math.max(4, key.length)), kind: "word" });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.firstPage - b.firstPage)
      .slice(0, limit)
      .map(({ score, ...item }) => ({ ...item, known: known.has(normalizeTerm(item.term)) || known.has(singularize(normalizeTerm(item.term))) }));
  }

  return {
    STOPWORDS,
    normalizeTerm,
    isEnglishTerm,
    inflections,
    buildVocabMatcher,
    findVocabMatches,
    extractSentence,
    sentenceForSelection,
    lookupMatchesDocument,
    wordsForDocument,
    vocabOccurrences,
    analyzeTerms,
    trimForAnalysis,
    singularize
  };
});
