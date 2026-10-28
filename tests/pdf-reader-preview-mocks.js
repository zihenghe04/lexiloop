
// 自动化验收：把脚本错误和未处理的 Promise 拒绝累积到 <html data-preview-errors>，读 DOM 即可定位卡点
window.__previewErrors = [];
function __recordPreviewError(text) {
  window.__previewErrors.push(text);
  document.documentElement.dataset.previewErrors = window.__previewErrors.join(" | ").slice(0, 1200);
}
window.addEventListener("error", (event) => {
  __recordPreviewError(`${event.message} @ ${String(event.filename || "").split("/").pop()}:${event.lineno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  __recordPreviewError(String(reason && reason.stack || reason).slice(0, 300));
});
const storageListeners = [];
const runtimeListeners = [];
window.__lexiloopPreview = {
  downloads: [],
  printCalls: 0,
  annotations: {},
  translatedBatches: [],
  translatedPages: [],
  aiRequests: [],
  aiHistory: {},
  aiPanelWidth: 356,
  pdfLibrary: [],
  translateCalls: 0,
  words: []
};
// ?textLayerDebug：把透明文字层显示成半透明红字，叠在 PDF 画面上检查划词对齐（重合即对齐，出现重影即错位）
if (new URL(location.href).searchParams.has("textLayerDebug")) {
  const style = document.createElement("style");
  style.textContent = ".textLayer span { color: rgba(230, 20, 20, .6) !important; } .textLayer ::selection { background: rgba(40, 120, 255, .25) !important; }";
  document.documentElement.appendChild(style);
}
// ?pinchSim：加一个测试按钮，点击后在页面区中心连续发出 Ctrl + 滚轮事件（Chrome 报告触控板捏合的格式），
// 记录指针下那一点缩放前后在页面上的相对位置（应保持不动），结果放在 window.__pinch
if (new URL(location.href).searchParams.has("pinchSim")) {
  window.addEventListener("DOMContentLoaded", () => {
    const button = document.createElement("button");
    button.id = "__pinchSim";
    button.textContent = "模拟捏合";
    button.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;font:12px sans-serif";
    document.body.appendChild(button);
    button.addEventListener("click", async () => {
      const stage = document.getElementById("pageStage");
      const rect = stage.getBoundingClientRect();
      const x = rect.left + rect.width * 0.55;
      const y = rect.top + rect.height * 0.45;
      const where = () => {
        const page = document.elementFromPoint(x, y)?.closest(".pdf-page");
        const box = page?.getBoundingClientRect();
        return page ? { page: page.dataset.pageNumber, fx: +((x - box.left) / box.width).toFixed(4), fy: +((y - box.top) / box.height).toFixed(4), width: Math.round(box.width) } : null;
      };
      const direction = Number(new URL(location.href).searchParams.get("pinchSim")) || -1;
      const result = { before: where(), steps: [], defaultPrevented: 0 };
      for (let index = 0; index < 14; index += 1) {
        const event = new WheelEvent("wheel", { deltaY: 6 * direction, deltaMode: 0, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true });
        document.elementFromPoint(x, y).dispatchEvent(event);
        if (event.defaultPrevented) result.defaultPrevented += 1;
        await new Promise((resolve) => setTimeout(resolve, 16));
        if (index % 4 === 3) result.steps.push({ ...where(), zoomLabel: document.getElementById("resetZoom").textContent });
      }
      result.duringGestureCanvasWidth = pageViews.get(Number(result.before?.page))?.canvas.width;
      result.scrollLeftTimeline = [];
      const started = performance.now();
      const stageForLog = document.getElementById("pageStage");
      stageForLog.addEventListener("scroll", () => result.scrollLeftTimeline.push([Math.round(performance.now() - started), Math.round(stageForLog.scrollLeft), { scrollWidth: stageForLog.scrollWidth, clientWidth: stageForLog.clientWidth, active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName, rendered: [...pageViews.values()].filter((v) => v.renderedScale === scale).map((v) => v.pageNumber), pending: [...pageViews.values()].filter((v) => v.renderingPromise).map((v) => v.pageNumber) }]), { passive: true });
      new ResizeObserver(() => result.scrollLeftTimeline.push([Math.round(performance.now() - started), "resize", stageForLog.clientWidth, stageForLog.clientHeight])).observe(stageForLog);
      new MutationObserver((records) => records.forEach((record) => { if (record.target.closest?.(".pdf-page") && [...record.addedNodes].some((n) => n.tagName === "CANVAS")) result.scrollLeftTimeline.push([Math.round(performance.now() - started), "canvas swap p" + record.target.dataset.pageNumber, Math.round(stageForLog.scrollLeft)]); })).observe(document.getElementById("pagesContainer"), { childList: true, subtree: true });
      result.scrollLeftTimeline.push([0, Math.round(stageForLog.scrollLeft), "end of gesture"]);
      const originalScrollTo = stageForLog.scrollTo.bind(stageForLog);
      stageForLog.scrollTo = (...args) => { result.scrollLeftTimeline.push([Math.round(performance.now() - started), "scrollTo " + JSON.stringify(args[0]), new Error().stack.split("\n").slice(2, 6).map((line) => line.trim().replace(/https?:\/\/[^ )]+\//g, "")).join(" < ")]); return originalScrollTo(...args); };
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
      Object.defineProperty(stageForLog, "scrollLeft", { configurable: true, get() { return descriptor.get.call(this); }, set(value) { result.scrollLeftTimeline.push([Math.round(performance.now() - started), "set scrollLeft " + value, new Error().stack.split("\n").slice(2, 6).map((line) => line.trim().replace(/https?:\/\/[^ )]+\//g, "")).join(" < ")]); descriptor.set.call(this, value); } });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const view = pageViews.get(Number(result.before?.page));
      result.after = { ...where(), zoomLabel: document.getElementById("resetZoom").textContent, scale, renderedScale: view?.renderedScale, canvasWidth: view?.canvas.width };
      window.__pinch = result;
    });
  });
}
// ?vocabFixture：预置几个词库词（以前在别处查过），用来检查正文标记、悬停释义与「生词」面板
if (new URL(location.href).searchParams.has("vocabFixture")) {
  const at = "2026-10-20T08:00:00.000Z";
  const fixture = (id, original, translated, extra = {}) => ({
    id, original, translated, phonetics: {}, meanings: [], translationCount: extra.count || 1, createdAt: at, updatedAt: at,
    lookups: [{ id: `${id}-l`, at, source: extra.source || { title: "某网页", url: "https://example.com" }, context: extra.context || "", trigger: "selection" }],
    review: { stage: extra.stage || 0, dueAt: "2026-10-22T00:00:00.000Z" }
  });
  window.__lexiloopPreview.words = [
    fixture("w1", "embodiment", "具身；体现", { count: 3 }),
    fixture("w2", "interpreter", "解释器", { stage: 4 }),
    fixture("w3", "deterministically", "确定性地"),
    fixture("w4", "fine-grained", "细粒度的"),
    fixture("w5", "teleoperation", "遥操作")
  ];
}
function notifyWordsChanged() {
  const newValue = structuredClone(window.__lexiloopPreview.words);
  storageListeners.forEach((listener) => listener({ lexiloopWords: { newValue } }, "local"));
}
document.addEventListener("lexiloop:pdf-translate-selection", () => {
  const count = Number(document.documentElement.dataset.previewTranslateEvents || 0) + 1;
  document.documentElement.dataset.previewTranslateEvents = String(count);
});
document.addEventListener("lexiloop:pdf-hide-translation-ui", () => {
  const count = Number(document.documentElement.dataset.previewHideTranslationEvents || 0) + 1;
  document.documentElement.dataset.previewHideTranslationEvents = String(count);
});
new MutationObserver((records) => {
  records.forEach((record) => {
    [...record.addedNodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(".lexiloop-card")) {
        const count = Number(document.documentElement.dataset.previewCardsAdded || 0) + 1;
        document.documentElement.dataset.previewCardsAdded = String(count);
      }
    });
    [...record.removedNodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(".lexiloop-card")) {
        const count = Number(document.documentElement.dataset.previewCardsRemoved || 0) + 1;
        document.documentElement.dataset.previewCardsRemoved = String(count);
      }
    });
  });
}).observe(document.documentElement, { childList: true });

const __previewChrome = {
  downloads: {
    async download(options) {
      window.__lexiloopPreview.downloads.push(options);
      document.documentElement.dataset.previewDownloads = String(window.__lexiloopPreview.downloads.length);
      return window.__lexiloopPreview.downloads.length;
    }
  },
  storage: {
    local: {
      async get() {
        const documentKey = document.documentElement.dataset.lexiloopDocumentKey;
        const previewParams = new URL(location.href).searchParams;
        if (documentKey && previewParams.has("aiNodeFixture") && !window.__lexiloopPreview.aiHistory[documentKey]) {
          const now = Date.now();
          window.__lexiloopPreview.aiHistory[documentKey] = {
            title: "LexiLoop selectable text layer verification",
            sourceUrl: "preview://selection-test",
            updatedAt: now,
            activeConversationId: "preview-node-chat",
            conversations: [{
              id: "preview-node-chat",
              title: "理解 PDF 文本选择",
              createdAt: now - 10_000,
              updatedAt: now,
              messages: [
                { role: "user", content: "为什么 PDF 文本选择会出现错位？", meta: "第 1 页", createdAt: now - 9_000 },
                { role: "assistant", content: "PDF 页面由画布和透明文本层叠加。字体度量或字符映射不一致时，鼠标位置就可能对应到相邻字符。", meta: "PDF AI · p.1", createdAt: now - 8_000 },
                { role: "user", content: "怎样验证修复后的选区边界？", meta: "第 1 页", createdAt: now - 7_000 },
                { role: "assistant", content: "可以分别测试完整单词、引号中的单词、跨行短语，以及缩放后的选择结果。", meta: "PDF AI · p.1", createdAt: now - 6_000 }
              ]
            }]
          };
        }
        if (documentKey && previewParams.has("annotationFixture")) {
          const fixtureStyle = ["underline", "strikeout"].includes(previewParams.get("annotationStyle"))
            ? previewParams.get("annotationStyle")
            : "highlight";
          window.__lexiloopPreview.annotations[documentKey] ||= [{
            id: "preview-note-1",
            pageNumber: 1,
            text: "Resilient reading tools preserve context",
            note: previewParams.has("annotationWithoutNote") ? "" : "这是需要复习的核心句子",
            color: "green",
            style: fixtureStyle,
            rects: [{ x: 0.107, y: 0.205, width: 0.51, height: 0.018 }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z"
          }];
        }
        return {
          lexiloopSettings: { selectionBubbleEnabled: true, enhancedPdfEnabled: true },
          lexiloopPdfAnnotations: structuredClone(window.__lexiloopPreview.annotations),
          lexiloopPdfAiHistory: structuredClone(window.__lexiloopPreview.aiHistory),
          lexiloopPdfAiPanelWidth: window.__lexiloopPreview.aiPanelWidth,
          lexiloopPdfLibrary: structuredClone(window.__lexiloopPreview.pdfLibrary),
          lexiloopWords: structuredClone(window.__lexiloopPreview.words)
        };
      },
      async set(value) {
        if (value.lexiloopPdfAnnotations) {
          window.__lexiloopPreview.annotations = structuredClone(value.lexiloopPdfAnnotations);
        }
        if (value.lexiloopPdfAiHistory) {
          window.__lexiloopPreview.aiHistory = structuredClone(value.lexiloopPdfAiHistory);
        }
        if (value.lexiloopPdfAiPanelWidth) {
          window.__lexiloopPreview.aiPanelWidth = Number(value.lexiloopPdfAiPanelWidth);
        }
        if (value.lexiloopPdfLibrary) {
          window.__lexiloopPreview.pdfLibrary = structuredClone(value.lexiloopPdfLibrary);
        }
      }
    },
    onChanged: { addListener(listener) { storageListeners.push(listener); } }
  },
  runtime: {
    getURL(path) { return new URL(`../${path}`, location.href).href; },
    onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
    async sendMessage(message) {
      if (message.type === "PDF_LIBRARY_GET") {
        return { ok: true, papers: structuredClone(window.__lexiloopPreview.pdfLibrary) };
      }
      if (message.type === "PDF_LIBRARY_UPSERT") {
        const result = LexiLoopPdfLibrary.upsertPaper(window.__lexiloopPreview.pdfLibrary, message.paper);
        window.__lexiloopPreview.pdfLibrary = result.papers;
        return { ok: true, papers: structuredClone(result.papers), paper: structuredClone(result.paper) };
      }
      if (message.type === "PDF_LIBRARY_PATCH") {
        const result = LexiLoopPdfLibrary.patchPaper(window.__lexiloopPreview.pdfLibrary, message.id, message.changes);
        window.__lexiloopPreview.pdfLibrary = result.papers;
        return { ok: true, papers: structuredClone(result.papers), paper: structuredClone(result.paper) };
      }
      if (message.type === "TRANSLATE_PDF_BATCH") {
        window.__lexiloopPreview.translatedBatches.push([...message.texts]);
        window.__lexiloopPreview.translatedPages.push(message.pageNumber);
        document.documentElement.dataset.previewTranslatedPages = JSON.stringify(window.__lexiloopPreview.translatedPages);
        const dictionary = {
          "Selection works everywhere": "在任何地方都能选择文字",
          "LexiLoop selectable text layer verification": "LexiLoop 可选文字层验证",
          "Regular PDF text": "常规 PDF 文字",
          "Resilient reading tools preserve context while people explore unfamiliar words.": "阅读工具在人们探索陌生词汇时保留上下文。",
          "The selectable layer should align exactly with the visible canvas text.": "可选文字层应与可见页面文字精确对齐。",
          "Shortcut path": "快捷键路径",
          "Navigation and zoom": "导航与缩放",
          "Page controls": "页面控制",
          "Pronunciation": "发音"
        };
        // ?mockzh=google：调用真实的 Google 翻译（与扩展的免费翻译通道相同），用于检查真实译文里的占位符、链接
        if (new URL(location.href).searchParams.get("mockzh") === "google") {
          const translations = await Promise.all(message.texts.map(async (text) => {
            try {
              return { ok: true, source: text, translated: await previewGoogleTranslate(text) };
            } catch (error) {
              return { ok: false, source: text, translated: text, error: error.message };
            }
          }));
          return { ok: true, translations };
        }
        return {
          ok: true,
          translations: message.texts.map((text) => ({ ok: true, source: text, translated: dictionary[text] || mockTranslation(text) }))
        };
      }
      if (message.type === "TRANSLATE") {
        window.__lexiloopPreview.translateCalls += 1;
        window.__lexiloopPreview.lastTranslate = structuredClone(message);
        document.documentElement.dataset.previewTranslateCalls = String(window.__lexiloopPreview.translateCalls);
        // 像后台一样把词记进词库（带上来源与语境），再通知各页面
        const term = String(message.text || "").trim();
        if (term && term.split(/\s+/).length <= 6) {
          const words = window.__lexiloopPreview.words;
          const now = new Date().toISOString();
          const lookup = { id: `l-${Date.now()}`, at: now, source: message.source || {}, context: message.context || "", trigger: message.trigger || "manual" };
          const existing = words.find((word) => word.original.toLowerCase() === term.toLowerCase());
          if (existing) {
            existing.lookups.unshift(lookup);
            existing.translationCount += 1;
          } else {
            words.unshift({ id: `w-${Date.now()}`, original: term, translated: `（模拟）${term} 的释义`, phonetics: {}, meanings: [], translationCount: 1, createdAt: now, updatedAt: now, lookups: [lookup], review: { stage: 0, dueAt: now } });
          }
          setTimeout(notifyWordsChanged, 0);
        }
        return {
          ok: true,
          result: {
            original: message.text,
            translated: "有韧性的；能迅速恢复的",
            detectedLanguage: "en",
            targetLanguage: "zh-CN",
            phonetics: { uk: "rɪˈzɪliənt", us: "rɪˈzɪliənt" },
            meanings: [{ partOfSpeech: "adj.", definitions: ["有韧性的；有复原力的"] }],
            service: "有道词典",
            translationCount: 2
          }
        };
      }
      if (message.type === "ASK_PDF_AI") {
        window.__lexiloopPreview.aiRequests.push(structuredClone(message));
        document.documentElement.dataset.previewAiRequests = String(window.__lexiloopPreview.aiRequests.length);
        return {
          ok: true,
          answer: message.imageDataUrl
            ? "### 截图解释\n\n截图中的乘积是 \\(\\prod_{n=1}^N x_n\\)，它表示从 1 到 N 的连续相乘。"
            : "### 核心内容\n\n- 可选择文本\n- 页面导航\n- 阅读上下文\n\n关系式：\\[y = \\sum_{n=1}^{N} x_n\\]",
          service: "OpenAI 兼容 · preview-model",
          model: "preview-model"
        };
      }
      if (message.type === "OPEN_SETTINGS") return { ok: true };
      return { ok: true };
    }
  }
};
// Chrome 内置的 window.chrome 不能直接赋值（原生对象会吞掉赋值），用 defineProperty 挂预览桩
try {
  Object.defineProperty(window, "chrome", { value: __previewChrome, writable: true, configurable: true });
} catch (error) {
  window.chrome = __previewChrome;
}


window.print = () => {
  window.__lexiloopPreview.printCalls += 1;
  document.documentElement.dataset.previewPrintCalls = String(window.__lexiloopPreview.printCalls);
  window.dispatchEvent(new Event("afterprint"));
};

window.addEventListener("load", () => {
  const previewParams = new URL(location.href).searchParams;
  document.addEventListener("lexiloop-preview-add-annotation", async (event) => {
    const { selection, color = "yellow", note = "", style = "highlight" } = event.detail || {};
    addAnnotationFromSelection(selection, color, note, style);
    await persistAnnotations();
    renderAllAnnotations();
    document.documentElement.dataset.previewAnnotationSaved = String(Date.now());
  });
  document.addEventListener("lexiloop-preview-select-text", () => selectPreviewPdfText());
  document.addEventListener("lexiloop-preview-translate-page", () => triggerPreviewPageTranslation());
  if (previewParams.has("pageTranslation") || previewParams.has("readingMode")) triggerPreviewPageTranslation();
  if (previewParams.has("aiPanel")) triggerPreviewAiPanel();
  if (previewParams.has("selectionFixture")) {
    const reselectButton = document.createElement("button");
    reselectButton.type = "button";
    reselectButton.setAttribute("aria-label", "重新选择测试文本");
    reselectButton.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:999999;width:20px;height:20px;padding:0;border:0;opacity:0";
    reselectButton.addEventListener("click", () => selectPreviewPdfText());
    document.body.appendChild(reselectButton);
    selectPreviewPdfText();
  }
});

// 打开对照阅读：?readingMode=parallel|translation（旧参数 pageTranslation 等同 parallel）
function triggerPreviewPageTranslation(attempt = 0) {
  const mode = new URL(location.href).searchParams.get("readingMode") || "parallel";
  const button = document.querySelector(`[data-reading-mode-option="${mode}"]`);
  if (!button || button.closest(".translation-actions")?.hidden || !document.querySelector(".pdf-spread")) {
    if (attempt < 80) setTimeout(() => triggerPreviewPageTranslation(attempt + 1), 100);
    return;
  }
  button.click();
  document.documentElement.dataset.previewPageTranslationTriggered = "true";
}

function triggerPreviewAiPanel(attempt = 0) {
  const button = document.getElementById("aiPanelButton");
  if (!button || button.hidden || button.disabled) {
    if (attempt < 80) setTimeout(() => triggerPreviewAiPanel(attempt + 1), 100);
    return;
  }
  button.click();
  document.documentElement.dataset.previewAiPanelTriggered = "true";
}

function selectPreviewPdfText(attempt = 0) {
  const textSpan = [...document.querySelectorAll(".original-page .textLayer span")]
    .find((span) => span.textContent.includes("Resilient reading tools"));
  if (!textSpan) {
    if (attempt < 40) setTimeout(() => selectPreviewPdfText(attempt + 1), 100);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(textSpan);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const rect = range.getBoundingClientRect();
  textSpan.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true,
    clientX: rect.right - 2,
    clientY: rect.top + rect.height / 2
  }));
  document.documentElement.dataset.previewSelectionReady = String(Date.now());
}

// 预览自动化：?find=关键词&findSteps=N —— 文档加载后打开查找、输入关键词、按「下一个」N 次。
(() => {
  const params = new URLSearchParams(location.search);
  const query = params.get("find");
  if (!query) return;
  const steps = Math.max(0, Number(params.get("findSteps")) || 0);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__findRun = { done: false, log: [] };
  (async () => {
    while (!document.body?.classList.contains("has-document")) await wait(200);
    await wait(800);
    document.getElementById("findButton").click();
    const input = document.getElementById("findInput");
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(2500);
    window.__findRun.log.push(document.getElementById("findCount").textContent);
    for (let i = 0; i < steps; i += 1) {
      document.getElementById("findNext").click();
      await wait(1500);
      window.__findRun.log.push(document.getElementById("findCount").textContent);
    }
    window.__findRun.done = true;
  })();
})();

// 排版调试：?dump=页数 —— 导出前 N 页的文字条目（阅读器坐标系）与当前排版结果到 window.__dump。
(() => {
  const params = new URLSearchParams(location.search);
  const pages = Number(params.get("dump")) || 0;
  if (!pages) return;
  (async () => {
    while (!document.body?.classList.contains("has-document")) await new Promise((r) => setTimeout(r, 200));
    const dump = [];
    for (let n = 1; n <= Math.min(pages, pdfDocument.numPages); n += 1) {
      const view = pageViews.get(n);
      const content = await view.page.getTextContent({ includeMarkedContent: true });
      const viewport = view.baseViewport;
      const items = content.items.filter((i) => typeof i.str === "string" && i.str.trim() && Array.isArray(i.transform)).map((item) => {
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.max(6, Math.hypot(t[2], t[3]));
        return { text: item.str.trim(), x: t[4], top: t[5] - height, width: Math.max(1, Number(item.width || 0)), height };
      });
      dump.push({ page: n, width: viewport.width, height: viewport.height, items, layout: extractTranslationLines(content, viewport) });
    }
    window.__dump = dump;
  })();
})();

// ?mockzh=tag：在模拟译文前标出原文开头几个词，用来核对段落顺序与对应关系。
// 像真实翻译服务一样保留占位符 {v1}{v2}…，并放在与原文相对位置一致的地方。
function mockTranslation(text) {
  const mode = new URL(location.href).searchParams.get("mockzh");
  const value = String(text);
  const placeholders = [...value.matchAll(/\{v\d+\}/g)].map((match) => ({ token: match[0], ratio: match.index / Math.max(1, value.length) }));
  const plain = value.replace(/\{v\d+\}/g, "").replace(/\s+/g, " ").trim();
  let body;
  if (mode === "tag") body = `〔${plain.split(/\s+/).slice(0, 4).join(" ")}〕${mockChinese(plain)}`;
  else if (mode !== null) body = mockChinese(plain);
  else return `译文：${value}`;
  let output = body;
  // 从后往前插，前面的位置不受影响
  [...placeholders].reverse().forEach(({ token, ratio }) => {
    const at = Math.round(ratio * output.length);
    output = `${output.slice(0, at)}${token}${output.slice(at)}`;
  });
  return output;
}

async function previewGoogleTranslate(text) {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "zh-CN", dt: "t", q: text });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
  if (!response.ok) throw new Error(`Google 翻译 HTTP ${response.status}`);
  const data = await response.json();
  const translated = (data?.[0] || []).map((item) => item?.[0] || "").join("");
  if (!translated) throw new Error("Google 翻译未返回译文");
  return translated;
}

// ?mockzh=1：按真实中英长度比（约 0.55 个汉字/英文字符）生成中文，用于检查排版是否溢出、错位。
function mockChinese(text) {
  const sample = "深度残差学习框架通过引入恒等映射来缓解网络退化问题，使得更深的模型能够被有效优化并在图像识别任务上取得更高的准确率。我们在多个数据集上进行了系统的实验与分析。";
  const length = Math.max(2, Math.round(String(text).length * 0.55));
  let output = "";
  while (output.length < length) output += sample;
  return output.slice(0, length);
}

// ?openPdf=路径：页面就绪后自动打开这份 PDF（相对本地预览服务的路径），用于自动化验收与截图
{
  const openTarget = new URL(location.href).searchParams.get("openPdf");
  if (openTarget) {
    const start = () => setTimeout(() => {
      const target = decodeURIComponent(openTarget);
      if (typeof loadPdf === "function") loadPdf(target, { title: target.split("/").pop(), url: target }).catch((error) => {
        document.documentElement.dataset.previewOpenError = String(error && error.message || error);
      });
    }, 400);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
  }
}
