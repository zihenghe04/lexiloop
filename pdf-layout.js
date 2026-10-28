(function initializePdfLayout(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LexiLoopPdfLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MATH_IDENTIFIERS = new Set([
    "det", "dim", "im", "ker", "rank", "rk", "span", "tr"
  ]);

  function buildTranslationLines(items, viewportWidth) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map(normalizeItem)
      .filter(Boolean)
      .sort((a, b) => a.top - b.top || a.x - b.x);
    const rows = groupItemsIntoRows(normalizedItems);
    const lines = [];

    rows.forEach((row, rowIndex) => {
      const segments = splitRowIntoSegments(row);
      const nextTop = rows[rowIndex + 1]?.top;

      segments.forEach((segment, segmentIndex) => {
        const text = joinSegmentText(segment.items);
        if (!shouldTranslateText(text)) return;

        const x = Math.max(0, Math.min(...segment.items.map((item) => item.x)));
        const right = Math.max(...segment.items.map((item) => item.x + item.width));
        const nextSegment = segments[segmentIndex + 1];
        const pageRight = Math.max(right, Number(viewportWidth || 0) - 24);
        const cellRight = nextSegment
          ? Math.max(right, nextSegment.x - Math.max(4, row.height * 0.45))
          : pageRight;

        lines.push({
          text,
          x,
          top: Math.max(0, row.top),
          width: Math.max(24, cellRight - x),
          height: row.height,
          availableHeight: Math.max(
            row.height * 1.2,
            Number.isFinite(nextTop) ? nextTop - row.top - 1 : row.height * 2.5
          )
        });
      });
    });

    return lines;
  }

  function normalizeItem(item) {
    if (item?.rotated) return null;
    const text = String(item?.text || "").replace(/\s+/g, " ").trim();
    const x = Number(item?.x);
    const top = Number(item?.top);
    const width = Number(item?.width);
    const height = Number(item?.height);
    if (!text || ![x, top, width, height].every(Number.isFinite)) return null;
    return {
      text,
      x,
      top,
      width: Math.max(1, width),
      height: Math.max(6, height)
    };
  }

  function groupItemsIntoRows(items) {
    const rows = [];
    for (const item of items) {
      let matchingRow = null;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const candidate = rows[index];
        const tolerance = Math.max(2.5, Math.min(candidate.height, item.height) * 0.5);
        if (Math.abs(candidate.anchorTop - item.top) <= tolerance) {
          matchingRow = candidate;
          break;
        }
        if (candidate.anchorTop < item.top - Math.max(candidate.height, item.height)) break;
      }

      if (matchingRow) {
        matchingRow.items.push(item);
        matchingRow.top = Math.min(matchingRow.top, item.top);
        matchingRow.height = Math.max(matchingRow.height, item.height);
      } else {
        rows.push({
          items: [item],
          top: item.top,
          anchorTop: item.top,
          height: item.height
        });
      }
    }
    return rows.sort((a, b) => a.top - b.top);
  }

  function splitRowIntoSegments(row) {
    const sortedItems = [...row.items].sort((a, b) => a.x - b.x);
    const segments = [];
    let current = [];
    let currentRight = 0;

    for (const item of sortedItems) {
      const gap = current.length ? item.x - currentRight : 0;
      const previous = current[current.length - 1];
      const splitThreshold = previous
        ? Math.max(16, Math.min(38, Math.max(previous.height, item.height) * 1.45))
        : Number.POSITIVE_INFINITY;
      if (current.length && gap > splitThreshold) {
        segments.push(createSegment(current));
        current = [];
      }
      current.push(item);
      currentRight = Math.max(currentRight, item.x + item.width);
    }
    if (current.length) segments.push(createSegment(current));
    return segments;
  }

  function createSegment(items) {
    return {
      items,
      x: Math.min(...items.map((item) => item.x)),
      right: Math.max(...items.map((item) => item.x + item.width))
    };
  }

  function joinSegmentText(items) {
    let text = "";
    let previousRight = 0;
    for (const item of items) {
      const gap = item.x - previousRight;
      const needsSpace = text
        && gap > Math.max(1.5, item.height * 0.12)
        && !/^[,.;:!?%\])}]/.test(item.text)
        && !/[([{]$/.test(text);
      if (needsSpace) text += " ";
      text += item.text;
      previousRight = item.x + item.width;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function shouldTranslateText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || /^(?:https?:\/\/|www\.)/i.test(text)) return false;
    if (/[\u3400-\u9fff]{2}/u.test(text)) return true;

    const words = text.match(/[A-Za-z][A-Za-z'-]{1,}/g) || [];
    const meaningfulWords = words.filter((word) => !MATH_IDENTIFIERS.has(word.toLowerCase()));
    // 公式：含关系/运算符号且几乎没有自然语言词（Attention(Q, K, V) = softmax(...)V）
    if (/[=<>≤≥≈≠∑∏√∫∂∇∈∉⊂⊆→←↦×·]/u.test(text) && meaningfulWords.length < 4) return false;
    // 全大写的短符号（QKT、ReLU 之类变量名）
    if (/^[A-Z0-9]{1,4}$/.test(text)) return false;
    if (meaningfulWords.length >= 2) return true;
    if (meaningfulWords.length === 0) return false;

    const word = meaningfulWords[0];
    if (word.length < 3) return false;
    if (/^[A-Za-z][A-Za-z'-]*[.:;!?]?$/.test(text)) return true;
    if (/[=<>+*/\\^|{}[\]()]/.test(text)) return false;

    const letterCount = (text.match(/[A-Za-z]/g) || []).length;
    return letterCount / Math.max(1, text.length) >= 0.65;
  }

  // ---- 段落级排版：把同一栏内连续的行合并成段落，按段翻译、在段落框内重排 ----
  const MAX_BLOCK_CHARACTERS = 1400;
  const SECTION_HEADING_PATTERN = /^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z][^.!?]{0,80}$/;
  // 图注/表注/定理等以「Figure 3.」「Table 2:」开头；正文里的「(Fig. 3). When」不算。
  // 列表项、编号参考文献的开头标记：续行通常悬挂缩进到标记后的正文位置
  const LIST_MARKER_PATTERN = /^(?:[•▪◦‣∙●○■□–—-]\s|\(?\d{1,2}[.)]\s|\(?[a-z][.)]\s|\[\d+\]\s)/;
  const BLOCK_START_PATTERN = /^(?:Figure|Fig\.|Table|Algorithm|Listing|Theorem|Lemma|Definition|Remark|Corollary|Proposition)\s*[\dIVX]+[.:](?:\s|$)|^Proof[.:]\s|^(?:[•▪◦‣∙●○■□–—-]\s|\(?\d{1,2}[.)]\s|\(?[a-z][.)]\s|\[\d+\]\s)/;

  function buildTranslationBlocks(items, viewportWidth) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map(normalizeItem)
      .filter(Boolean)
      .sort((a, b) => a.top - b.top || a.x - b.x);
    const rowSegments = groupItemsIntoRows(normalizedItems).map(splitRowIntoSegments);
    // 栏起点会在很多行重复出现；只出现一两次的大间距是行内公式/符号造成的，应并回同一行。
    const startCounts = new Map();
    rowSegments.flat().forEach((segment) => {
      const key = Math.round(segment.x / 2);
      startCounts.set(key, (startCounts.get(key) || 0) + 1);
    });
    const columnStartCount = (x) => [-1, 0, 1].reduce((total, offset) => total + (startCounts.get(Math.round(x / 2) + offset) || 0), 0);
    // 两端对齐的正文，栏右边界同样会在很多行重复出现
    const rightCounts = new Map();
    rowSegments.flat().forEach((segment) => {
      const key = Math.round(segment.right / 2);
      rightCounts.set(key, (rightCounts.get(key) || 0) + 1);
    });
    const columnEndCount = (x) => [-1, 0, 1].reduce((total, offset) => total + (rightCounts.get(Math.round(x / 2) + offset) || 0), 0);
    const lines = [];
    rowSegments.forEach((segments) => {
      // 作者行整行是一个语义单元：姓名之间的大间距只是对齐排版，不能当成分栏间隙拆开。
      // 一旦拆开，每个姓名都是独立短块，既认不出作者行，又会被「插图标签」规则删掉，
      // 最后只剩中间几行被送去音译，作者名单就残缺了。
      const rowItems = segments.flatMap((segment) => segment.items).sort((a, b) => a.x - b.x);
      const rowText = joinSegmentText(rowItems);
      if (looksLikeAuthorLine(rowText)) {
        lines.push({
          text: rowText,
          table: false,
          author: true,
          x: Math.min(...rowItems.map((item) => item.x)),
          right: Math.max(...rowItems.map((item) => item.x + item.width)),
          top: Math.min(...rowItems.map((item) => item.top)),
          bottom: Math.max(...rowItems.map((item) => item.top + item.height)),
          height: median(rowItems.map((item) => item.height))
        });
        return;
      }
      // 一行被切成 4 段以上，多半是表格行：保留原样，不翻译
      const tableRow = segments.length >= 4;
      const merged = [];
      for (const segment of segments) {
        const previous = merged[merged.length - 1];
        const height = Math.max(...segment.items.map((item) => item.height));
        // 前一段停在常见栏右边界（栏间距），或后一段从常见栏起点开始：不是行内间隙
        if (previous && segment.x - previous.right < height * 3.5 && columnStartCount(segment.x) < 3 && columnEndCount(previous.right) < 3) {
          previous.items.push(...segment.items);
          previous.right = Math.max(previous.right, segment.right);
        } else {
          merged.push({ ...segment, items: [...segment.items] });
        }
      }
      merged.forEach((segment) => {
        const text = joinSegmentText(segment.items);
        if (!text) return;
        lines.push({
          text,
          table: tableRow,
          x: segment.x,
          right: segment.right,
          top: Math.min(...segment.items.map((item) => item.top)),
          bottom: Math.max(...segment.items.map((item) => item.top + item.height)),
          // 行高取该行主体字号（中位数），避免上下标把行高拉大
          height: median(segment.items.map((item) => item.height))
        });
      });
    });
    lines.sort((a, b) => a.top - b.top || a.x - b.x);

    // 正文字号：按字符数加权的中位数（插图标签行数多但字符少，不会拉低）
    const bodyHeight = weightedMedian(lines.map((line) => [line.height, line.text.length]));
    // 字号明显偏离正文的行不可能是作者名：偏大的多词大标题，偏小的是图例和坐标轴标签
    lines.forEach((line) => {
      if (!line.author || !bodyHeight) return;
      if (line.height >= bodyHeight * 1.22 || line.height < bodyHeight * 0.82) line.author = false;
    });
    // 作者区一般连着好几行，末行常常只剩一两位作者（Nianfeng Liu6, Yan Huang1,2,6,*）。
    // 单看不足 3 个姓名会被判成正文送去音译，但紧挨着已识别的作者行、字号一致，应一起按作者处理。
    const byTop = [...lines].sort((a, b) => a.top - b.top || a.x - b.x);
    for (let index = 1; index < byTop.length; index += 1) {
      const previous = byTop[index - 1];
      const line = byTop[index];
      if (line.author || !previous.author) continue;
      const height = Math.max(line.height, previous.height);
      if (Math.abs(line.height - previous.height) > height * 0.25) continue;
      const gap = line.top - (previous.top + previous.height);
      if (gap < -height * 0.5 || gap > Math.max(4, height * 1.6)) continue;
      if (!looksLikeNameLine(line.text)) continue;
      line.author = true;
    }

    const blocks = [];
    for (const line of lines) {
      let target = null;
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (block.closed) continue;
        if (line.top - block.bottom > block.lineHeight * 2) continue;
        if (canJoinBlock(block, line)) { target = block; break; }
      }
      if (target) appendLine(target, line);
      else {
        const block = startBlock(line);
        // 编号小节标题（3.1. Residual Learning）独立成段
        if (SECTION_HEADING_PATTERN.test(line.text)) block.closed = true;
        blocks.push(block);
      }
    }

    // 插图里的坐标轴、图例等小字：明显小于正文字号的短文本保留原样，不盖住插图。
    return blocks
      .map(finishBlock)
      .map((block) => ({ ...block, kind: classifyBlock(block, bodyHeight) }))
      // 作者姓名保留原文；机构、作者说明、编号脚注不能按“小字/短块”误删。
      .filter((block) => !(block.lineHeight < bodyHeight * 0.8 && block.text.length < 48
        && !["author", "affiliation", "footnote"].includes(block.kind)))
      .filter((block) => !block.table)
      // 图例、坐标轴标签：多行但每行只有一两个词
      .filter((block) => !(block.lineCount >= 3 && block.text.length / block.lineCount < 14))
      // 插图里的零散标签（relu、weight layer）：很短、不成句、字号不比正文大，也不是小节标题
      .filter((block) => !isFigureLabel(block, bodyHeight))
      .filter((block) => ["author", "affiliation"].includes(block.kind) || shouldTranslateText(block.text))
      .map((block) => ({ ...block, viewportWidth: Number(viewportWidth) || 0 }));
  }

  // 机构名里的词对（Peking University、Computer Science）长得和人名一样，靠关键词排除
  const AFFILIATION_KEYWORD = /\b(?:Universit(?:y|ies)|Institute|Institutes|School|Department|College|Faculty|Laborator(?:y|ies)|Academy|Hospital)\b/;
  // 姓名后面通常紧跟单位上标（He1,2、Wu5），所以结尾不能用 \b：
  // 「e」和「1」都是单词字符，边界不成立，那样连一个姓名都匹配不到。
  const NAME_PAIR_PATTERN = /\b[A-Z][a-z]{1,}(?:[-'][A-Z][a-z]+)?\s+[A-Z][a-z]{1,}(?:[-'][A-Z][a-z]+)?(?![a-z])/g;

  function countNamePairs(value) {
    return (String(value || "").match(NAME_PAIR_PATTERN) || []).length;
  }

  function looksLikeAuthorLine(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 600 || /[.!?;:]/.test(text)) return false;
    // 机构行里同样有成串的大写词对，不先排除就会把单位说明当成作者姓名保留下来。
    if (isAffiliationBlock(text) || AFFILIATION_KEYWORD.test(text)) return false;
    const pairs = countNamePairs(text);
    if (pairs < 3) return false;
    // 单位上标（He1,2）和作者分隔符（A, B）是作者行的强信号；
    // 两者都没有时要求整行几乎只有姓名，否则图例里并排的名词（Visual Semantic …）会被算成作者。
    if (/\d|[,;&]/.test(text)) return true;
    const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    return words.length <= pairs * 2;
  }

  // 只有一两个姓名的一行。单独判断不够可靠，只用来给已识别的作者区续行。
  function looksLikeNameLine(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 200 || /[.!?;:]/.test(text)) return false;
    if (isAffiliationBlock(text) || AFFILIATION_KEYWORD.test(text)) return false;
    return countNamePairs(text) >= 1;
  }

  function isAuthorBlock(block, bodyHeight) {
    const text = String(block.text || "").trim();
    if (!text || block.lineCount > 6 || !looksLikeAuthorLine(text)) return false;
    if (bodyHeight && block.lineHeight >= bodyHeight * 1.22) return false;
    return true;
  }

  function isAffiliationBlock(value) {
    const text = String(value?.text || value || "").trim();
    return /^(?:(?:\d{1,3}(?:\s*[,，]\s*\d{1,3})+|\d{1,3}|[*†‡§¶])\s*)?(?:School|Institute|University|Department|College|Faculty|Laboratory|Laboratories|Lab\.?|Centre|Center|Academy|Hospital|Corresponding authors?|Equal contribution|Work performed|Email|E-mail|Contact)\b/i.test(text);
  }

  function isFigureLabel(block, bodyHeight) {
    if (["author", "affiliation", "footnote"].includes(block.kind)) return false;
    const text = String(block.text || "");
    if (block.lineCount > 2 || text.length >= 28) return false;
    if (/[.!?:;。！？：；]["”')\]]?$/.test(text)) return false;
    if (bodyHeight && block.lineHeight > bodyHeight * 1.08) return false;
    return !SECTION_HEADING_PATTERN.test(text) && !NAMED_HEADING_PATTERN.test(text) && !CAPTION_PATTERN.test(text);
  }

  // ---- 重排译文视图用：段落类型与阅读顺序 ----
  const CAPTION_PATTERN = /^(?:Figure|Fig\.|Table|Algorithm|Listing)\s*[\dIVX]+[.:]/;
  const NAMED_HEADING_PATTERN = /^(?:Abstract|Introduction|Related Work|Background|Preliminaries|Method(?:s|ology)?|Approach|Experiments?|Evaluation|Results|Discussion|Conclusions?|Limitations|Acknowledge?ments?|References|Bibliography|Appendix)\b/i;

  // title：论文大标题；heading：小节标题；caption：图注/表注；footnote：脚注；body：正文
  function classifyBlock(block, bodyHeight) {
    const text = String(block.text || "");
    if (block.author) return "author";
    if (CAPTION_PATTERN.test(text)) return "caption";
    if (isAuthorBlock(block, bodyHeight)) return "author";
    // 通讯作者/贡献说明通常以星号或符号开头；先于机构识别，避免被“Corresponding authors”误判为机构。
    if (/^(?:[*†‡§¶]|(?:\(?\d{1,3}(?:[.,]\d{1,3})?\)?\s*)?Corresponding authors?|Equal contribution|Work performed)\b/i.test(text)) return "footnote";
    if (isAffiliationBlock(text)) return "affiliation";
    // 其它脚注：字号小于正文，以编号或括号编号开头（含「1. ...」「(1) ...」）。
    if (bodyHeight && block.lineHeight < bodyHeight * 0.96 && /^\(?\d{1,3}(?:[.,]\d{1,3})?\)?\s*\S/.test(text)) return "footnote";
    const short = block.lineCount <= 2 && text.length <= 140 && !/[.;,:]$/.test(text);
    if (short && bodyHeight && block.lineHeight >= bodyHeight * 1.35) return "title";
    if (short && (SECTION_HEADING_PATTERN.test(text) || (bodyHeight && block.lineHeight >= bodyHeight * 1.12))) return "heading";
    if (block.lineCount === 1 && text.length <= 40 && NAMED_HEADING_PATTERN.test(text) && !/[.;,]$/.test(text)) return "heading";
    return "body";
  }

  // 双栏页面按「先左栏、后右栏」排列；跨栏的段落（大标题、通栏图注）把页面切成上下几段，各段内分别按栏排序。
  function orderBlocksForReading(blocks, pageWidth) {
    const list = Array.isArray(blocks) ? blocks : [];
    const width = Number(pageWidth) || Math.max(1, ...list.map((block) => block.x + block.width));
    const columnOf = (block) => {
      if (block.x + block.width <= width * 0.56) return 0;
      if (block.x >= width * 0.44) return 1;
      return -1;
    };
    const entries = list
      .map((block) => ({ block, column: columnOf(block) }))
      .sort((a, b) => a.block.top - b.block.top || a.block.x - b.block.x);
    if (!entries.some((entry) => entry.column === 0) || !entries.some((entry) => entry.column === 1)) {
      return entries.map((entry) => entry.block);
    }
    const ordered = [];
    let band = [];
    const flush = () => {
      band.sort((a, b) => a.column - b.column || a.block.top - b.block.top);
      ordered.push(...band.map((entry) => entry.block));
      band = [];
    };
    for (const entry of entries) {
      if (entry.column === -1) { flush(); ordered.push(entry.block); }
      else band.push(entry);
    }
    flush();
    return ordered;
  }

  function startBlock(line) {
    return {
      lines: [line],
      x: line.x,
      firstX: line.x,
      right: line.right,
      top: line.top,
      bottom: line.bottom,
      lineHeight: line.height,
      characters: line.text.length,
      table: line.table,
      author: Boolean(line.author),
      listItem: LIST_MARKER_PATTERN.test(line.text),
      // 作者行独立成块：它和机构行、摘要的垂直距离常常很近，
      // 合并后整块会被当成正文送去翻译，姓名就被音译或改写了。
      closed: Boolean(line.author)
    };
  }

  function canJoinBlock(block, line) {
    const last = block.lines[block.lines.length - 1];
    if (block.table || line.table) return false;
    // 作者行与单位/通讯作者行是两个语义块；不能因为垂直距离很近而合并，
    // 否则整行作者名会被送进翻译模型，出现姓名被音译、上标归属错位。
    if ((looksLikeAuthorLine(last.text) && isAffiliationBlock(line.text))
      || (isAffiliationBlock(last.text) && looksLikeAuthorLine(line.text))) return false;
    const height = Math.max(block.lineHeight, line.height);
    if (Math.abs(line.height - block.lineHeight) > height * 0.22) return false;
    const gap = line.top - last.bottom;
    if (gap < -height * 0.45 || gap > Math.max(4, height * 0.85)) return false;
    if (block.characters + line.text.length > MAX_BLOCK_CHARACTERS) return false;
    if (BLOCK_START_PATTERN.test(line.text) || SECTION_HEADING_PATTERN.test(line.text) || isAffiliationBlock(line.text)) return false;

    // 横向必须同一栏：大部分重叠
    const overlap = Math.min(block.right, line.right) - Math.max(block.x, line.x);
    const narrower = Math.min(block.right - block.x, line.right - line.x);
    if (overlap < narrower * 0.6) return false;

    if (block.lines.length === 1) {
      // 首行缩进：第二行比首行更靠左（不超过 4 个字高）
      const indent = block.firstX - line.x;
      // 列表项 / 参考文献的悬挂缩进：续行比带标记的首行更靠右
      const hanging = block.listItem && indent < 0 && -indent <= height * 3.2;
      if (!hanging && (indent < -height * 0.6 || indent > height * 4)) return false;
      // 首行明显比下一行短，多半是标题或独立短句
      if (block.right < line.right - height * 2.5) return false;
    } else {
      // 续行对齐到第二行的左边界（普通段落即栏左边界，列表项即悬挂缩进位置）；更靠右视为新段落首行
      const bodyX = Number.isFinite(block.bodyX) ? block.bodyX : block.x;
      if (Math.abs(line.x - bodyX) > height * 0.6) return false;
    }
    return true;
  }

  function appendLine(block, line) {
    const last = block.lines[block.lines.length - 1];
    if (block.lines.length === 1) block.bodyX = line.x;
    block.lines.push(line);
    block.x = Math.min(block.x, line.x);
    block.right = Math.max(block.right, line.right);
    block.bottom = Math.max(block.bottom, line.bottom);
    block.characters += line.text.length + 1;
    // 段内短行（未到右边界）且以句末标点结束：段落结束
    const width = block.right - block.x;
    if (line.right < block.right - Math.max(block.lineHeight * 2.5, width * 0.12) && /[.!?:。！？：]["”')\]]?$/.test(line.text)) {
      block.closed = true;
    }
    void last;
  }

  function finishBlock(block) {
    let text = "";
    // 每一行在段落文字中的起止位置：用来把链接框换算成段落里的字符位置
    const lineSpans = [];
    for (const line of block.lines) {
      const value = String(line.text || "").replace(/\s+/g, " ").trim();
      let start;
      if (!text) {
        start = 0;
        text = value;
      } else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(value)) {
        // 行尾连字符断词：learn- + ing → learning
        text = text.slice(0, -1);
        start = text.length;
        text += value;
      } else {
        text += " ";
        start = text.length;
        text += value;
      }
      lineSpans.push({ x: line.x, right: line.right, top: line.top, bottom: line.bottom, start, end: text.length });
    }
    return {
      lineSpans,
      text,
      x: Math.max(0, block.x),
      top: Math.max(0, block.top),
      width: Math.max(12, block.right - block.x),
      height: Math.max(block.lineHeight, block.bottom - block.top),
      lineHeight: block.lineHeight,
      lineCount: block.lines.length,
      author: Boolean(block.author),
      table: block.table
    };
  }

  function weightedMedian(pairs) {
    const sorted = pairs.filter(([value, weight]) => Number.isFinite(value) && weight > 0).sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
    let running = 0;
    for (const [value, weight] of sorted) {
      running += weight;
      if (running >= total / 2) return value;
    }
    return 0;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // ---- 断句接续：段落被换栏、插图或换页截断时，把后半句接回来一起翻译 ----
  const TERMINAL_PATTERN = /[.!?。！？:：]["”’')\]]*$/;
  const MAX_JOINED_CHARACTERS = 1900;

  // 段落没有以句末标点结束（停在逗号、单词或连字符上）
  function isOpenEnded(text) {
    const value = String(text || "").trim();
    return value.length > 0 && !TERMINAL_PATTERN.test(value);
  }

  // 以小写字母开头（可带左括号或引号），是上一句的后半截
  function startsContinuation(text) {
    return /^[("“‘]?[a-z]/.test(String(text || "").trim());
  }

  function joinContinuation(head, tail) {
    const a = String(head || "").trim();
    const b = String(tail || "").trim();
    if (!a) return b;
    if (!b) return a;
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
  }

  // 按阅读顺序排好的段落：正文段落 A 未结束、下一个正文段落 B（跳过中间的图注、脚注）以小写开头，
  // 就把 B 接到 A 所在句子的开头段落上。返回新数组：开头段落带 joinedText 与 segments（各段在合并文本中的比例区间），
  // 被接续的段落带 continuationOf（开头段落的下标）。
  function linkContinuations(blocks) {
    const list = (Array.isArray(blocks) ? blocks : []).map((block) => ({ ...block }));
    const rootOf = (index) => (Number.isInteger(list[index].continuationOf) ? list[index].continuationOf : index);
    for (let index = 0; index < list.length; index += 1) {
      const current = list[index];
      if ((current.kind || "body") !== "body" || !isOpenEnded(current.text)) continue;
      let next = index + 1;
      while (next < list.length && ["caption", "footnote"].includes(list[next].kind)) next += 1;
      const candidate = list[next];
      if (!candidate || (candidate.kind || "body") !== "body" || !startsContinuation(candidate.text)) continue;
      const root = rootOf(index);
      const members = [...(list[root].members || [root]), next];
      const total = members.reduce((sum, member) => sum + list[member].text.length + 1, 0);
      if (total > MAX_JOINED_CHARACTERS) continue;
      list[root].members = members;
      candidate.continuationOf = root;
    }
    list.forEach((block) => {
      if (!block.members) return;
      const texts = block.members.map((member) => list[member].text);
      block.joinedText = texts.reduce((text, part) => joinContinuation(text, part), "");
      block.segments = segmentRanges(block.members.map((member) => ({ index: member, length: list[member].text.length })));
      delete block.members;
    });
    return list;
  }

  // 各段在合并文本中所占比例区间 [start, end]
  function segmentRanges(parts) {
    const total = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0) || 1;
    let start = 0;
    return parts.map((part) => {
      const end = start + Math.max(1, part.length) / total;
      const range = { ...part, start, end };
      start = end;
      return range;
    });
  }

  return {
    buildTranslationLines,
    buildTranslationBlocks,
    shouldTranslateText,
    classifyBlock,
    orderBlocksForReading,
    isOpenEnded,
    startsContinuation,
    joinContinuation,
    linkContinuations,
    segmentRanges
  };
});
