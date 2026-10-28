// PDF 透明文字层的对齐与选区稳定。
//
// 划词时选区和画面错位，有四个来源：
// 1. 字体语言不一致：pdf.js 先在一块 lang 为空（或取 PDF 自带语言）的隐藏画布上量出每段文字的宽度，再把透明文字横向拉伸到
//    PDF 记录的宽度；而透明文字挂在 lang="zh-CN" 的页面里，Chrome 会给通用字体换成中文字体。量和排用的不是同一种字体，
//    拉伸比例就错了，越往行尾偏得越多。解决：文字层容器使用和测量画布相同的 lang（见 pdf-reader.js）。
// 2. 行内漂移：即使整段宽度对上，替代字体每个字母的宽度和 PDF 原字体不同，一行中间仍会偏几个字母。
//    pdf.js 5 会把内嵌字体注册成 FontFace（字体名就是文本条目的 fontName），并在字体 cmap 里保留真实字符 → 字形的映射，
//    所以透明文字可以直接用原字体排版。chooseFontFamily 用抽样实测决定每种字体用内嵌字体还是通用字体。
// 3. 词间距被摊成字形拉伸：pdf.js 把一个文本条目的实际宽度和量出的宽度之比整体写进 scaleX，等于把两端对齐时
//    多出（或挤掉）的词间距摊到每个字母上。字体可信时字母本身宽度是对的，差值应该只落在空格上，否则行中间的
//    字母会偏出半个到一个字母（BERT 双栏论文 130% 下最大偏 7px）。microtype 的字体扩展又会真的把字形横向缩放
//    1%～2%，这部分来自文本矩阵（transform[0] / transform[3]），要留在 scaleX 里。fitWordSpacing 按这两部分拆开，
//    refineTextLayer 在文字层排好后改写每个片段的 --scale-x 和 word-spacing（用 em，缩放时跟着字号走）。
// 4. 选区跳动：拖选经过行间、栏间空白时，Chrome 会把选区一路扩到文字层末尾。pdf.js 官方查看器用 .endOfContent
//    占位块跟着选区移动来限制跳动，底层 TextLayer 不带这套逻辑，这里移植过来（bindSelectionStabilizer）。
// 5. 拖选经过链接：论文里引用、图表编号都是链接，链接层盖在文字层之上。拖选的终点落在链接上时，命中的是 <a>
//    而不是文字，Chrome 找不到插入点，就把选区扩到下一行甚至更远。拖选进行中给根元素加 lexiloop-text-selecting，
//    CSS 让链接暂时不接收指针，终点就落回文字层（松手后恢复，链接照常可点）。
(function (root) {
  "use strict";

  const SAMPLE_LIMIT = 48;
  // 内嵌字体的误差上限：字符间距（Tc/Tw）、水平缩放（Tz）会让宽度天然有偏差，超过这个值说明字体映射不可信
  const MAX_EMBEDDED_ERROR = 0.12;

  function isHorizontal(transform) {
    if (!Array.isArray(transform) || transform.length < 6) return false;
    return Math.abs(transform[1]) < 1e-6 && Math.abs(transform[2]) < 1e-6 && transform[0] > 0 && transform[3] > 0;
  }

  // 抽取某字体的样本：横排、至少 3 个字符、有宽度
  function sampleItems(items, fontName, limit = SAMPLE_LIMIT) {
    const samples = [];
    for (const item of items || []) {
      if (samples.length >= limit) break;
      if (!item || item.fontName !== fontName || typeof item.str !== "string") continue;
      const text = item.str;
      if (text.trim().length < 3 || !(Number(item.width) > 0) || !isHorizontal(item.transform)) continue;
      const fontSize = Math.hypot(item.transform[2], item.transform[3]);
      if (!(fontSize > 0)) continue;
      samples.push({ text, width: Number(item.width), fontSize });
    }
    return samples;
  }

  // measure(text, family) 返回 100px 字号下的宽度；结果是相对误差 Σ|量出 − 实际| / Σ实际
  function widthError(samples, family, measure) {
    let diff = 0;
    let total = 0;
    for (const sample of samples) {
      const measured = measure(sample.text, family) * sample.fontSize / 100;
      if (!(measured > 0)) return Infinity;
      diff += Math.abs(measured - sample.width);
      total += sample.width;
    }
    return total > 0 ? diff / total : Infinity;
  }

  function quoteFamily(name) {
    return `"${String(name).replace(/["\\]/g, "")}"`;
  }

  // 判定某字体的透明文字用什么字体栈：
  // - 返回 null：还没法判定（字体未加载、样本不足），调用方下次渲染再试；
  // - 返回 { family: null }：已判定内嵌字体不可信或不比通用字体准，保持 pdf.js 默认；
  // - 返回 { family: '"g_d0_f1", sans-serif' }：改用内嵌字体。
  function chooseFontFamily({ fontName, genericFamily, items, measure, loaded }) {
    if (!fontName || !loaded || typeof measure !== "function") return null;
    const samples = sampleItems(items, fontName);
    if (samples.length < 2) return null;
    const generic = genericFamily || "sans-serif";
    const embedded = `${quoteFamily(fontName)}, ${generic}`;
    const embeddedError = widthError(samples, embedded, measure);
    const genericError = widthError(samples, generic, measure);
    const useEmbedded = embeddedError <= MAX_EMBEDDED_ERROR && embeddedError < genericError;
    return { family: useEmbedded ? embedded : null, embeddedError, genericError };
  }

  // 字形自身的横向缩放：只取文本矩阵里的水平拉伸（microtype 字体扩展、Tz），旋转或倾斜的条目不处理
  function glyphScaleOf(transform) {
    if (!isHorizontal(transform)) return null;
    const ratio = transform[0] / transform[3];
    return ratio > 0.8 && ratio < 1.25 ? ratio : 1;
  }

  // naturalEm：用透明文字的字体量出的整段宽度（以字号为单位）；targetEm：PDF 记录的宽度（同单位）。
  // 返回 { scaleX, wordSpacing }（wordSpacing 以 em 计），或 null 表示保持 pdf.js 的整体拉伸。
  // 词间距压缩下限 MIN_WORD_SPACING：正常空格约 0.25em，再压就会叠字，剩下的差值仍回到 scaleX。
  const MIN_WORD_SPACING = -0.1;
  const MAX_WORD_SPACING = 2;
  function fitWordSpacing({ text, naturalEm, targetEm, glyphScale = 1 }) {
    const spaces = (String(text || "").match(/ /g) || []).length;
    if (!spaces || !(naturalEm > 0) || !(targetEm > 0)) return null;
    const scale = glyphScale > 0 ? glyphScale : 1;
    const raw = (targetEm / scale - naturalEm) / spaces;
    const wordSpacing = Math.min(MAX_WORD_SPACING, Math.max(MIN_WORD_SPACING, raw));
    const scaleX = targetEm / (naturalEm + wordSpacing * spaces);
    if (!Number.isFinite(scaleX) || scaleX <= 0) return null;
    return { scaleX, wordSpacing };
  }

  // 文字层渲染完后调用。divs 与 items 一一对应（pdf.js TextLayer.textDivs 与有 str 的文本条目）。
  // trusted(fontName) 为真时才改：透明文字用的是 PDF 内嵌字体，字母宽度可信；通用字体下字母宽度本来就不对，整体拉伸更稳。
  // measure(text, family) 返回 100px 字号下的宽度。
  function refineTextLayer({ divs, items, trusted, measure }) {
    const list = (items || []).filter((item) => item && typeof item.str === "string");
    if (!divs || divs.length !== list.length || typeof measure !== "function") return 0;
    let changed = 0;
    for (let index = 0; index < divs.length; index += 1) {
      const div = divs[index];
      const item = list[index];
      if (!div?.style || !item.str.includes(" ") || !trusted?.(item.fontName)) continue;
      const glyphScale = glyphScaleOf(item.transform);
      if (glyphScale === null) continue;
      const pdfScaleX = Number(div.style.getPropertyValue("--scale-x")) || 1;
      const family = div.style.fontFamily;
      if (!family) continue;
      const naturalEm = measure(div.textContent, family) / 100;
      const fit = fitWordSpacing({ text: div.textContent, naturalEm, targetEm: naturalEm * pdfScaleX, glyphScale });
      if (!fit) continue;
      div.style.setProperty("--scale-x", String(fit.scaleX));
      div.style.wordSpacing = `${fit.wordSpacing.toFixed(4)}em`;
      changed += 1;
    }
    return changed;
  }

  // ---- 选区稳定（移植自 pdf.js web/text_layer_builder.js 的 Chromium 分支）----
  let stabilizerBound = false;

  function endOf(layer) {
    let end = layer.__lexiloopEndOfContent;
    if (!end) {
      end = layer.ownerDocument.createElement("div");
      end.className = "endOfContent";
      layer.__lexiloopEndOfContent = end;
    }
    return end;
  }

  // 每次文字层重新渲染（replaceChildren）后调用，把占位块放回层的末尾
  function attachEndOfContent(layer) {
    if (!layer) return;
    const end = endOf(layer);
    end.style.width = "";
    end.style.height = "";
    layer.append(end);
    bindSelectionStabilizer(layer.ownerDocument);
  }

  function bindSelectionStabilizer(doc) {
    if (stabilizerBound || !doc) return;
    stabilizerBound = true;
    const win = doc.defaultView;
    const layers = () => Array.from(doc.querySelectorAll(".textLayer"));
    const reset = (layer) => {
      const end = endOf(layer);
      layer.append(end);
      end.style.width = "";
      end.style.height = "";
      layer.classList.remove("selecting");
    };
    let pointerDown = false;
    let previousRange = null;

    const endDrag = () => doc.documentElement.classList.remove("lexiloop-text-selecting");
    doc.addEventListener("mousedown", (event) => {
      const layer = event.target instanceof win.Element ? event.target.closest(".textLayer") : null;
      if (!layer) return;
      layer.classList.add("selecting");
      if (event.button === 0) doc.documentElement.classList.add("lexiloop-text-selecting");
    }, true);
    doc.addEventListener("pointerdown", () => { pointerDown = true; }, true);
    doc.addEventListener("pointerup", () => {
      pointerDown = false;
      endDrag();
      layers().forEach(reset);
    }, true);
    win.addEventListener("blur", () => {
      pointerDown = false;
      endDrag();
      layers().forEach(reset);
    });
    doc.addEventListener("keyup", () => {
      if (!pointerDown) layers().forEach(reset);
    });

    doc.addEventListener("selectionchange", () => {
      const selection = doc.getSelection();
      const all = layers();
      if (!selection || selection.rangeCount === 0) {
        all.forEach(reset);
        previousRange = null;
        return;
      }
      const range = selection.getRangeAt(0);
      const active = new Set(all.filter((layer) => range.intersectsNode(layer)));
      all.forEach((layer) => {
        if (active.has(layer)) layer.classList.add("selecting");
        else reset(layer);
      });
      if (!active.size) {
        previousRange = range.cloneRange();
        return;
      }
      // 鼠标移到空白处（落在 .endOfContent 上）时，选区会扩到当前选区和占位块之间的全部文字。
      // 把占位块挪到正在变化的那一端旁边，跳动就最多覆盖一个文本片段。
      const modifyStart = Boolean(previousRange) && (
        range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0
      );
      let anchor = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (!modifyStart && range.endOffset === 0) {
        let guard = 0;
        do {
          while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
          anchor = anchor?.previousSibling || null;
          guard += 1;
        } while (anchor && !anchor.childNodes.length && guard < 500);
      }
      const layer = anchor?.parentElement?.closest(".textLayer");
      if (layer && active.has(layer) && anchor.parentElement) {
        const end = endOf(layer);
        if (end !== anchor) {
          end.style.width = layer.style.width;
          end.style.height = layer.style.height;
          anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
        }
      }
      previousRange = range.cloneRange();
    });
  }

  const api = { chooseFontFamily, sampleItems, widthError, attachEndOfContent, fitWordSpacing, refineTextLayer, glyphScaleOf, MAX_EMBEDDED_ERROR, MIN_WORD_SPACING };
  root.LexiLoopTextLayer = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
