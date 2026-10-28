const PDFJS_PATH = "vendor/pdfjs/pdf.min.mjs";
const PDF_WORKER_PATH = "vendor/pdfjs/pdf.worker.min.mjs";
const PAGE_RENDER_MARGIN = 900;
const THUMBNAIL_WIDTH = 132;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
// 同时保留画面的页数上限：远处页面释放画布，避免长文档翻完后占用几百 MB 内存
const MAX_RENDERED_PAGES = 12;
// 单页画布像素上限：放大到 400% 时按此降低像素密度，避免一页占用上百 MB
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const TRANSLATION_BATCH_SIZE = 80;
const ANNOTATIONS_KEY = "lexiloopPdfAnnotations";

let pdfjs;
let pdfDocument = null;
let loadingTask = null;
let pageObserver = null;
let thumbnailObserver = null;
let currentPage = 1;
let scale = 1;
// 触控板捏合进行中的目标比例（null 表示没有在捏合）
let pinchScale = null;
let pinchCommitTimer = 0;
let translationPinchDelta = 0;
// 每种 PDF 字体的透明文字字体栈（内嵌字体或 pdf.js 默认），按文档缓存
const textLayerFontChoices = new Map();
// 用 PDF 内嵌字体量文字宽度（文字层字体选择、词库词定位共用）
const vocabMeasureContext = document.createElement("canvas").getContext("2d");
const loadedPdfFonts = new Map();
let sourceUrl = "";
let sourceTitle = "";
let currentPdfFileSize = 0;
let renderVersion = 0;
let scrollFrame = 0;
let toastTimer;
let currentBlobUrl = "";
let printing = false;
let translationMode = false;
let translationRun = 0;
// 原文/译文对照阅读（参考 Reader）：source 仅原文 | parallel 原文译文 | translation 仅译文
let readingMode = "source";
let paneLeader = "source"; // 最近收到用户滚动输入的一栏；只有它的滚动会带动另一栏
let translationScrollFrame = 0;
let paneHoverFrame = 0;
let translationQueueRun = -1;
let translationPaused = false;
let translationOnlyPage = 0;
let aiAbortController = null; // AI 请求的中断句柄：打开/关闭文档的清理路径会先读它，必须定义在顶部

// ---- 阅读器状态与内部常量 ----
// 全部声明放在 initialize() 调用之前：入口与打开/关闭文档的清理路径会读它们，
// 声明如果散落在函数之间，就会抛 "Cannot access 'x' before initialization"。
const textLayerMeasureCanvases = new Map(); // 与 pdf.js 测量画布一致：lang 相同，否则 Chrome 给通用字体换成别的语言字体
const scrollAnimations = new WeakMap(); // 程序滚动动画；用户在动画中途滚动、点击时立即停下
const FIND_HIGHLIGHT = "lexiloop-find";
const FIND_CURRENT_HIGHLIGHT = "lexiloop-find-current";
const FIGURE_DETECT_SCALE = 1;
const FIGURE_CROP_SCALE = 3;
let pinchFrame = 0;
let pinchPointer = null;
let pinchGesture = null;
let paneSplit = 50;
let paneSwapped = false;
let paneDividerDrag = null;
let translationFontSize = 16;
let linkedBlockKey = "";
let sourceClickStart = null; // 原文点击起点：用来区分「点击定位译文」和「拖选文字」
let translationFocusLockUntil = 0; // 原文点击定位译文期间，暂停「原文阅读线 → 译文」的反向同步
let translationQueuePriority = 0;
let pagePointerX = null;
let sourceLinkBoxes = [];
let linkReturnState = null;
let linkPreviewTimer = 0;
let linkPreviewToken = 0;
let linkPreviewAnchor = null;
let linkPreviewDest = null;
const figureObjectUrls = new Set();
const READING_LAYOUT_KEY = "lexiloopReaderPaneLayout";
const READING_LINE = 0.38; // 两栏对齐的基准线：视口高度 38% 处
let documentGeneration = 0;
let documentKey = "";
let pdfLibraryPaperId = "";
let currentLibraryPaper = null;
let pdfEmbeddedMetadata = {};
let libraryProgressTimer = null;
let indexBuildPromise = null;
let indexBuildDocumentGeneration = 0;
let annotations = [];
let pendingAnnotationSelection = null;
let editingAnnotationId = "";
let aiContextPages = [];
let aiContextPromise = null;
let aiConversation = [];
let aiConversations = [];
let activeAiConversationId = "";
let aiRequestPending = false;
let aiHistoryWrite = Promise.resolve();
let aiPanelResize = null;
let preferredAiPanelWidth = LexiLoopPdfAiPanel.DEFAULT_WIDTH;
let aiAutoFollow = true;
let aiScrollStateFrame = 0;
let pdfCaptureMode = false;
let annotationColorFilter = "all";
let zoomFitMode = false;
// 文档内查找状态（声明在顶部，避免初始化顺序问题）
const findState = { pendingReveal: false, pattern: null, pageCounts: new Map(), total: 0, index: -1, token: 0, paintFrame: 0, inputTimer: 0, caseSensitive: false };
let refitTimer = 0;
const READER_THEME_KEY = "lexiloopReaderTheme";
const READER_THEMES = ["light", "sepia", "dark"];
const READER_THEME_LABELS = { light: "浅色", sepia: "纸张", dark: "深色" };
let pdfCaptureDrag = null;
// PDF 阅读 × 词库
const WORDS_STORAGE_KEY = "lexiloopWords";
const VOCAB_MARKS_KEY = "lexiloopReaderVocabMarks";
let vocabWords = [];
let vocabMatcher = null;
let vocabVersion = 0;
let vocabMarksEnabled = (() => {
  try { return localStorage.getItem("lexiloopReaderVocabMarks") !== "off"; } catch { return true; }
})();
let vocabHoverFrame = 0;
let vocabTooltipTimer = 0;
let vocabTooltipKey = "";
let vocabAnalysis = null;
let vocabAnalysisPromise = null;
const pageViews = new Map();

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);

elements.openFileButton.addEventListener("click", chooseFile);
elements.emptyOpenButton.addEventListener("click", chooseFile);
elements.errorOpenButton.addEventListener("click", chooseFile);
elements.fileInput.addEventListener("change", handleFile);
elements.urlForm.addEventListener("submit", handleUrl);
elements.previousPage.addEventListener("click", () => scrollToPage(currentPage - 1));
elements.nextPage.addEventListener("click", () => scrollToPage(currentPage + 1));
elements.pageNumber.addEventListener("change", () => scrollToPage(Number(elements.pageNumber.value)));
elements.zoomOut.addEventListener("click", () => (readingMode === "translation" ? changeTranslationFontSize(-1) : changeZoom(-0.15)));
elements.zoomIn.addEventListener("click", () => (readingMode === "translation" ? changeTranslationFontSize(1) : changeZoom(0.15)));
elements.resetZoom.addEventListener("click", () => {
  if (readingMode === "translation") {
    changeTranslationFontSize(0);
    return;
  }
  zoomFitMode = !zoomFitMode;
  setZoom(zoomFitMode ? autoFitScale() : 1);
});
new ResizeObserver(() => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    if (!zoomFitMode || !pdfDocument || elements.documentShell.hidden) return;
    const next = autoFitScale();
    if (Math.abs(next - scale) >= 0.05) setZoom(next);
  }, 140);
}).observe(elements.pageStage);
window.addEventListener("wheel", handleZoomWheel, { passive: false });
elements.sidebarToggle.addEventListener("click", toggleSidebar);
elements.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
elements.downloadButton.addEventListener("click", downloadPdf);
elements.printButton.addEventListener("click", printPdf);
elements.addToLibraryButton.addEventListener("click", addCurrentPdfToLibrary);
elements.indexDocumentButton.addEventListener("click", () => ensureDocumentIndexed(true));
elements.captureAiButton.addEventListener("click", togglePdfCaptureMode);
elements.aiPanelButton.addEventListener("click", () => setAiPanelOpen(!document.body.classList.contains("ai-panel-open")));
elements.closeAiPanelButton.addEventListener("click", () => setAiPanelOpen(false));
elements.aiPanelBackdrop.addEventListener("click", () => setAiPanelOpen(false));
elements.clearAiChatButton.addEventListener("click", clearAiConversation);
elements.newAiChatButton.addEventListener("click", createAiConversation);
elements.aiConversationMenuButton.addEventListener("click", () => {
  setAiConversationMenuOpen(elements.aiConversationMenu.hidden);
});
elements.pdfAiSettingsButton.addEventListener("click", openPdfAiSettings);
elements.aiPanelResizeHandle.addEventListener("pointerdown", startAiPanelResize);
elements.aiPanelResizeHandle.addEventListener("pointermove", moveAiPanelResize);
elements.aiPanelResizeHandle.addEventListener("pointerup", finishAiPanelResize);
elements.aiPanelResizeHandle.addEventListener("pointercancel", finishAiPanelResize);
elements.aiPanelResizeHandle.addEventListener("dblclick", resetAiPanelWidth);
elements.aiPanelResizeHandle.addEventListener("keydown", handleAiPanelResizeKey);
elements.aiQuestionForm.addEventListener("submit", submitAiQuestion);
elements.aiMessages.addEventListener("scroll", handleAiMessagesScroll, { passive: true });
elements.aiQuestionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    elements.aiQuestionForm.requestSubmit();
  }
});
document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
  button.addEventListener("click", () => askPdfAi(button.dataset.aiPrompt));
});
elements.pageTranslationButton.addEventListener("click", toggleCurrentPageTranslation);
document.querySelectorAll("[data-reading-mode-option]").forEach((button) => {
  button.addEventListener("click", () => setReadingMode(button.dataset.readingModeOption));
});
elements.readingModeSwitch.addEventListener("keydown", handleReadingModeKey);
elements.translationPauseButton?.addEventListener("click", toggleTranslationPause);
elements.translationPageButton?.addEventListener("click", translateOnlyCurrentPage);
elements.translationScroll.addEventListener("scroll", handleTranslationScroll, { passive: true });
["wheel", "touchstart", "pointerdown", "keydown"].forEach((type) => {
  elements.pageStage.addEventListener(type, () => { paneLeader = "source"; }, { passive: true, capture: true });
  elements.translationScroll.addEventListener(type, () => { paneLeader = "translation"; }, { passive: true, capture: true });
});
elements.pageStage.addEventListener("mousemove", handleSourcePointerMove, { passive: true });
elements.pageStage.addEventListener("pointerdown", handleSourceClickStart);
elements.pageStage.addEventListener("click", handleSourceClick);
elements.pageStage.addEventListener("mouseleave", () => { pagePointerX = null; clearLinkedBlock(); });
elements.translationDoc.addEventListener("mousemove", handleTranslationPointerMove, { passive: true });
elements.translationPane.addEventListener("mouseleave", () => { clearLinkedBlock(); hideBlockTools(); });
elements.translationDoc.addEventListener("click", handleTranslationClick);
elements.tpBlockTools.addEventListener("click", handleBlockToolClick);
elements.paneDivider.addEventListener("pointerdown", startPaneResize);
elements.paneDivider.addEventListener("pointermove", movePaneResize);
elements.paneDivider.addEventListener("pointerup", finishPaneResize);
elements.paneDivider.addEventListener("pointercancel", finishPaneResize);
elements.paneDivider.addEventListener("dblclick", (event) => {
  if (event.target.closest(".pane-swap")) return;
  paneSplit = 50;
  applyPaneLayout();
  savePaneLayout();
});
elements.paneDivider.addEventListener("keydown", handlePaneDividerKey);
elements.paneSwapButton.addEventListener("click", swapPanes);
elements.pagesContainer.addEventListener("mousemove", handleVocabHover, { passive: true });
elements.pagesContainer.addEventListener("mouseleave", hideVocabTooltip);
elements.vocabMarksToggle.checked = vocabMarksEnabled;
elements.vocabMarksToggle.addEventListener("change", () => setVocabMarksEnabled(elements.vocabMarksToggle.checked));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[WORDS_STORAGE_KEY]) setVocabWords(changes[WORDS_STORAGE_KEY].newValue);
});
chrome.runtime.onMessage.addListener(handleReaderJumpMessage);
elements.pagesContainer.addEventListener("click", handlePageLinkClick);
elements.documentShell.addEventListener("pointerover", handleLinkPointerOver);
elements.documentShell.addEventListener("pointerout", handleLinkPointerOut);
elements.linkPreview.addEventListener("pointerenter", () => clearTimeout(linkPreviewTimer));
elements.linkPreview.addEventListener("pointerleave", () => {
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = setTimeout(hideLinkPreview, 200);
});
elements.linkPreviewJump.addEventListener("click", () => {
  if (linkPreviewDest !== null && linkPreviewDest !== undefined) navigateToDestination(linkPreviewDest);
});
elements.linkReturnButton.addEventListener("click", returnFromLink);
elements.linkReturnClose.addEventListener("click", hideLinkReturn);
elements.figureLightbox.addEventListener("click", closeFigureLightbox);
elements.translateSelectionButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.askAiSelectionButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.askAiSelectionButton.addEventListener("click", askAiAboutSelection);
elements.highlightSelectionButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.underlineSelectionButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.noteSelectionButton.addEventListener("mousedown", (event) => event.preventDefault());
elements.translateSelectionButton.addEventListener("click", translateCurrentSelection);
elements.highlightSelectionButton.addEventListener("click", highlightCurrentSelection);
elements.underlineSelectionButton.addEventListener("click", underlineCurrentSelection);
elements.noteSelectionButton.addEventListener("click", noteCurrentSelection);
elements.annotationForm.addEventListener("submit", saveAnnotationFromDialog);
elements.annotationDialogClose.addEventListener("click", closeAnnotationDialog);
elements.cancelAnnotationButton.addEventListener("click", closeAnnotationDialog);
elements.deleteAnnotationButton.addEventListener("click", deleteEditingAnnotation);
elements.documentShell.addEventListener("mouseup", handleAnnotationSelection);
document.addEventListener("mousedown", handleAnnotationOutsideClick, true);
document.addEventListener("mousedown", handleAiConversationMenuOutsideClick, true);
elements.pageStage.addEventListener("scroll", handleDocumentScroll, { passive: true });
elements.pageStage.addEventListener("pointerdown", handlePdfCapturePointerDown);
elements.pageStage.addEventListener("pointermove", handlePdfCapturePointerMove);
elements.pageStage.addEventListener("pointerup", handlePdfCapturePointerUp);
elements.pageStage.addEventListener("pointercancel", () => cancelPdfCaptureMode());
document.querySelectorAll("[data-sidebar-tab]").forEach((tab) => {
  tab.addEventListener("click", () => switchSidebarTab(tab.dataset.sidebarTab));
});
document.querySelectorAll("[data-panel-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_PANEL_TAB", tab: button.dataset.panelTab });
  });
});
LexiLoopReaderCenter.bind(document, chrome.storage);
// 「更多」菜单（popover）：选中一项后收起
elements.moreMenu?.addEventListener("click", (event) => {
  if (event.target.closest(".menu-item")) elements.moreMenu.hidePopover?.();
});
elements.themeButton.addEventListener("click", cycleReaderTheme);
elements.findButton.addEventListener("click", () => (elements.findBar.hidden ? openFindBar() : closeFindBar()));
elements.findBar.addEventListener("submit", (event) => { event.preventDefault(); stepFind(1); });
elements.findInput.addEventListener("input", () => {
  clearTimeout(findState.inputTimer);
  findState.inputTimer = setTimeout(runFind, 180);
});
elements.findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); stepFind(event.shiftKey ? -1 : 1); }
  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFindBar(); }
});
elements.findPrevious.addEventListener("click", () => stepFind(-1));
elements.findNext.addEventListener("click", () => stepFind(1));
elements.findClose.addEventListener("click", closeFindBar);
elements.findCaseButton.addEventListener("click", () => {
  findState.caseSensitive = !findState.caseSensitive;
  elements.findCaseButton.setAttribute("aria-pressed", String(findState.caseSensitive));
  runFind();
  elements.findInput.focus();
});
document.querySelectorAll("[data-color-filter]").forEach((button) => {
  button.addEventListener("click", () => setAnnotationColorFilter(button.dataset.colorFilter));
});
elements.openPanelButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
  if (!response?.ok) showToast(response?.error || "无法打开个人中心");
});
window.addEventListener("keydown", handleReaderShortcut);
// 在侧边栏里切换主题时，阅读器同步跟随
window.addEventListener("storage", (event) => {
  if (event.key !== READER_THEME_KEY) return;
  const next = READER_THEMES.includes(event.newValue) ? event.newValue : "light";
  if ((document.documentElement.dataset.readerTheme || "light") === next) return;
  transitionReaderTheme(() => applyReaderTheme(next, false));
});
window.addEventListener("afterprint", finishPrinting);
window.addEventListener("beforeunload", cleanupDocument);
window.addEventListener("resize", constrainAiPanelWidth);

applyReaderTheme(localStorage.getItem(READER_THEME_KEY) || "light", false);
loadPaneLayout();
resetReadingMode();
initialize();

async function initialize() {
  loadVocabWords();
  await loadAiPanelWidth();
  try {
    pdfjs = await import(chrome.runtime.getURL(PDFJS_PATH));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER_PATH);
  } catch (error) {
    showError(`PDF 引擎加载失败：${error.message}`);
    return;
  }

  const parameters = new URL(location.href).searchParams;
  const libraryId = parameters.get("library") || "";
  const findTerm = String(parameters.get("find") || "").slice(0, 120);
  const requestedPage = Number(parameters.get("page")) || 0;
  if (libraryId) {
    await loadPdfFromLibrary(libraryId, {
      requestedPage,
      forceIndex: parameters.get("index") === "force",
      findTerm
    });
    return;
  }
  const url = parameters.get("url") || "";
  if (!url) return;
  elements.urlInput.value = url;
  await loadPdf(url, { title: fileNameFromUrl(url), url, requestedPage, findTerm });
}

async function loadPdfFromLibrary(libraryId, options = {}) {
  try {
    const papers = await readPdfLibrary();
    const paper = LexiLoopPdfLibrary.findPaper(papers, { id: libraryId });
    if (!paper) throw new Error("文献记录不存在，可能已被删除");
    let source;
    if (paper.sourceType === "local") {
      const blob = await LexiLoopPdfLibrary.getPdfBlob(paper.id);
      if (!blob) throw new Error("本地 PDF 文件不存在，请重新添加");
      source = new Uint8Array(await blob.arrayBuffer());
    } else {
      if (!paper.sourceUrl) throw new Error("这条文献没有可用的 PDF 网址");
      source = paper.sourceUrl;
      elements.urlInput.value = paper.sourceUrl;
    }
    await loadPdf(source, {
      title: paper.title,
      url: paper.sourceUrl,
      requestedPage: options.requestedPage || paper.currentPage,
      libraryId: paper.id,
      libraryPaper: paper,
      forceIndex: Boolean(options.forceIndex),
      findTerm: options.findTerm || ""
    });
  } catch (error) {
    showError(error.message || "无法从文献库打开 PDF");
  }
}

function chooseFile() {
  elements.fileInput.value = "";
  elements.fileInput.click();
}

async function handleFile() {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    showToast("请选择 PDF 文件");
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadPdf(bytes, { title: file.name, url: "", fileSize: file.size });
}

async function handleUrl(event) {
  event.preventDefault();
  const url = elements.urlInput.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    showToast("请输入完整的 http 或 https PDF 网址");
    return;
  }
  await loadPdf(url, { title: fileNameFromUrl(url), url });
}

async function loadPdf(source, metadata) {
  showState("loading");
  elements.loadingMessage.textContent = "准备文档、目录和页面";
  try {
    await cleanupDocument();
    const requestedPage = Number(metadata.requestedPage)
      || (typeof source === "string" ? pageNumberFromUrl(source) : 1);
    loadingTask = pdfjs.getDocument({
      ...(typeof source === "string" ? { url: stripUrlFragment(source) } : { data: source }),
      // Chrome persists recoverable PDF.js parser warnings as extension errors.
      verbosity: pdfjs.VerbosityLevel.ERRORS,
      cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("vendor/pdfjs/wasm/")
    });
    loadingTask.onProgress = ({ loaded, total }) => {
      if (total) elements.loadingMessage.textContent = `已加载 ${Math.round(loaded / total * 100)}%`;
    };
    pdfDocument = await loadingTask.promise;
    loadingTask = null;
    const embedded = await pdfDocument.getMetadata().catch(() => ({}));
    const information = embedded?.info || {};
    pdfEmbeddedMetadata = {
      title: cleanPdfMetadata(information.Title, 500),
      authors: LexiLoopPdfLibrary.splitPdfAuthors(information.Author),
      year: LexiLoopPdfLibrary.parsePdfDate(information.CreationDate || information.ModDate),
      venue: cleanPdfMetadata(information.Subject, 300),
      tags: String(information.Keywords || "")
    };
    currentPage = Math.min(Math.max(1, requestedPage), pdfDocument.numPages);
    scale = 1;
    sourceUrl = metadata.url || "";
    currentPdfFileSize = Number(metadata.fileSize || metadata.libraryPaper?.fileSize) || 0;
    sourceTitle = metadata.libraryPaper?.title || pdfEmbeddedMetadata.title || metadata.title || "PDF 文档";
    documentKey = pdfDocument.fingerprints?.[0] || `${sourceTitle}:${pdfDocument.numPages}`;
    pdfLibraryPaperId = metadata.libraryId || "";
    currentLibraryPaper = metadata.libraryPaper || null;
    if (!currentLibraryPaper) {
      const papers = await readPdfLibrary().catch(() => []);
      currentLibraryPaper = LexiLoopPdfLibrary.findPaper(papers, { fingerprint: documentKey, sourceUrl });
      pdfLibraryPaperId = currentLibraryPaper?.id || "";
      if (currentLibraryPaper?.title) sourceTitle = currentLibraryPaper.title;
    }
    document.documentElement.dataset.lexiloopDocumentKey = documentKey;
    annotations = await loadDocumentAnnotations(documentKey);
    await loadAiConversation(documentKey);
    document.documentElement.dataset.lexiloopSourceTitle = sourceTitle;
    document.documentElement.dataset.lexiloopSourceUrl = sourceUrl;
    document.title = `${sourceTitle} - LexiLoop`;
    elements.documentTitle.textContent = sourceTitle;
    elements.documentTitle.title = sourceTitle;
    elements.documentMeta.textContent = `${pdfDocument.numPages} 页`;
    elements.pageTotal.textContent = `/ ${pdfDocument.numPages}`;
    elements.pageNumber.max = String(pdfDocument.numPages);
    elements.pageNumber.value = String(currentPage);
    updateLibraryButton();

    if (pdfLibraryPaperId) await syncCurrentPdfLibraryPaper(true).catch((error) => {
      console.warn("LexiLoop PDF library open sync failed", error);
    });

    await buildDocumentView();
    renderAllAnnotations();
    showState("document");
    requestAnimationFrame(() => {
      zoomFitMode = true;
      setZoom(autoFitScale());
      setCurrentPage(currentPage);
      scrollToPage(currentPage, false);
      renderPagesNearViewport();
    });
    if (pdfLibraryPaperId) {
      setTimeout(() => ensureDocumentIndexed(Boolean(metadata.forceIndex)), 300);
    }
    document.documentElement.dataset.lexiloopPaperId = pdfLibraryPaperId || "";
    updateVocabCount();
    // 从词库跳回原文：定位到那一页的那个词
    if (metadata.findTerm) setTimeout(() => findTermInDocument(metadata.findTerm, currentPage), 450);
  } catch (error) {
    console.error("LexiLoop PDF load failed", error);
    showError(friendlyPdfError(error));
  }
}

async function buildDocumentView() {
  elements.pagesContainer.replaceChildren();
  elements.thumbnailPanel.replaceChildren();
  elements.outlinePanel.replaceChildren();
  pageViews.clear();
  disconnectObservers();

  pageObserver = new IntersectionObserver(handlePageIntersections, {
    root: elements.pageStage,
    rootMargin: `${PAGE_RENDER_MARGIN}px 0px`,
    threshold: 0.01
  });
  thumbnailObserver = new IntersectionObserver(handleThumbnailIntersections, {
    root: elements.thumbnailPanel,
    rootMargin: "300px 0px",
    threshold: 0.01
  });

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    elements.loadingMessage.textContent = `正在准备第 ${pageNumber} / ${pdfDocument.numPages} 页`;
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const view = createPageView(pageNumber, page, baseViewport);
    pageViews.set(pageNumber, view);
    elements.pagesContainer.appendChild(view.spread);
    elements.thumbnailPanel.appendChild(view.thumbnailButton);
    pageObserver.observe(view.spread);
    thumbnailObserver.observe(view.thumbnailButton);
  }

  await renderOutline();
  updateControls();
  document.querySelectorAll(".document-action").forEach((button) => { button.hidden = false; });
}

function createPageView(pageNumber, page, baseViewport) {
  const spread = document.createElement("section");
  spread.className = "pdf-spread";
  spread.dataset.pageNumber = String(pageNumber);

  const element = document.createElement("article");
  element.className = "pdf-page original-page";
  element.dataset.pageNumber = String(pageNumber);
  element.setAttribute("aria-label", `第 ${pageNumber} 页`);

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const annotationLayer = document.createElement("div");
  annotationLayer.className = "pdf-annotation-layer";
  const pageLabel = document.createElement("span");
  pageLabel.className = "page-label";
  pageLabel.textContent = String(pageNumber);
  const linkLayer = document.createElement("div");
  linkLayer.className = "pdf-link-layer";
  const vocabLayer = document.createElement("div");
  vocabLayer.className = "vocab-layer";
  vocabLayer.setAttribute("aria-hidden", "true");
  element.append(canvas, vocabLayer, annotationLayer, textLayer, linkLayer, pageLabel);

  const translationElement = document.createElement("article");
  translationElement.className = "pdf-page translation-page";
  translationElement.setAttribute("aria-label", `第 ${pageNumber} 页译文`);
  const translationCanvas = document.createElement("canvas");
  translationCanvas.setAttribute("aria-hidden", "true");
  const translationLayer = document.createElement("div");
  translationLayer.className = "translation-layer";
  const translationStatus = document.createElement("div");
  translationStatus.className = "translation-page-status";
  translationStatus.textContent = "等待翻译";
  const translationLabel = document.createElement("span");
  translationLabel.className = "translation-page-label";
  translationLabel.textContent = "译文";
  translationElement.append(translationCanvas, translationLayer, translationStatus, translationLabel);
  spread.append(element, translationElement);

  const thumbnailButton = document.createElement("button");
  thumbnailButton.className = "thumbnail-button";
  thumbnailButton.type = "button";
  thumbnailButton.dataset.pageNumber = String(pageNumber);
  thumbnailButton.setAttribute("aria-label", `跳到第 ${pageNumber} 页`);
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.setAttribute("aria-hidden", "true");
  const thumbnailNumber = document.createElement("span");
  thumbnailNumber.textContent = String(pageNumber);
  thumbnailButton.append(thumbnailCanvas, thumbnailNumber);
  thumbnailButton.addEventListener("click", () => {
    scrollToPage(pageNumber);
    if (window.innerWidth <= 760) setSidebarOpen(false);
  });

  const view = {
    pageNumber,
    page,
    baseViewport,
    spread,
    element,
    canvas,
    textLayer,
    annotationLayer,
    linkLayer,
    linkLayerReady: false,
    vocabLayer,
    vocabMarks: null,
    vocabMarksVersion: -1,
    translationElement,
    translationCanvas,
    translationLayer,
    translationStatus,
    thumbnailButton,
    thumbnailCanvas,
    renderTask: null,
    textLayerTask: null,
    renderingPromise: null,
    renderedScale: 0,
    thumbnailRendered: false,
    thumbnailRendering: null,
    textContent: null,
    textLayerContent: null,
    translationState: "idle",
    translationLayout: null,
    translationPromise: null,
    documentGeneration
  };
  updatePageDimensions(view);
  return view;
}

function updatePageDimensions(view) {
  const viewport = view.page.getViewport({ scale });
  LexiLoopPdfSelection.applyViewportScale(view.element, viewport);
  view.element.style.width = `${viewport.width}px`;
  view.element.style.height = `${viewport.height}px`;
  view.translationElement.style.width = `${viewport.width}px`;
  view.translationElement.style.height = `${viewport.height}px`;
  view.translationLayer.style.width = `${view.baseViewport.width}px`;
  view.translationLayer.style.height = `${view.baseViewport.height}px`;
  view.translationLayer.style.transform = `scale(${scale})`;
}

function handlePageIntersections(entries) {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const pageNumber = Number(entry.target.dataset.pageNumber);
    renderPage(pageViews.get(pageNumber)).catch(handleRenderError);
  });
}

function handleThumbnailIntersections(entries) {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const pageNumber = Number(entry.target.dataset.pageNumber);
    renderThumbnail(pageViews.get(pageNumber)).catch(() => {});
  });
}

async function renderPage(view) {
  if (!view || view.renderedScale === scale || pinchScale !== null) return;
  if (view.renderingPromise) return view.renderingPromise;

  const version = renderVersion;
  const requestedScale = scale;
  const work = (async () => {
    const viewport = view.page.getViewport({ scale: requestedScale });
    const pixelRatio = canvasPixelRatio(viewport);
    // 画到一块新画布上，画完再替换：缩放、重绘期间旧画面一直显示（CSS 拉伸），不闪白
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
    const context = canvas.getContext("2d", { alpha: false });
    view.renderTask = view.page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    const textContentPromise = view.textLayerContent
      ? Promise.resolve(view.textLayerContent)
      : view.page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    const [textLayerContent] = await Promise.all([textContentPromise, view.renderTask.promise]);
    view.textLayerContent = textLayerContent;
    if (version !== renderVersion) return;
    view.canvas.replaceWith(canvas);
    view.canvas = canvas;

    // 画布画完时，这一页用到的内嵌字体都已注册加载，文字层才能用它们排字（见 pdf-textlayer.js）
    view.textLayer.replaceChildren();
    // pdf.js 在 lang 取自 PDF（通常为空）的隐藏画布上量宽度；透明文字必须用同样的 lang，
    // 否则会继承页面的 zh-CN，被 Chrome 换成中文字体，量和排不一致，选区越往行尾偏得越多
    view.textLayer.setAttribute("lang", textLayerContent.lang || "");
    const textLayer = new pdfjs.TextLayer({
      textContentSource: textLayerSource(textLayerContent),
      container: view.textLayer,
      viewport
    });
    view.textLayerTask = textLayer;
    await textLayer.render();
    if (version === renderVersion) {
      // 两端对齐多出的宽度挪到词间距上，字母不再被整体拉伸（见 pdf-textlayer.js 第 3 条）
      LexiLoopTextLayer.refineTextLayer({
        divs: textLayer.textDivs,
        items: textLayerContent.items,
        trusted: (fontName) => Boolean(textLayerFontChoices.get(fontName)),
        measure: (text, family) => measureTextLayerWidth(text, family, textLayerContent.lang || "")
      });
      LexiLoopTextLayer.attachEndOfContent(view.textLayer);
      view.renderedScale = requestedScale;
      ensureLinkLayer(view);
      paintVocabMarks(view);
      syncTranslationCanvas(view);
      scheduleFindPaint();
      trimRenderedPages();
    }
  })();

  view.renderingPromise = work
    .catch((error) => {
      if (version !== renderVersion || isRenderingCancellation(error)) return;
      throw error;
    })
    .finally(() => {
      if (version === renderVersion) {
        view.renderTask = null;
        view.textLayerTask = null;
        view.renderingPromise = null;
      }
    });
  return view.renderingPromise;
}

// 给每种字体选透明文字的字体栈：内嵌字体实测比通用字体更贴合 PDF 记录的宽度时，改用内嵌字体
function textLayerSource(content) {
  const styles = content?.styles || {};
  let patched = null;
  for (const [fontName, style] of Object.entries(styles)) {
    const family = textLayerFontFamily(fontName, style, content.items);
    if (!family) continue;
    patched ||= { ...styles };
    patched[fontName] = { ...style, fontFamily: family };
  }
  return patched ? { ...content, styles: patched } : content;
}

function textLayerFontFamily(fontName, style, items) {
  if (textLayerFontChoices.has(fontName)) return textLayerFontChoices.get(fontName);
  if (!style || style.vertical || !pdfFontLoaded(fontName)) return null;
  const generic = pdfjs.TextLayer.fontFamilyMap?.get(style.fontFamily) || style.fontFamily || "sans-serif";
  const choice = LexiLoopTextLayer.chooseFontFamily({
    fontName,
    genericFamily: generic,
    items,
    loaded: true,
    measure: (text, family) => {
      const font = `100px ${family}`;
      if (vocabMeasureContext.font !== font) vocabMeasureContext.font = font;
      return vocabMeasureContext.measureText(text).width;
    }
  });
  // 样本不足时不记结论，换一页再判
  if (!choice) return null;
  textLayerFontChoices.set(fontName, choice.family);
  return choice.family;
}

function measureTextLayerWidth(text, family, lang) {
  let context = textLayerMeasureCanvases.get(lang);
  if (!context) {
    const canvas = document.createElement("canvas");
    canvas.lang = lang;
    canvas.hidden = true;
    document.body.append(canvas);
    context = canvas.getContext("2d");
    textLayerMeasureCanvases.set(lang, context);
  }
  const font = `100px ${family}`;
  if (context.font !== font) context.font = font;
  return context.measureText(text).width;
}

async function renderThumbnail(view) {
  if (!view || view.thumbnailRendered || view.thumbnailRendering) return view?.thumbnailRendering;
  const thumbnailScale = THUMBNAIL_WIDTH / view.baseViewport.width;
  const viewport = view.page.getViewport({ scale: thumbnailScale });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const canvas = view.thumbnailCanvas;
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  view.thumbnailRendering = view.page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
  }).promise.then(() => {
    view.thumbnailRendered = true;
  }).finally(() => {
    view.thumbnailRendering = null;
  });
  return view.thumbnailRendering;
}

function renderPagesNearViewport() {
  if (!pdfDocument) return;
  const rootRect = elements.pageStage.getBoundingClientRect();
  pageViews.forEach((view) => {
    const rect = view.spread.getBoundingClientRect();
    if (rect.bottom >= rootRect.top - PAGE_RENDER_MARGIN && rect.top <= rootRect.bottom + PAGE_RENDER_MARGIN) {
      renderPage(view).catch(handleRenderError);
    }
  });
}

function handleDocumentScroll() {
  if (linkPreviewAnchor) hideLinkPreview();
  hideVocabTooltip();
  window.cancelAnimationFrame(scrollFrame);
  scrollFrame = window.requestAnimationFrame(() => {
    updateCurrentPageFromScroll();
    renderPagesNearViewport();
    // 点原文定位译文后，原文栏哪怕是 1px 的抖动也不该把译文拽回阅读线
    if (readingMode === "parallel" && paneLeader === "source" && performance.now() >= translationFocusLockUntil) syncTranslationToSource();
  });
}

function updateCurrentPageFromScroll() {
  const stageTop = elements.pageStage.getBoundingClientRect().top;
  let closestPage = currentPage;
  let closestDistance = Number.POSITIVE_INFINITY;
  pageViews.forEach((view) => {
    const rect = view.spread.getBoundingClientRect();
    const distance = Math.abs(rect.top - stageTop - 18);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = view.pageNumber;
    }
  });
  setCurrentPage(closestPage);
}

function setCurrentPage(pageNumber) {
  if (!pdfDocument) return;
  currentPage = Math.min(Math.max(1, pageNumber), pdfDocument.numPages);
  elements.pageNumber.value = String(currentPage);
  document.documentElement.dataset.lexiloopCurrentPage = String(currentPage);
  document.querySelectorAll(".thumbnail-button.is-active").forEach((button) => button.classList.remove("is-active"));
  const activeThumbnail = pageViews.get(currentPage)?.thumbnailButton;
  activeThumbnail?.classList.add("is-active");
  updateControls();
  updateAiContextStatus();
  queueLibraryProgressUpdate();
}

function scrollToPage(pageNumber, smooth = true) {
  if (!pdfDocument) return;
  const targetPage = Math.min(Math.max(1, Math.round(pageNumber || 1)), pdfDocument.numPages);
  const view = pageViews.get(targetPage);
  if (!view) return;
  setCurrentPage(targetPage);
  if (readingMode === "translation") {
    scrollTranslationToPage(targetPage);
    return;
  }
  if (readingMode === "parallel") paneLeader = "source";
  elements.pageStage.scrollTo({
    top: Math.max(0, view.spread.offsetTop - 18),
    behavior: smooth && !prefersReducedMotion() ? "smooth" : "instant"
  });
  renderPage(view).catch(handleRenderError);
}

// 让页面恰好铺满可视宽度（对照翻译模式按两页并排计算）。
function fitWidthScale() {
  const view = pageViews.get(currentPage) || pageViews.values().next().value;
  const stageWidth = elements.pageStage.clientWidth;
  if (!view || stageWidth < 200) return scale;
  const style = getComputedStyle(elements.pagesContainer);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  // 预留滚动条宽度，避免适配后又出现横向滚动条
  const available = stageWidth - padding - 14;
  const fit = Math.floor(available / view.baseViewport.width * 20) / 20;
  return Math.min(2.5, Math.max(0.5, fit));
}

// 自动适配时上限 130%，避免宽屏下页面被放得过大。
function autoFitScale() {
  return Math.min(1.3, fitWidthScale());
}

function changeZoom(delta) {
  zoomFitMode = false;
  setZoom(scale + delta);
}

function setZoom(value) {
  const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 20) / 20));
  if (!pdfDocument || nextScale === scale) return;
  // 缩放前锁定当前页：改尺寸会触发滚动观察器提前改写 currentPage，导致页面漂移。
  const anchorPage = currentPage;
  // 记住基准线落在哪页的什么位置；只有与当前页一致时才按它恢复（打开文档时先适配再跳页，不能被它覆盖）
  const sourceAnchor = sourceAnchorAtReadingLine();
  if (!elements.findBar.hidden && findState.total) findState.pendingReveal = true;
  scale = nextScale;
  markPagesStale();
  pageViews.forEach(updatePageDimensions);
  elements.resetZoom.textContent = `${Math.round(scale * 100)}%`;
  requestAnimationFrame(() => {
    if (sourceAnchor && sourceAnchor.view.pageNumber === anchorPage && sourceAnchor.view === pageViews.get(anchorPage)) {
      restoreSourceAnchor(sourceAnchor);
    } else {
      scrollToPage(anchorPage, false);
    }
    renderPagesNearViewport();
  });
  updateControls();
}

// 缩放后让页面按新比例重绘，但视口附近的页面保留旧画面（CSS 拉伸显示）直到新画面画好，不闪白；远处页面直接释放
function markPagesStale() {
  renderVersion += 1;
  const near = pagesNearViewport(PAGE_RENDER_MARGIN * 2);
  pageViews.forEach((view) => {
    view.renderTask?.cancel();
    view.textLayerTask?.cancel();
    view.renderTask = null;
    view.textLayerTask = null;
    view.renderingPromise = null;
    view.renderedScale = 0;
    if (!near.has(view)) releasePageCanvas(view);
  });
}

function pagesNearViewport(margin) {
  const near = new Set();
  const rootRect = elements.pageStage.getBoundingClientRect();
  pageViews.forEach((view) => {
    const rect = view.spread.getBoundingClientRect();
    if (rect.bottom >= rootRect.top - margin && rect.top <= rootRect.bottom + margin) near.add(view);
  });
  return near;
}

function releasePageCanvas(view) {
  view.canvas.width = 0;
  view.canvas.height = 0;
  view.translationCanvas.width = 0;
  view.translationCanvas.height = 0;
  view.textLayer.replaceChildren();
  view.renderedScale = 0;
}

// 只保留离当前页最近的若干页画面
function trimRenderedPages() {
  const rendered = [...pageViews.values()].filter((view) => view.canvas.width > 0 && !view.renderingPromise);
  if (rendered.length <= MAX_RENDERED_PAGES) return;
  const near = pagesNearViewport(PAGE_RENDER_MARGIN);
  rendered
    .filter((view) => !near.has(view))
    .sort((a, b) => Math.abs(b.pageNumber - currentPage) - Math.abs(a.pageNumber - currentPage))
    .slice(0, rendered.length - MAX_RENDERED_PAGES)
    .forEach(releasePageCanvas);
}

function canvasPixelRatio(viewport) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const area = viewport.width * viewport.height * ratio * ratio;
  return area > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)) : ratio;
}

// 触控板双指捏合：Chrome 把它报告成带 Ctrl 的滚轮事件（⌘ + 滚轮同样当作缩放），换算见 pdf-zoom.js。
// 手势过程中不改排版：整个页面容器以手势起点为原点做 CSS transform（只走合成器，几十页的文档也不掉帧），
// 同一帧内的多个事件合并；停手 160ms 后一次性换成真实尺寸，让起点下的那一点留在指针下，再按新比例清晰重绘。
// 文字层、批注层、词汇标记都按页面比例定位，跟着页面一起缩放。
function handleZoomWheel(event) {
  if (!(event.ctrlKey || event.metaKey) || !pdfDocument || elements.documentShell.hidden) return;
  // 阻止 Chrome 把整个阅读器页面（工具栏、侧栏）一起放大
  event.preventDefault();
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.pageStage.clientHeight : 1;
  const delta = clamp(event.deltaY * unit, -100, 100);
  if (readingMode === "translation" || (target && elements.translationPane.contains(target))) {
    // 在译文栏捏合：调整译文字号，累积到一定幅度跳一档
    translationPinchDelta += delta;
    if (Math.abs(translationPinchDelta) >= 60) {
      changeTranslationFontSize(translationPinchDelta < 0 ? 1 : -1);
      translationPinchDelta = 0;
    }
    return;
  }
  if (!target || !elements.pageStage.contains(target)) return;
  const factor = LexiLoopPdfZoom.wheelZoomFactor({
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    pageHeight: elements.pageStage.clientHeight
  });
  const next = clamp((pinchScale ?? scale) * factor, MIN_ZOOM, MAX_ZOOM);
  pinchScale = next;
  pinchPointer = { x: event.clientX, y: event.clientY };
  clearTimeout(pinchCommitTimer);
  pinchCommitTimer = setTimeout(commitPinchZoom, 160);
  if (!pinchFrame) pinchFrame = requestAnimationFrame(applyPinchFrame);
}

function applyPinchFrame() {
  pinchFrame = 0;
  if (pinchScale === null || !pinchPointer) return;
  if (!pinchGesture) beginPinchGesture(pinchPointer.x, pinchPointer.y);
  zoomFitMode = false;
  elements.pagesContainer.style.transform = `scale(${pinchScale / pinchGesture.baseScale})`;
  elements.resetZoom.textContent = `${Math.round(pinchScale * 100)}%`;
}

function beginPinchGesture(clientX, clientY) {
  if (renderingInFlight()) {
    // 捏合开始时取消正在进行的重绘，手势期间不按中间比例重画
    renderVersion += 1;
    pageViews.forEach((page) => {
      page.renderTask?.cancel();
      page.textLayerTask?.cancel();
      page.renderTask = null;
      page.textLayerTask = null;
      page.renderingPromise = null;
    });
  }
  hideAnnotationSelectionToolbar();
  const view = pageViewAtPoint(clientX, clientY);
  const container = elements.pagesContainer.getBoundingClientRect();
  elements.pagesContainer.style.transformOrigin = `${clientX - container.left}px ${clientY - container.top}px`;
  elements.pagesContainer.classList.add("is-pinching");
  pinchGesture = { baseScale: scale, view, before: view?.element.getBoundingClientRect(), clientX, clientY };
}

function endPinchGesture() {
  elements.pagesContainer.style.transform = "";
  elements.pagesContainer.style.transformOrigin = "";
  elements.pagesContainer.classList.remove("is-pinching");
  const gesture = pinchGesture;
  pinchGesture = null;
  return gesture;
}

function pageViewAtPoint(clientX, clientY) {
  const page = document.elementFromPoint(clientX, clientY)?.closest?.(".pdf-page:not(.translation-page)");
  return pageViews.get(Number(page?.dataset.pageNumber)) || pageViews.get(currentPage) || null;
}

function renderingInFlight() {
  for (const view of pageViews.values()) if (view.renderingPromise) return true;
  return false;
}

function commitPinchZoom() {
  pinchCommitTimer = 0;
  if (pinchScale === null) return;
  if (pinchFrame) {
    cancelAnimationFrame(pinchFrame);
    applyPinchFrame();
  }
  const nextScale = pinchScale;
  pinchScale = null;
  const gesture = endPinchGesture();
  if (!pdfDocument || !gesture) return;
  scale = nextScale;
  pageViews.forEach(updatePageDimensions);
  elements.resetZoom.textContent = `${Math.round(scale * 100)}%`;
  if (gesture.view && gesture.before) {
    const stage = elements.pageStage;
    const position = LexiLoopPdfZoom.anchoredScroll({
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      before: gesture.before,
      after: gesture.view.element.getBoundingClientRect(),
      clientX: gesture.clientX,
      clientY: gesture.clientY
    });
    stage.scrollTo({ ...position, behavior: "instant" });
  }
  if (!elements.findBar.hidden && findState.total) findState.pendingReveal = true;
  markPagesStale();
  updateControls();
  renderPagesNearViewport();
}

function invalidatePageRendering() {
  renderVersion += 1;
  pageViews.forEach((view) => {
    view.renderTask?.cancel();
    view.textLayerTask?.cancel();
    view.renderTask = null;
    view.textLayerTask = null;
    view.renderingPromise = null;
    view.renderedScale = 0;
    view.canvas.width = 0;
    view.canvas.height = 0;
    view.translationCanvas.width = 0;
    view.translationCanvas.height = 0;
    view.textLayer.replaceChildren();
  });
}

async function renderOutline() {
  const outline = await pdfDocument.getOutline().catch(() => null);
  elements.outlinePanel.replaceChildren();
  if (!outline?.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "这份文档没有提供大纲";
    elements.outlinePanel.appendChild(empty);
    return;
  }
  elements.outlinePanel.appendChild(createOutlineList(outline, 0));
}

function createOutlineList(items, depth) {
  const list = document.createElement("ol");
  list.className = "outline-level";
  items.forEach((item) => {
    const row = document.createElement("li");
    const label = document.createElement(item.dest ? "button" : "span");
    label.textContent = item.title || "未命名章节";
    label.style.setProperty("--outline-depth", String(depth));
    if (item.dest) {
      label.type = "button";
      label.addEventListener("click", async () => {
        const pageNumber = await destinationPageNumber(item.dest);
        if (pageNumber) scrollToPage(pageNumber);
        if (window.innerWidth <= 760) setSidebarOpen(false);
      });
    }
    row.appendChild(label);
    if (item.items?.length) row.appendChild(createOutlineList(item.items, depth + 1));
    list.appendChild(row);
  });
  return list;
}

async function destinationPageNumber(destination) {
  const explicitDestination = typeof destination === "string"
    ? await pdfDocument.getDestination(destination)
    : destination;
  const target = explicitDestination?.[0];
  if (Number.isInteger(target)) return target + 1;
  if (target && typeof target === "object") {
    return (await pdfDocument.getPageIndex(target)) + 1;
  }
  return null;
}

function switchSidebarTab(name) {
  document.querySelectorAll("[data-sidebar-tab]").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.sidebarTab === name);
  });
  document.querySelectorAll("[data-sidebar-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.sidebarPanel === name);
  });
  if (name === "vocab") renderVocabPanel();
}

function toggleSidebar() {
  setSidebarOpen(document.body.classList.contains("sidebar-closed"));
}

function setSidebarOpen(open) {
  document.body.classList.toggle("sidebar-closed", !open);
  elements.sidebarToggle.setAttribute("aria-expanded", String(open));
  constrainAiPanelWidth();
}

function handleAnnotationSelection(event) {
  if (event.target.closest?.(".annotation-selection-toolbar, .annotation-dialog, .translation-page, .translation-pane, .pdf-note-marker")) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideAnnotationSelectionToolbar();
    const annotation = annotationAtClientPoint(event);
    if (annotation) openAnnotationDialog(annotation);
    return;
  }
  const sourceRange = selection.getRangeAt(0);
  const pageElement = sourceRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? sourceRange.commonAncestorContainer.parentElement?.closest(".original-page")
    : sourceRange.commonAncestorContainer.closest?.(".original-page");
  const view = pageElement ? pageViews.get(Number(pageElement.dataset.pageNumber)) : null;
  const normalizedSelection = view
    ? LexiLoopPdfSelection.readTextLayerSelection(selection, view.textLayer, { mutate: true })
    : null;
  const text = normalizedSelection?.text || "";
  const range = normalizedSelection?.range;
  if (!view || !range || !text || text.length > 2000) {
    hideAnnotationSelectionToolbar();
    return;
  }

  const pageRect = pageElement.getBoundingClientRect();
  const mergedClientRects = LexiLoopPdfSelection.mergeSelectionRects([...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= pageRect.top && rect.top <= pageRect.bottom)
    .map((rect) => ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })), { minimumGap: 0.5 });
  const clientRects = mergedClientRects
    .map((rect) => ({
      x: clamp01((rect.x - pageRect.left) / pageRect.width),
      y: clamp01((rect.y - pageRect.top) / pageRect.height),
      width: clamp01(rect.width / pageRect.width),
      height: clamp01(rect.height / pageRect.height)
    }))
    .map((rect) => ({
      ...rect,
      width: clamp01(Math.min(rect.width, 1 - rect.x)),
      height: clamp01(Math.min(rect.height, 1 - rect.y))
    }));
  if (!clientRects.length) return;

  const anchorRect = [...range.getClientRects()].at(-1) || range.getBoundingClientRect();
  pendingAnnotationSelection = {
    pageNumber: view.pageNumber,
    text,
    context: normalizedSelection.context || selectionContext(pageElement, text),
    rects: clientRects,
    anchor: plainClientRect(anchorRect)
  };
  showAnnotationSelectionToolbar(pendingAnnotationSelection.anchor);
}

function handleAnnotationOutsideClick(event) {
  if (event.target.closest?.("#annotationSelectionToolbar, #annotationDialog")) return;
  if (!event.target.closest?.(".textLayer")) hideAnnotationSelectionToolbar();
}

function showAnnotationSelectionToolbar(rect) {
  hideTranslationUi();
  const toolbar = elements.annotationSelectionToolbar;
  toolbar.hidden = false;
  const width = toolbar.offsetWidth || 198;
  const height = toolbar.offsetHeight || 34;
  const left = Math.min(
    window.innerWidth - width - 8,
    Math.max(8, rect.left + rect.width / 2 - width / 2)
  );
  const top = rect.bottom + height + 16 <= window.innerHeight
    ? rect.bottom + 8
    : Math.max(8, rect.top - height - 8);
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${top}px`;
}

function hideAnnotationSelectionToolbar() {
  elements.annotationSelectionToolbar.hidden = true;
}

async function translateCurrentSelection() {
  if (!pendingAnnotationSelection) return;
  const { text, context, anchor, pageNumber } = pendingAnnotationSelection;
  hideAnnotationSelectionToolbar();
  // 语境取选区所在的整句（词库与复习卡里显示），取不到时用原来的前后文
  let sentence = context;
  const view = pageViews.get(pageNumber);
  if (view) {
    try {
      sentence = LexiLoopPdfVocab.sentenceForSelection(await pageReadingText(view), text) || context;
    } catch {
      sentence = context;
    }
  }
  document.dispatchEvent(new CustomEvent("lexiloop:pdf-translate-selection", {
    detail: { text, context: sentence, rect: anchor, source: documentSource(pageNumber) }
  }));
}

function hideTranslationUi() {
  document.dispatchEvent(new Event("lexiloop:pdf-hide-translation-ui"));
}

async function highlightCurrentSelection() {
  await saveQuickAnnotation("highlight", "高亮");
}

async function underlineCurrentSelection() {
  await saveQuickAnnotation("underline", "下划线");
}

async function saveQuickAnnotation(style, label) {
  if (!pendingAnnotationSelection) return;
  addAnnotationFromSelection(pendingAnnotationSelection, "yellow", "", style);
  clearPageSelection();
  await persistAnnotations();
  renderAllAnnotations();
  showToast(`${label}已保存，点击标记可修改或删除`);
}

function noteCurrentSelection() {
  if (!pendingAnnotationSelection) return;
  openAnnotationDialog(null, pendingAnnotationSelection);
}

function askAiAboutSelection() {
  if (!pendingAnnotationSelection) return;
  const { text, pageNumber } = pendingAnnotationSelection;
  hideAnnotationSelectionToolbar();
  clearPageSelection();
  askAiAboutText(text, pageNumber);
}

function askAiAboutText(text, pageNumber) {
  if (aiRequestPending) {
    setAiPanelOpen(true, true);
    elements.aiQuestionInput.value = `请结合上下文解释这段内容：“${text}”`;
    showToast("AI 正在回答，已把所选内容填入输入框");
    return;
  }
  askPdfAi(`请结合上下文解释这段内容：“${text}”`, { pageNumber });
}

function applyReaderTheme(theme, notify = true) {
  const next = READER_THEMES.includes(theme) ? theme : "light";
  if (next === "light") document.documentElement.removeAttribute("data-reader-theme");
  else document.documentElement.dataset.readerTheme = next;
  localStorage.setItem(READER_THEME_KEY, next);
  elements.themeButton?.setAttribute("title", `阅读主题：${READER_THEME_LABELS[next]}（点击切换）`);
  if (notify) showToast(`已切换到${READER_THEME_LABELS[next]}主题`);
  return next;
}

function cycleReaderTheme() {
  const current = localStorage.getItem(READER_THEME_KEY) || "light";
  const next = READER_THEMES[(READER_THEMES.indexOf(current) + 1) % READER_THEMES.length];
  transitionReaderTheme(() => applyReaderTheme(next));
}

// 新主题从屏幕中心圆形展开；不支持 View Transitions 时退回颜色渐变。
function transitionReaderTheme(update) {
  if (window.LexiLoopMotion && typeof document.startViewTransition === "function") {
    window.LexiLoopMotion.themeReveal(update);
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-transition");
  clearTimeout(transitionReaderTheme.timer);
  transitionReaderTheme.timer = setTimeout(() => root.classList.remove("theme-transition"), 320);
  update();
}

function setAnnotationColorFilter(color) {
  annotationColorFilter = color || "all";
  document.querySelectorAll("[data-color-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.colorFilter === annotationColorFilter);
  });
  renderAnnotationList();
}

function openAnnotationDialog(annotation, selection = null) {
  hideTranslationUi();
  editingAnnotationId = annotation?.id || "";
  pendingAnnotationSelection = selection || pendingAnnotationSelection;
  elements.annotationDialogTitle.textContent = annotation ? "编辑批注" : "添加笔记";
  elements.annotationQuote.textContent = annotation?.text || selection?.text || "";
  elements.annotationNote.value = annotation?.note || "";
  elements.deleteAnnotationButton.hidden = !annotation;
  const color = annotation?.color || "yellow";
  const colorInput = elements.annotationForm.querySelector(`[name="annotationColor"][value="${color}"]`);
  if (colorInput) colorInput.checked = true;
  const style = validAnnotationStyle(annotation?.style || "highlight");
  const styleInput = elements.annotationForm.querySelector(`[name="annotationStyle"][value="${style}"]`);
  if (styleInput) styleInput.checked = true;
  hideAnnotationSelectionToolbar();
  if (!elements.annotationDialog.open) elements.annotationDialog.showModal();
  requestAnimationFrame(() => elements.annotationNote.focus());
}

function closeAnnotationDialog() {
  editingAnnotationId = "";
  pendingAnnotationSelection = null;
  elements.annotationDialog.close();
}

async function saveAnnotationFromDialog(event) {
  event.preventDefault();
  const formData = new FormData(elements.annotationForm);
  const note = elements.annotationNote.value.trim();
  const color = validAnnotationColor(formData.get("annotationColor"));
  const style = validAnnotationStyle(formData.get("annotationStyle"));
  const existing = annotations.find((annotation) => annotation.id === editingAnnotationId);
  if (existing) {
    existing.note = note;
    existing.color = color;
    existing.style = style;
    existing.updatedAt = new Date().toISOString();
  } else if (pendingAnnotationSelection) {
    addAnnotationFromSelection(pendingAnnotationSelection, color, note, style);
  } else {
    return;
  }
  await persistAnnotations();
  renderAllAnnotations();
  closeAnnotationDialog();
  clearPageSelection();
  showToast("批注已保存");
}

async function deleteEditingAnnotation() {
  if (!editingAnnotationId) return;
  await deleteAnnotation(editingAnnotationId);
  closeAnnotationDialog();
}

async function deleteAnnotation(annotationId) {
  const annotation = annotations.find((item) => item.id === annotationId);
  if (!annotation) return;
  annotations = annotations.filter((item) => item.id !== annotationId);
  await persistAnnotations();
  renderAllAnnotations();
  showToast(`${annotationStyleLabel(annotation.style)}已删除`);
}

function buildAnnotation(selection, color, note, style) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    pageNumber: selection.pageNumber,
    text: selection.text,
    note,
    color,
    style,
    rects: selection.rects,
    createdAt: now,
    updatedAt: now
  };
}

function addAnnotationFromSelection(selection, color = "yellow", note = "", style = "highlight") {
  if (!selection?.text || !selection?.rects?.length || !Number.isInteger(selection.pageNumber)) {
    throw new Error("批注选区无效");
  }
  const annotation = buildAnnotation(
    selection,
    validAnnotationColor(color),
    note.trim(),
    validAnnotationStyle(style)
  );
  annotations.push(annotation);
  return annotation;
}

async function loadDocumentAnnotations(key) {
  try {
    const stored = await chrome.storage.local.get(ANNOTATIONS_KEY);
    const allAnnotations = stored[ANNOTATIONS_KEY] || {};
    const saved = Array.isArray(allAnnotations[key]) ? allAnnotations[key] : [];
    return saved.filter(isValidAnnotation).map((annotation) => ({
      ...annotation,
      color: validAnnotationColor(annotation.color),
      style: validAnnotationStyle(annotation.style)
    }));
  } catch {
    return [];
  }
}

async function persistAnnotations() {
  if (!documentKey) return;
  const stored = await chrome.storage.local.get(ANNOTATIONS_KEY);
  const allAnnotations = stored[ANNOTATIONS_KEY] && typeof stored[ANNOTATIONS_KEY] === "object"
    ? stored[ANNOTATIONS_KEY]
    : {};
  allAnnotations[documentKey] = annotations;
  await chrome.storage.local.set({ [ANNOTATIONS_KEY]: allAnnotations });
}

function renderAllAnnotations() {
  pageViews.forEach((view) => renderPageAnnotations(view));
  renderAnnotationList();
}

function renderPageAnnotations(view) {
  view.annotationLayer.replaceChildren();
  annotations.filter((annotation) => annotation.pageNumber === view.pageNumber).forEach((annotation) => {
    const displayRects = LexiLoopPdfSelection.mergeSelectionRects(annotation.rects, {
      xPerY: view.element.clientHeight / Math.max(1, view.element.clientWidth)
    });
    displayRects.forEach((rect) => {
      const highlight = document.createElement("span");
      highlight.className = `pdf-highlight is-${validAnnotationColor(annotation.color)} is-style-${validAnnotationStyle(annotation.style)}`;
      highlight.dataset.annotationId = annotation.id;
      Object.assign(highlight.style, {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`
      });
      view.annotationLayer.appendChild(highlight);
    });
    if (annotation.note && displayRects.length) {
      const lastRect = displayRects.at(-1);
      const marker = document.createElement("button");
      marker.className = `pdf-note-marker is-${validAnnotationColor(annotation.color)}`;
      marker.type = "button";
      marker.title = "打开批注";
      marker.setAttribute("aria-label", `打开第 ${view.pageNumber} 页批注`);
      marker.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v13H9l-4 4V4Z"/></svg>';
      marker.style.left = `${Math.min(97, (lastRect.x + lastRect.width) * 100)}%`;
      marker.style.top = `${Math.max(0, lastRect.y * 100 - 1)}%`;
      marker.addEventListener("click", () => openAnnotationDialog(annotation));
      view.annotationLayer.appendChild(marker);
    }
  });
}

function renderAnnotationList() {
  elements.annotationPanel.replaceChildren();
  elements.annotationCount.textContent = annotations.length ? String(annotations.length) : "";
  if (!annotations.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "选中 PDF 文字后可添加高亮、下划线或笔记";
    elements.annotationPanel.appendChild(empty);
    return;
  }

  const visibleAnnotations = annotationColorFilter === "all"
    ? annotations
    : annotations.filter((annotation) => validAnnotationColor(annotation.color) === annotationColorFilter);
  if (!visibleAnnotations.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "没有这个颜色的批注";
    elements.annotationPanel.appendChild(empty);
    return;
  }

  [...visibleAnnotations]
    .sort((a, b) => a.pageNumber - b.pageNumber || a.rects[0].y - b.rects[0].y)
    .forEach((annotation) => {
      const item = document.createElement("article");
      item.className = "annotation-item";
      const jump = document.createElement("button");
      jump.className = "annotation-jump";
      jump.type = "button";
      jump.innerHTML = `<span class="annotation-item-meta"><i class="annotation-color is-${validAnnotationColor(annotation.color)}"></i><span class="annotation-kind"></span><span>第 ${annotation.pageNumber} 页</span></span><strong></strong><small></small>`;
      jump.querySelector(".annotation-kind").textContent = annotationStyleLabel(annotation.style);
      jump.querySelector("strong").textContent = annotation.text;
      jump.querySelector("small").textContent = annotation.note || `仅${annotationStyleLabel(annotation.style)}`;
      jump.addEventListener("click", () => {
        scrollToPage(annotation.pageNumber);
        pulseAnnotation(annotation.id);
        if (window.innerWidth <= 760) setSidebarOpen(false);
      });
      const edit = document.createElement("button");
      edit.className = "annotation-edit";
      edit.type = "button";
      edit.title = "编辑批注";
      edit.setAttribute("aria-label", "编辑批注");
      edit.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
      edit.addEventListener("click", () => openAnnotationDialog(annotation));
      const remove = document.createElement("button");
      remove.className = "annotation-delete";
      remove.type = "button";
      remove.title = "删除批注";
      remove.setAttribute("aria-label", `删除第 ${annotation.pageNumber} 页批注`);
      remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
      remove.addEventListener("click", () => deleteAnnotation(annotation.id));
      item.append(jump, edit, remove);
      elements.annotationPanel.appendChild(item);
    });
}

function pulseAnnotation(annotationId) {
  requestAnimationFrame(() => {
    document.querySelectorAll(`[data-annotation-id="${CSS.escape(annotationId)}"]`).forEach((element) => {
      element.classList.remove("is-pulsing");
      requestAnimationFrame(() => element.classList.add("is-pulsing"));
    });
  });
}

function clearPageSelection() {
  window.getSelection()?.removeAllRanges();
  pendingAnnotationSelection = null;
  hideAnnotationSelectionToolbar();
}

function isValidAnnotation(annotation) {
  return annotation && typeof annotation.id === "string" && Number.isInteger(annotation.pageNumber)
    && Array.isArray(annotation.rects) && annotation.rects.length > 0;
}

function annotationAtClientPoint(event) {
  const pageElement = event.target.closest?.(".original-page");
  if (!pageElement) return null;
  const pageRect = pageElement.getBoundingClientRect();
  if (!pageRect.width || !pageRect.height) return null;
  const x = (event.clientX - pageRect.left) / pageRect.width;
  const y = (event.clientY - pageRect.top) / pageRect.height;
  const pageNumber = Number(pageElement.dataset.pageNumber);
  return [...annotations].reverse().find((annotation) => annotation.pageNumber === pageNumber
    && annotation.rects.some((rect) => x >= rect.x && x <= rect.x + rect.width
      && y >= rect.y && y <= rect.y + rect.height)) || null;
}

function validAnnotationColor(color) {
  return ["yellow", "green", "pink", "blue"].includes(color) ? color : "yellow";
}

function validAnnotationStyle(style) {
  return ["highlight", "underline", "strikeout"].includes(style) ? style : "highlight";
}

function annotationStyleLabel(style) {
  return { highlight: "高亮", underline: "下划线", strikeout: "删除线" }[validAnnotationStyle(style)];
}

function selectionContext(pageElement, selectedText) {
  const pageText = String(pageElement.querySelector(".textLayer")?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  const index = pageText.indexOf(selectedText);
  if (index < 0) return selectedText;
  const start = Math.max(0, index - 120);
  return pageText.slice(start, start + 300);
}

function plainClientRect(rect) {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function setAiPanelOpen(open, focus = true) {
  document.body.classList.toggle("ai-panel-open", open);
  elements.pdfAiPanel.setAttribute("aria-hidden", String(!open));
  elements.pdfAiPanel.inert = !open;
  elements.aiPanelButton.setAttribute("aria-expanded", String(open));
  if (!open) setAiConversationMenuOpen(false);
  if (open) {
    updateAiContextStatus();
    if (focus) requestAnimationFrame(() => elements.aiQuestionInput.focus());
  }
}

function updateAiContextStatus(label = "") {
  const context = label || (pdfDocument ? `第 ${currentPage} 页` : "当前页");
  elements.aiContextStatus.textContent = `PDF AI · ${context}`;
}

async function clearAiConversation() {
  if (aiRequestPending) return;
  const conversation = activeAiConversation();
  if (!conversation) return;
  conversation.title = "新对话";
  conversation.messages = [];
  conversation.updatedAt = Date.now();
  renderActiveAiConversation();
  await persistAiConversation();
}

function resetAiConversationState() {
  aiConversations = [];
  activeAiConversationId = "";
  aiConversation = [];
  elements.aiConversationTitle.textContent = "新对话";
  elements.aiEmptyState.hidden = false;
  elements.aiMessages.replaceChildren(elements.aiEmptyState);
  elements.aiMessageNodeList.replaceChildren();
  elements.aiMessageNodeRail.hidden = true;
  hideAiMessageNodePreview();
  elements.aiQuestionInput.value = "";
  renderAiConversationList();
  updateAiContextStatus();
}

function createAiConversation() {
  if (aiRequestPending) {
    showToast("请等待当前回答完成后再新建对话");
    return;
  }
  syncActiveAiConversation();
  const now = Date.now();
  const conversation = {
    id: typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `conversation-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  aiConversations.unshift(conversation);
  aiConversations.sort((a, b) => b.updatedAt - a.updatedAt);
  activeAiConversationId = conversation.id;
  renderActiveAiConversation();
  setAiConversationMenuOpen(false);
  persistAiConversation();
  requestAnimationFrame(() => elements.aiQuestionInput.focus());
}

function switchAiConversation(conversationId) {
  if (aiRequestPending || conversationId === activeAiConversationId) {
    if (aiRequestPending) showToast("请等待当前回答完成后再切换对话");
    setAiConversationMenuOpen(false);
    return;
  }
  syncActiveAiConversation();
  if (!aiConversations.some((conversation) => conversation.id === conversationId)) return;
  activeAiConversationId = conversationId;
  renderActiveAiConversation();
  persistAiConversation();
  setAiConversationMenuOpen(false);
}

function deleteAiConversation(conversationId) {
  if (aiRequestPending) {
    showToast("请等待当前回答完成后再删除对话");
    return;
  }
  syncActiveAiConversation();
  aiConversations = aiConversations.filter((conversation) => conversation.id !== conversationId);
  if (!aiConversations.length) {
    activeAiConversationId = "";
    createAiConversation();
    return;
  }
  if (activeAiConversationId === conversationId) {
    activeAiConversationId = [...aiConversations].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  }
  renderActiveAiConversation();
  persistAiConversation();
}

function activeAiConversation() {
  return aiConversations.find((conversation) => conversation.id === activeAiConversationId) || null;
}

function syncActiveAiConversation() {
  const conversation = activeAiConversation();
  if (!conversation) return;
  conversation.messages = aiConversation.map((message) => ({ ...message }));
  conversation.updatedAt = Date.now();
  if (conversation.title === "新对话" && conversation.messages.length) {
    conversation.title = LexiLoopPdfAiHistory.conversationTitle(conversation.messages) || "新对话";
  }
  elements.aiConversationTitle.textContent = conversation.title;
  elements.aiConversationTitle.title = conversation.title;
}

function renderActiveAiConversation() {
  let conversation = activeAiConversation();
  if (!conversation) {
    const now = Date.now();
    conversation = {
      id: `conversation-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    aiConversations = [conversation];
    activeAiConversationId = conversation.id;
  }
  aiConversation = conversation.messages.map((message) => ({ ...message }));
  elements.aiConversationTitle.textContent = conversation.title;
  elements.aiConversationTitle.title = conversation.title;
  elements.aiEmptyState.hidden = !aiConversation.length;
  elements.aiMessages.replaceChildren(elements.aiEmptyState);
  aiConversation.forEach((message) => {
    appendAiMessage(message.role, message.content, {
      attachment: message.attachment,
      meta: aiMessageMeta(message),
      deferNodeNav: true
    });
  });
  renderAiMessageNodes();
  elements.aiQuestionInput.value = "";
  updateAiContextStatus();
  renderAiConversationList();
}

function setAiConversationMenuOpen(open) {
  if (open) renderAiConversationList();
  elements.aiConversationMenu.hidden = !open;
  elements.aiConversationMenuButton.setAttribute("aria-expanded", String(open));
}

function handleAiConversationMenuOutsideClick(event) {
  if (elements.aiConversationMenu.hidden) return;
  if (elements.aiConversationMenu.contains(event.target) || elements.aiConversationMenuButton.contains(event.target)) return;
  setAiConversationMenuOpen(false);
}

function renderAiConversationList() {
  elements.aiConversationList.replaceChildren();
  const sorted = [...aiConversations].sort((a, b) => b.updatedAt - a.updatedAt);
  elements.aiConversationCount.textContent = `${sorted.length} 条`;
  sorted.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "pdf-ai-conversation-item";
    row.classList.toggle("is-active", conversation.id === activeAiConversationId);

    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "pdf-ai-conversation-switch";
    switchButton.setAttribute("aria-current", conversation.id === activeAiConversationId ? "true" : "false");
    const title = document.createElement("strong");
    title.textContent = conversation.title;
    const meta = document.createElement("small");
    meta.textContent = `${conversation.messages.length} 条消息 · ${aiConversationTime(conversation.updatedAt)}`;
    switchButton.append(title, meta);
    switchButton.addEventListener("click", () => switchAiConversation(conversation.id));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "pdf-ai-conversation-delete";
    removeButton.title = "删除对话";
    removeButton.setAttribute("aria-label", `删除对话：${conversation.title}`);
    removeButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
    removeButton.addEventListener("click", () => deleteAiConversation(conversation.id));
    row.append(switchButton, removeButton);
    elements.aiConversationList.appendChild(row);
  });
}

function aiConversationTime(value) {
  const timestamp = Number(value);
  return timestamp
    ? new Date(timestamp).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "刚刚";
}

async function submitAiQuestion(event) {
  event.preventDefault();
  const question = elements.aiQuestionInput.value.trim();
  if (!question || aiRequestPending) return;
  elements.aiQuestionInput.value = "";
  await askPdfAi(question);
}

async function askPdfAi(question, options = {}) {
  const normalizedQuestion = String(question || "").replace(/\s+/g, " ").trim();
  if (!pdfDocument || !normalizedQuestion || aiRequestPending) return;
  setAiPanelOpen(true, false);
  setAiConversationMenuOpen(false);
  const pageNumber = Math.min(Math.max(1, Number(options.pageNumber || currentPage)), pdfDocument.numPages);
  const history = aiConversation.filter(message => !message.incomplete).slice(-8).map(({ role, content }) => ({ role, content }));
  const userRecord = {
    role: "user",
    content: normalizedQuestion,
    meta: `第 ${pageNumber} 页`,
    attachment: options.imageDataUrl ? "screenshot" : "",
    createdAt: Date.now()
  };
  aiConversation.push(userRecord);
  persistAiConversation();
  appendAiMessage("user", normalizedQuestion, {
    imageDataUrl: options.imageDataUrl,
    meta: aiMessageMeta(userRecord)
  });
  const pendingMessage = appendAiMessage("assistant", "", { loading: true });
  const generation = documentGeneration;
  aiRequestPending = true;
  aiAbortController = new AbortController();
  const requestController = aiAbortController;
  const requestSignal = requestController.signal;
  const stopButton = document.createElement('button');
  stopButton.type = 'button'; stopButton.className = 'pdf-ai-message-action';
  stopButton.textContent = '停止生成';
  stopButton.addEventListener('click', () => { requestController.abort(); stopButton.disabled = true; });
  getAiMessageActions(pendingMessage.message).appendChild(stopButton);
  elements.sendAiQuestionButton.disabled = true;
  elements.aiQuestionInput.disabled = true;
  elements.clearAiChatButton.disabled = true;
  elements.newAiChatButton.disabled = true;
  elements.aiConversationMenuButton.disabled = true;
  let streamedAnswer = "";

  try {
    updateAiContextStatus("正在检索相关片段");
    const contextResult = await buildAiQuestionContext(
      normalizedQuestion,
      pageNumber,
      Boolean(options.imageDataUrl)
    );
    if (generation !== documentGeneration || !pdfDocument) return;
    if (requestSignal.aborted) throw new Error('已停止生成');
    updateAiContextStatus(
      contextResult.fragmentCount
        ? `已检索 ${contextResult.fragmentCount} 个片段 · 正在等待模型`
        : "正在等待模型"
    );
    const response = await requestPdfAiStream({
      type: "ASK_PDF_AI",
      question: normalizedQuestion,
      context: contextResult.context,
      history,
      imageDataUrl: options.imageDataUrl || "",
      title: sourceTitle
    }, (text) => {
      if (generation !== documentGeneration) return;
      streamedAnswer += text;
      appendAiStreamChunk(pendingMessage, text);
    }, requestSignal);
    if (!response?.ok) {
      const error = new Error(response?.error || "PDF AI 暂时不可用");
      error.category = response?.category || "unknown";
      throw error;
    }
    if (generation !== documentGeneration || !pdfDocument) return;
    const citedPages = contextResult.pageNumbers.map((page) => `p.${page}`).join("、");
    const assistantRecord = {
      role: "assistant",
      content: response.answer,
      meta: citedPages ? `${response.service || "PDF AI"} · ${citedPages}` : (response.service || "PDF AI"),
      createdAt: Date.now()
    };
    completeAiMessage(pendingMessage, response.answer, { meta: aiMessageMeta(assistantRecord) });
    aiConversation.push(assistantRecord);
    persistAiConversation();
    if (options.onAnswer) {
      try { await options.onAnswer(response.answer); showToast('知识页整理稿已更新'); }
      catch (error) { showToast('回答已保留，知识页保存失败：' + error.message); }
    }
  } catch (error) {
    if (generation !== documentGeneration) return;
    if (streamedAnswer.trim()) {
      const partial = { role: 'assistant', content: streamedAnswer, incomplete: true, meta: '回答中断 · 内容不完整', createdAt: Date.now() };
      completeAiMessage(pendingMessage, streamedAnswer, { meta: partial.meta });
      aiConversation.push(partial);
      persistAiConversation();
      showToast(error.message || '回答中断，已保留收到的内容');
    } else completeAiMessage(pendingMessage, error.message || "PDF AI 暂时不可用", {
      error: true,
      settingsAction: ["auth", "config", "timeout"].includes(error.category)
    });
    const recover = document.createElement('button');
    recover.type = 'button';
    recover.className = 'pdf-ai-message-action';
    recover.textContent = options.imageDataUrl ? '恢复问题（需重新截图）' : '恢复问题';
    recover.addEventListener('click', () => {
      if (elements.aiQuestionInput.value.trim()) { showToast('请先处理输入框中的草稿'); return; }
      elements.aiQuestionInput.value = normalizedQuestion;
      elements.aiQuestionInput.focus();
    });
    getAiMessageActions(pendingMessage.message).appendChild(recover);
  } finally {
    stopButton.remove();
    if (aiAbortController === requestController) aiAbortController = null;
    if (generation === documentGeneration) {
      aiRequestPending = false;
      elements.sendAiQuestionButton.disabled = false;
      elements.aiQuestionInput.disabled = false;
      elements.clearAiChatButton.disabled = false;
      elements.newAiChatButton.disabled = false;
      elements.aiConversationMenuButton.disabled = false;
      updateAiContextStatus();
      requestAnimationFrame(() => elements.aiQuestionInput.focus());
    }
  }
}

function requestPdfAiStream(payload, onChunk = () => {}, signal) {
  return new Promise((resolve, reject) => {
    let port;
    let settled = false;
    if (signal?.aborted) { reject(new Error('已停止生成')); return; }
    const cancel = () => finish(reject, new Error('已停止生成'));
    try {
      port = chrome.runtime.connect({ name: "lexiloop-pdf-ai-stream" });
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      try { port.disconnect(); } catch {}
      callback(value);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    port.onMessage.addListener((message) => {
      if (message?.type === "chunk") {
        onChunk(String(message.text || ""));
        return;
      }
      if (message?.type !== "done") return;
      if (message.ok) finish(resolve, message);
      else {
        const error = new Error(message.error || "PDF AI 暂时不可用");
        error.category = message.category || "unknown";
        finish(reject, error);
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      const error = new Error("PDF AI 流式连接已断开，请重试");
      error.category = "network";
      finish(reject, error);
    });
    try {
      port.postMessage({ ...payload, type: "ASK_PDF_AI_STREAM" });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function appendAiMessage(role, content, options = {}) {
  elements.aiEmptyState.hidden = true;
  const message = document.createElement("article");
  message.className = `pdf-ai-message is-${role}`;
  message.dataset.rawContent = String(content || "");
  if (options.imageDataUrl) {
    const image = document.createElement("img");
    image.src = options.imageDataUrl;
    image.alt = "PDF 框选截图";
    message.appendChild(image);
  } else if (options.attachment === "screenshot") {
    const attachment = document.createElement("span");
    attachment.className = "pdf-ai-attachment";
    attachment.textContent = "截图提问 · 图片未长期保存";
    message.appendChild(attachment);
  }
  const body = document.createElement("div");
  body.className = "pdf-ai-message-content";
  if (options.loading) {
    body.innerHTML = '<span class="pdf-ai-loading" aria-label="AI 正在回答"><i></i><i></i><i></i></span>';
  } else if (role === "assistant") {
    LexiLoopPdfAiRenderer.renderInto(body, content);
  } else {
    body.textContent = content;
  }
  message.appendChild(body);
  if (options.meta) appendAiMessageMeta(message, options.meta);
  if (role === "assistant" && !options.loading && !options.error && String(content || "").trim()) {
    appendAiMessageActions(message);
  }
  elements.aiMessages.appendChild(message);
  if (!options.deferNodeNav) renderAiMessageNodes();
  scrollAiMessagesToBottom();
  return { message, body };
}

function appendAiStreamChunk(target, chunk) {
  if (!chunk) return;
  const shouldFollow = aiAutoFollow;
  target.message.classList.remove("is-error");
  target.message.classList.add("is-streaming");
  target.streamContent = `${target.streamContent || ""}${chunk}`;
  target.streamShouldFollow = shouldFollow;
  if (target.streamFrame) return;
  target.streamFrame = requestAnimationFrame(() => {
    target.streamFrame = 0;
    const previousScrollTop = elements.aiMessages.scrollTop;
    LexiLoopPdfAiRenderer.renderInto(target.body, target.streamContent);
    if (target.streamShouldFollow) scrollAiMessagesToBottom();
    else elements.aiMessages.scrollTop = previousScrollTop;
  });
}

function completeAiMessage(target, content, options = {}) {
  const shouldFollow = aiAutoFollow;
  const previousScrollTop = elements.aiMessages.scrollTop;
  resetAiStreamTarget(target);
  const rawContent = String(content || "");
  target.message.dataset.rawContent = options.error ? "" : rawContent;
  if (options.error) target.body.textContent = rawContent;
  else LexiLoopPdfAiRenderer.renderInto(target.body, rawContent);
  target.message.classList.toggle("is-error", Boolean(options.error));
  if (options.meta) appendAiMessageMeta(target.message, options.meta);
  if (!options.error && rawContent.trim()) appendAiMessageActions(target.message);
  if (options.settingsAction) {
    const actions = getAiMessageActions(target.message);
    const button = document.createElement("button");
    button.className = "pdf-ai-message-action";
    button.type = "button";
    button.textContent = "打开 AI 设置";
    button.addEventListener("click", openPdfAiSettings);
    actions.appendChild(button);
  }
  renderAiMessageNodes();
  if (shouldFollow) scrollAiMessagesToBottom();
  else requestAnimationFrame(() => { elements.aiMessages.scrollTop = previousScrollTop; });
}

function resetAiStreamTarget(target) {
  if (target.streamFrame) cancelAnimationFrame(target.streamFrame);
  target.streamFrame = 0;
  target.streamContent = "";
  target.streamShouldFollow = false;
  target.message.classList.remove("is-streaming");
}

function getAiMessageActions(message) {
  let actions = message.querySelector(":scope > .pdf-ai-message-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "pdf-ai-message-actions";
    message.appendChild(actions);
  }
  return actions;
}

function appendAiMessageActions(message) {
  const actions = getAiMessageActions(message);
  if (actions.querySelector(".pdf-ai-message-copy")) return;
  const button = document.createElement("button");
  button.className = "pdf-ai-message-copy icon-button compact";
  button.type = "button";
  button.title = "复制回答";
  button.setAttribute("aria-label", "复制回答");
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"></path></svg>';
  button.addEventListener("click", () => copyAiMessageContent(message, button));
  actions.appendChild(button);
  button.title = '复制富文本';
  button.setAttribute('aria-label', button.title);
  const markdown = document.createElement('button');
  markdown.type = 'button';
  markdown.className = 'pdf-ai-message-action';
  markdown.textContent = 'Markdown';
  markdown.title = '复制 Markdown 与 LaTeX 源码';
  markdown.setAttribute('aria-label', markdown.title);
  markdown.addEventListener('click', () => copyAiMessageContent(message, markdown, true));
  actions.appendChild(markdown);
  const note = document.createElement('button');
  note.type = 'button'; note.className = 'pdf-ai-message-action'; note.textContent = '保存笔记';
  note.onclick = () => globalThis.saveKnowledgeNote?.(message.dataset.rawContent);
  actions.appendChild(note);
}

async function copyAiMessageContent(message, button, plain = false) {
  const content = String(message?.dataset?.rawContent || "");
  if (!content.trim() || message?.classList.contains("is-streaming")) return;
  try {
    const originalTitle = plain ? '复制 Markdown 与 LaTeX 源码' : '复制富文本';
    await writeClipboardText(content, plain ? null : message?.querySelector(".pdf-ai-message-content"));
    button.title = "已复制";
    button.setAttribute("aria-label", "已复制");
    button.classList.add("is-copied");
    showToast("回答已复制");
    clearTimeout(button.copyResetTimer);
    button.copyResetTimer = setTimeout(() => {
      button.title = originalTitle;
      button.setAttribute("aria-label", originalTitle);
      button.classList.remove("is-copied");
    }, 1800);
  } catch {
    showToast("复制失败，请手动选择文本");
  }
}

async function writeClipboardText(content, sourceElement) {
  const clone = sourceElement?.cloneNode(true);
  // Export standalone MathML, not KaTeX's CSS-dependent visual tree and hidden duplicate.
  clone?.querySelectorAll(".pdf-ai-math").forEach((formula) => {
    const math = formula.querySelector("math");
    if (math) formula.replaceWith(math.cloneNode(true));
  });
  const html = clone?.innerHTML || "";
  if (html && navigator.clipboard?.write && globalThis.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([content], { type: "text/plain" })
      })]);
      return;
    } catch {}
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } finally { textarea.remove(); }
  if (!copied) throw new Error("clipboard unavailable");
}

function renderAiMessageNodes() {
  const questions = [...elements.aiMessages.querySelectorAll(".pdf-ai-message.is-user")];
  hideAiMessageNodePreview();
  elements.aiMessageNodeList.replaceChildren();
  elements.aiMessageNodeRail.hidden = questions.length === 0;
  questions.forEach((message, index) => {
    const question = compactAiPreviewText(message.querySelector(".pdf-ai-message-content")?.textContent);
    const nextMessage = message.nextElementSibling;
    const assistantBody = nextMessage?.classList.contains("is-assistant")
      ? nextMessage.querySelector(".pdf-ai-message-content")
      : null;
    const answer = assistantBody
      ? (assistantBody.querySelector(".pdf-ai-loading") ? "正在回答…" : compactAiPreviewText(assistantBody.textContent))
      : "等待回答";
    const button = document.createElement("button");
    button.className = "pdf-ai-node-button";
    button.type = "button";
    button.dataset.messageNode = String(index);
    button.setAttribute("aria-label", `跳转到问题 ${index + 1}：${question}`);
    button.addEventListener("mouseenter", () => showAiMessageNodePreview(button, index, question, answer));
    button.addEventListener("mouseleave", hideAiMessageNodePreview);
    button.addEventListener("focus", () => showAiMessageNodePreview(button, index, question, answer));
    button.addEventListener("blur", hideAiMessageNodePreview);
    button.addEventListener("click", () => {
      aiAutoFollow = false;
      message.scrollIntoView({ behavior: "smooth", block: "start" });
      requestAnimationFrame(updateActiveAiMessageNode);
    });
    elements.aiMessageNodeList.appendChild(button);
  });
  requestAnimationFrame(updateActiveAiMessageNode);
}

function showAiMessageNodePreview(button, index, question, answer) {
  const preview = elements.aiMessageNodePreview;
  const railRect = elements.aiMessageNodeRail.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const top = Math.min(
    window.innerHeight - 142,
    Math.max(12, buttonRect.top + buttonRect.height / 2 - 63)
  );
  const right = Math.max(12, window.innerWidth - railRect.left + 8);
  preview.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = `问题 ${index + 1}`;
  const questionText = document.createElement("span");
  questionText.textContent = question;
  const answerText = document.createElement("small");
  answerText.textContent = answer;
  preview.append(label, questionText, answerText);
  preview.style.top = `${top}px`;
  preview.style.right = `${right}px`;
  preview.hidden = false;
}

function hideAiMessageNodePreview() {
  elements.aiMessageNodePreview.hidden = true;
}

function updateActiveAiMessageNode() {
  const questions = [...elements.aiMessages.querySelectorAll(".pdf-ai-message.is-user")];
  const buttons = [...elements.aiMessageNodeList.querySelectorAll(".pdf-ai-node-button")];
  if (!questions.length || !buttons.length) return;
  const focusLine = elements.aiMessages.scrollTop + Math.min(90, elements.aiMessages.clientHeight * 0.3);
  let activeIndex = 0;
  questions.forEach((message, index) => {
    if (message.offsetTop <= focusLine) activeIndex = index;
  });
  if (aiMessagesNearBottom(18)) activeIndex = questions.length - 1;
  buttons.forEach((button, index) => {
    button.classList.toggle("is-active", index === activeIndex);
    button.setAttribute("aria-current", index === activeIndex ? "true" : "false");
  });
  const activeButton = buttons[activeIndex];
  const nodeList = elements.aiMessageNodeList;
  if (activeButton?.offsetTop < nodeList.scrollTop) {
    nodeList.scrollTop = activeButton.offsetTop;
  } else if (activeButton && activeButton.offsetTop + activeButton.offsetHeight > nodeList.scrollTop + nodeList.clientHeight) {
    nodeList.scrollTop = activeButton.offsetTop + activeButton.offsetHeight - nodeList.clientHeight;
  }
}

function compactAiPreviewText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 110)}…` : (text || "空消息");
}

function appendAiMessageMeta(message, value) {
  const meta = document.createElement("small");
  meta.textContent = value;
  message.appendChild(meta);
}

function aiMessageMeta(message) {
  const createdAt = Number(message?.createdAt);
  const timestamp = createdAt
    ? new Date(createdAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  return [message?.meta, timestamp].filter(Boolean).join(" · ");
}

async function loadAiConversation(key) {
  resetAiConversationState();
  const generation = documentGeneration;
  try {
    const stored = await chrome.storage.local.get(LexiLoopPdfAiHistory.HISTORY_KEY);
    if (generation !== documentGeneration || key !== documentKey) return;
    const history = LexiLoopPdfAiHistory.normalizeStore(stored[LexiLoopPdfAiHistory.HISTORY_KEY]);
    const entry = history[key];
    if (entry?.conversations.length) {
      aiConversations = entry.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({ ...message }))
      }));
      activeAiConversationId = entry.activeConversationId;
    }
    renderActiveAiConversation();
  } catch (error) {
    console.warn("LexiLoop PDF AI history load failed", error);
    renderActiveAiConversation();
  }
}

function persistAiConversation() {
  const key = documentKey;
  if (!key) return Promise.resolve();
  syncActiveAiConversation();
  renderAiConversationList();
  const entry = {
    title: sourceTitle,
    sourceUrl,
    activeConversationId: activeAiConversationId,
    conversations: aiConversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message }))
    }))
  };
  aiHistoryWrite = aiHistoryWrite.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(LexiLoopPdfAiHistory.HISTORY_KEY);
    const next = LexiLoopPdfAiHistory.updateDocumentHistory(
      stored[LexiLoopPdfAiHistory.HISTORY_KEY],
      key,
      entry
    );
    await chrome.storage.local.set({ [LexiLoopPdfAiHistory.HISTORY_KEY]: next });
  });
  aiHistoryWrite.catch((error) => {
    console.warn("LexiLoop PDF AI history save failed", error);
    if (key === documentKey) showToast('会话保存失败：' + (error?.message || '请检查本机存储空间'));
  });
  return aiHistoryWrite;
}

async function loadAiPanelWidth() {
  try {
    const stored = await chrome.storage.local.get(LexiLoopPdfAiPanel.WIDTH_KEY);
    preferredAiPanelWidth = Number(stored[LexiLoopPdfAiPanel.WIDTH_KEY]) || LexiLoopPdfAiPanel.DEFAULT_WIDTH;
  } catch {
    preferredAiPanelWidth = LexiLoopPdfAiPanel.DEFAULT_WIDTH;
  }
  applyAiPanelWidth(preferredAiPanelWidth);
}

function applyAiPanelWidth(value, updatePreferred = false) {
  const reservedWidth = aiPanelReservedWidth();
  const width = LexiLoopPdfAiPanel.clampWidth(value, window.innerWidth, reservedWidth);
  if (updatePreferred) preferredAiPanelWidth = width;
  document.documentElement.style.setProperty("--ai-panel-width", `${width}px`);
  const bounds = LexiLoopPdfAiPanel.widthBounds(window.innerWidth, reservedWidth);
  elements.aiPanelResizeHandle.setAttribute("aria-valuemin", String(bounds.min));
  elements.aiPanelResizeHandle.setAttribute("aria-valuemax", String(bounds.max));
  elements.aiPanelResizeHandle.setAttribute("aria-valuenow", String(width));
  elements.aiPanelResizeHandle.title = `拖动调整侧栏宽度（${width}px）`;
  return width;
}

function currentAiPanelWidth() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ai-panel-width"))
    || LexiLoopPdfAiPanel.DEFAULT_WIDTH;
}

function startAiPanelResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  aiPanelResize = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startWidth: currentAiPanelWidth()
  };
  elements.aiPanelResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("ai-panel-resizing");
}

function moveAiPanelResize(event) {
  if (!aiPanelResize || event.pointerId !== aiPanelResize.pointerId) return;
  const width = LexiLoopPdfAiPanel.widthFromDrag(
    aiPanelResize.startWidth,
    aiPanelResize.startClientX,
    event.clientX,
    window.innerWidth,
    aiPanelReservedWidth()
  );
  applyAiPanelWidth(width, true);
}

function finishAiPanelResize(event) {
  if (!aiPanelResize || event.pointerId !== aiPanelResize.pointerId) return;
  if (elements.aiPanelResizeHandle.hasPointerCapture(event.pointerId)) {
    elements.aiPanelResizeHandle.releasePointerCapture(event.pointerId);
  }
  aiPanelResize = null;
  document.body.classList.remove("ai-panel-resizing");
  saveAiPanelWidth();
}

function handleAiPanelResizeKey(event) {
  if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home"
    ? LexiLoopPdfAiPanel.DEFAULT_WIDTH
    : currentAiPanelWidth() + (event.key === "ArrowLeft" ? 24 : -24);
  applyAiPanelWidth(next, true);
  saveAiPanelWidth();
}

function resetAiPanelWidth() {
  applyAiPanelWidth(LexiLoopPdfAiPanel.DEFAULT_WIDTH, true);
  saveAiPanelWidth();
}

function constrainAiPanelWidth() {
  applyAiPanelWidth(preferredAiPanelWidth);
}

function aiPanelReservedWidth() {
  if (window.innerWidth <= 760 || document.body.classList.contains("sidebar-closed")) return 0;
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width")) || 0;
}

function saveAiPanelWidth() {
  chrome.storage.local.set({
    [LexiLoopPdfAiPanel.WIDTH_KEY]: Math.round(preferredAiPanelWidth)
  }).catch((error) => console.warn("LexiLoop PDF AI panel width save failed", error));
}

function aiMessagesNearBottom(threshold = 72) {
  const container = elements.aiMessages;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function handleAiMessagesScroll() {
  if (aiScrollStateFrame) return;
  aiScrollStateFrame = requestAnimationFrame(() => {
    aiScrollStateFrame = 0;
    aiAutoFollow = aiMessagesNearBottom();
    updateActiveAiMessageNode();
  });
}

function scrollAiMessagesToBottom() {
  aiAutoFollow = true;
  requestAnimationFrame(() => {
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  });
}

async function openPdfAiSettings() {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" });
  if (!response?.ok) showToast(response?.error || "无法打开 AI 设置");
}

async function buildAiQuestionContext(question, pageNumber, screenshotOnly = false) {
  let pages;
  const currentPageQuestion = /当前页|这一页|本页|current page|this page/i.test(question);
  if (screenshotOnly || currentPageQuestion) {
    const page = await readAiPage(pageNumber);
    pages = page ? [page] : [];
  } else {
    pages = await ensurePdfAiContext();
  }
  const mode = screenshotOnly ? "screenshot" : currentPageQuestion ? "current" : "";
  const selected = LexiLoopPdfAiContext.selectPdfContext(pages, question, pageNumber, { mode });
  updateAiContextStatus(
    selected.pageNumbers.length
      ? `检索第 ${selected.pageNumbers.join("、")} 页 · ${selected.fragmentCount || 0} 个片段`
      : `第 ${pageNumber} 页`
  );
  return selected;
}

async function readAiPage(pageNumber) {
  const view = pageViews.get(pageNumber);
  if (!view) return null;
  const textContent = view.textContent || await view.page.getTextContent({ includeMarkedContent: true });
  view.textContent = textContent;
  return {
    pageNumber,
    text: LexiLoopPdfAiContext.pageTextFromItems(textContent.items)
  };
}

async function ensurePdfAiContext() {
  if (aiContextPages.length === pdfDocument?.numPages) return aiContextPages;
  if (aiContextPromise) return aiContextPromise;
  const generation = documentGeneration;
  const work = (async () => {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (generation !== documentGeneration || !pdfDocument) return [];
      updateAiContextStatus(`正在读取 ${pageNumber}/${pdfDocument.numPages} 页`);
      const page = await readAiPage(pageNumber);
      if (page) pages.push(page);
    }
    if (generation === documentGeneration) aiContextPages = pages;
    return pages;
  })();
  aiContextPromise = work;
  try {
    return await work;
  } finally {
    if (aiContextPromise === work) aiContextPromise = null;
  }
}

async function togglePdfCaptureMode() {
  if (!pdfDocument) return;
  if (pdfCaptureMode) {
    cancelPdfCaptureMode();
    return;
  }
  const view = pageViews.get(currentPage);
  if (!view) return;
  try {
    await renderPage(view);
  } catch (error) {
    handleRenderError(error);
    return;
  }
  clearPageSelection();
  hideTranslationUi();
  pdfCaptureMode = true;
  document.body.classList.add("pdf-capture-mode");
  elements.captureAiButton.setAttribute("aria-pressed", "true");
  showToast("在当前 PDF 页面拖拽框选，按 Esc 取消");
}

function handlePdfCapturePointerDown(event) {
  if (!pdfCaptureMode || event.button !== 0) return;
  const pageElement = event.target.closest?.(".original-page");
  if (!pageElement) return;
  const view = pageViews.get(Number(pageElement.dataset.pageNumber));
  if (!view) return;
  event.preventDefault();
  const rect = pageElement.getBoundingClientRect();
  const startX = clamp(event.clientX - rect.left, 0, rect.width);
  const startY = clamp(event.clientY - rect.top, 0, rect.height);
  const selection = document.createElement("div");
  selection.className = "pdf-capture-selection";
  selection.style.left = `${startX}px`;
  selection.style.top = `${startY}px`;
  pageElement.appendChild(selection);
  pdfCaptureDrag = { pointerId: event.pointerId, view, pageElement, rect, startX, startY, x: startX, y: startY, selection };
  elements.pageStage.setPointerCapture?.(event.pointerId);
}

function handlePdfCapturePointerMove(event) {
  if (!pdfCaptureDrag || event.pointerId !== pdfCaptureDrag.pointerId) return;
  event.preventDefault();
  const { rect, startX, startY, selection } = pdfCaptureDrag;
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  pdfCaptureDrag.x = x;
  pdfCaptureDrag.y = y;
  selection.style.left = `${Math.min(startX, x)}px`;
  selection.style.top = `${Math.min(startY, y)}px`;
  selection.style.width = `${Math.abs(x - startX)}px`;
  selection.style.height = `${Math.abs(y - startY)}px`;
}

function handlePdfCapturePointerUp(event) {
  if (!pdfCaptureDrag || event.pointerId !== pdfCaptureDrag.pointerId) return;
  handlePdfCapturePointerMove(event);
  finishPdfCapture(pdfCaptureDrag).catch((error) => {
    showToast(error.message || "无法生成 PDF 截图");
  });
}

async function finishPdfCapture(drag) {
  const geometry = {
    x: Math.min(drag.startX, drag.x),
    y: Math.min(drag.startY, drag.y),
    width: Math.abs(drag.x - drag.startX),
    height: Math.abs(drag.y - drag.startY)
  };
  const pageNumber = drag.view.pageNumber;
  cancelPdfCaptureMode();
  if (geometry.width < 20 || geometry.height < 20) {
    showToast("框选范围太小，请重新截图");
    return;
  }
  const imageDataUrl = capturePageRegion(drag.view, geometry);
  await askPdfAi(`请解释第 ${pageNumber} 页截图中的内容`, { imageDataUrl, pageNumber });
}

function capturePageRegion(view, geometry) {
  const source = view.canvas;
  const displayWidth = view.element.clientWidth;
  const displayHeight = view.element.clientHeight;
  if (!source.width || !source.height || !displayWidth || !displayHeight) {
    throw new Error("当前页面尚未渲染完成");
  }
  const scaleX = source.width / displayWidth;
  const scaleY = source.height / displayHeight;
  const sourceX = Math.max(0, Math.round(geometry.x * scaleX));
  const sourceY = Math.max(0, Math.round(geometry.y * scaleY));
  const sourceWidth = Math.min(source.width - sourceX, Math.max(1, Math.round(geometry.width * scaleX)));
  const sourceHeight = Math.min(source.height - sourceY, Math.max(1, Math.round(geometry.height * scaleY)));
  const outputScale = Math.min(1, 1400 / sourceWidth, 1400 / sourceHeight);
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(sourceWidth * outputScale));
  output.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const context = output.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  return output.toDataURL("image/jpeg", 0.86);
}

function cancelPdfCaptureMode() {
  pdfCaptureDrag?.selection.remove();
  if (pdfCaptureDrag?.pointerId !== undefined && elements.pageStage.hasPointerCapture?.(pdfCaptureDrag.pointerId)) {
    elements.pageStage.releasePointerCapture?.(pdfCaptureDrag.pointerId);
  }
  pdfCaptureDrag = null;
  pdfCaptureMode = false;
  document.body.classList.remove("pdf-capture-mode");
  elements.captureAiButton.setAttribute("aria-pressed", "false");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

async function toggleCurrentPageTranslation() {
  if (!pdfDocument || translationMode) return;
  const view = pageViews.get(currentPage);
  if (!view) return;
  const visible = view.spread.classList.contains("has-page-translation");

  if (visible && view.translationState === "complete") {
    view.spread.classList.remove("has-page-translation");
    updatePageTranslationControl();
    requestAnimationFrame(() => scrollToPage(currentPage, false));
    return;
  }

  view.spread.classList.add("has-page-translation");
  syncTranslationCanvas(view);
  updatePageTranslationControl();
  requestAnimationFrame(() => scrollToPage(currentPage, false));
  if (view.translationState === "complete" || view.translationState === "loading") return;

  try {
    const result = await translatePageView(view);
    if (result === "complete") showToast(`第 ${view.pageNumber} 页翻译完成`);
    if (result === "error") showToast(`第 ${view.pageNumber} 页部分内容翻译失败，可点击重试`);
  } catch (error) {
    if (!isPageTranslationActive(view)) return;
    setTranslationPageStatus(view, "error", error.message || "翻译暂时不可用");
    showToast(`第 ${view.pageNumber} 页翻译失败，可点击重试`);
  } finally {
    updatePageTranslationControl();
  }
}

function translatePageView(view, run = null) {
  if (view.translationPromise) return view.translationPromise;
  const work = performPageTranslation(view, run);
  const tracked = work.then((result) => {
    if (result === "cancelled" && isPageTranslationActive(view)) {
      setTranslationPageStatus(view, "idle", "等待翻译");
    }
    return result;
  }).finally(() => {
    if (view.translationPromise === tracked) view.translationPromise = null;
  });
  view.translationPromise = tracked;
  return tracked;
}

async function performPageTranslation(view, run) {
  setTranslationPageStatus(view, "loading", `正在翻译第 ${view.pageNumber} 页`);
  if (view.spread.classList.contains("has-page-translation")) await renderPage(view);
  if (!isPageTranslationActive(view, run)) return "cancelled";

  const textContent = await pageTextContent(view);
  const items = pageTextItems(textContent, view.baseViewport);
  const pageBlocks = LexiLoopPdfLayout.buildTranslationBlocks(items, view.baseViewport.width);
  // 链接与插图区域并行准备；任何一项失败都不影响翻译正文
  const [links, figures] = await Promise.all([
    getPageLinks(view).catch((error) => {
      console.warn("LexiLoop PDF links failed", error);
      return [];
    }),
    extractPageFigures(view, pageBlocks, items).catch((error) => {
      console.warn("LexiLoop PDF figures failed", error);
      return [];
    })
  ]);
  if (!isPageTranslationActive(view, run)) return "cancelled";
  // 插图里的文字（说明框、标签）随插图显示，不单独翻译
  const insideFigures = LexiLoopPdfFigures.blocksInsideRegions(pageBlocks, figures);
  const rawBlocks = pageBlocks.filter((_, index) => !insideFigures.has(index));

  // 文字段落与插图一起按阅读顺序排列；同一句被换栏、插图截断的段落接回同一句
  const ordered = LexiLoopPdfLayout.orderBlocksForReading([
    ...rawBlocks.map((block) => ({ ...block, flowType: "text" })),
    ...figures.map((figure, index) => ({ ...figure, flowType: "figure", figureIndex: index }))
  ], view.baseViewport.width);
  const layout = LexiLoopPdfLayout.linkContinuations(ordered.filter((entry) => entry.flowType === "text"));
  layout.forEach((block) => block.segments?.forEach((segment) => { segment.page = view.pageNumber; }));
  let textIndex = 0;
  const flow = ordered.map((entry) => (entry.flowType === "text"
    ? { type: "text", index: textIndex++ }
    : { type: "figure", index: entry.figureIndex }));
  assignLinksToBlocks(layout, links, view.pageNumber);
  applyCarryIn(view, layout);
  const carryOut = await prepareCarryOut(view, layout);
  if (!isPageTranslationActive(view, run)) return "cancelled";

  const rootBlocks = layout
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => !Number.isInteger(block.continuationOf) && !block.carryFrom);
  // 引用、图表编号、网址、带链接的文字换成占位符；作者姓名保留原文，不让模型音译或改写。
  rootBlocks.forEach(({ block, index }) => {
    block.inline = LexiLoopPdfInline.protectInline(block.joinedText || block.text, collectRootLinks(view, block, index, layout));
    if (block.kind === "author") {
      block.failed = false;
      block.translatedRaw = block.inline.text;
      block.translated = LexiLoopPdfInline.renderInline(block.inline.text, block.inline.tokens);
    }
  });
  const requests = rootBlocks.filter(({ block }) => block.kind !== "author");
  const translatedLines = [];
  for (let index = 0; index < requests.length; index += TRANSLATION_BATCH_SIZE) {
    if (!isPageTranslationActive(view, run)) return "cancelled";
    const batch = requests.slice(index, index + TRANSLATION_BATCH_SIZE);
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_PDF_BATCH",
      pageNumber: view.pageNumber,
      texts: batch.map(({ block }) => block.inline.text),
      target: "auto"
    });
    if (!response?.ok) throw new Error(response?.error || "翻译服务暂时不可用");
    translatedLines.push(...response.translations);
  }
  if (!isPageTranslationActive(view, run)) return "cancelled";

  requests.forEach(({ block }, index) => {
    const result = translatedLines[index];
    block.failed = result?.ok === false;
    // 失败时显示原文（占位符放回原样）
    block.translatedRaw = (!block.failed && result?.translated) || block.inline.text;
    block.translated = LexiLoopPdfInline.renderInline(block.translatedRaw, block.inline.tokens, block.failed ? { chinese: false } : {});
  });
  distributeContinuations(view, layout, carryOut);
  view.translationLayout = layout;
  view.translationFigures = figures;
  view.translationFlow = flow;
  renderTranslationLayer(view);
  if (!layout.length) {
    setTranslationPageStatus(view, "complete", figures.length ? "" : "本页未检测到可翻译文字");
    return "complete";
  }
  const failedCount = requests.filter(({ block }) => block.failed).length;
  setTranslationPageStatus(
    view,
    requests.length && failedCount === requests.length ? "error" : "complete",
    failedCount ? `${failedCount} 段暂时保留原文` : ""
  );
  return view.translationState;
}

function isPageTranslationActive(view, run = null) {
  return Boolean(
    pdfDocument
    && view?.documentGeneration === documentGeneration
    && pageViews.get(view.pageNumber) === view
    && (run === null || run === translationRun)
  );
}

async function pageTextContent(view) {
  if (!view.textContent) view.textContent = await view.page.getTextContent({ includeMarkedContent: true });
  return view.textContent;
}

// 文本条目换算到基准视口坐标；旋转文字（arXiv 侧边水印等）额外给出外接矩形
function pageTextItems(textContent, viewport) {
  return (textContent?.items || [])
    .filter((item) => typeof item.str === "string" && item.str.trim() && Array.isArray(item.transform))
    .map((item) => {
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      const height = Math.max(6, Math.hypot(transform[2], transform[3]));
      const width = Math.max(1, Number(item.width || 0));
      const rotated = Math.abs(transform[1]) > Math.abs(transform[0]) * 0.1 || Math.abs(transform[2]) > Math.abs(transform[3]) * 0.1;
      const entry = {
        text: item.str.trim(),
        str: item.str,
        x: transform[4],
        top: transform[5] - height,
        width,
        height,
        // 竖排/旋转文字不参与段落排版
        rotated
      };
      if (rotated) {
        const length = Math.hypot(transform[0], transform[1]) || 1;
        const along = [transform[0] / length * width, transform[1] / length * width];
        const corners = [[0, 0], along, [-transform[2], -transform[3]], [along[0] - transform[2], along[1] - transform[3]]]
          .map(([dx, dy]) => [transform[4] + dx, transform[5] + dy]);
        const xs = corners.map((point) => point[0]);
        const ys = corners.map((point) => point[1]);
        entry.box = { x: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      }
      return entry;
    });
}

// 只取文字段落（按阅读顺序），用于链接预览、跨页接续判断
function extractTranslationLines(textContent, viewport) {
  return LexiLoopPdfLayout.orderBlocksForReading(
    LexiLoopPdfLayout.buildTranslationBlocks(pageTextItems(textContent, viewport), viewport.width),
    viewport.width
  );
}

async function pagePreviewBlocks(view) {
  if (view.translationState === "complete" && view.translationLayout?.length) return view.translationLayout;
  if (!view.previewBlocks) view.previewBlocks = LexiLoopPdfLayout.linkContinuations(extractTranslationLines(await pageTextContent(view), view.baseViewport));
  return view.previewBlocks;
}

// ---- 跨页断句：上一页最后一段没说完、下一页第一段以小写开头，接成一句翻译 ----

function lastReadingBlockIndex(layout) {
  for (let index = layout.length - 1; index >= 0; index -= 1) {
    if (!["caption", "footnote"].includes(layout[index].kind)) return index;
  }
  return -1;
}

function firstReadingBlock(blocks, pageHeight) {
  return blocks.find((block) => !["caption", "footnote"].includes(block.kind)
    // 页眉（单行、贴近页面顶部）不算正文开头
    && !(block.lineCount === 1 && block.top < pageHeight * 0.07));
}

function applyCarryIn(view, layout) {
  const carry = view.carryIn;
  if (!carry) return;
  const previous = pageViews.get(carry.page);
  const root = previous?.translationLayout?.[carry.index];
  const index = layout.findIndex((block) => block.text === carry.text);
  const usable = index >= 0
    && previous?.translationState === "complete"
    && root && !root.failed
    && typeof carry.translatedTail === "string"
    && !Number.isInteger(layout[index].continuationOf)
    && !layout[index].segments;
  if (!usable) {
    // 上一页没能把这一句接过去：本页这一段单独翻译
    view.carryIn = null;
    return;
  }
  layout[index].carryFrom = { page: carry.page, index: carry.index };
  layout[index].translated = carry.translatedTail;
  const segment = root.segments?.find((item) => item.page === view.pageNumber);
  if (segment) segment.index = index;
}

async function prepareCarryOut(view, layout) {
  const next = pageViews.get(view.pageNumber + 1);
  if (!next || next.translationState !== "idle" || (next.carryIn && next.carryIn.page !== view.pageNumber)) return null;
  const lastIndex = lastReadingBlockIndex(layout);
  const last = layout[lastIndex];
  if (!last || (last.kind || "body") !== "body" || !LexiLoopPdfLayout.isOpenEnded(last.text)) return null;
  const rootIndex = Number.isInteger(last.continuationOf) ? last.continuationOf : lastIndex;
  const root = layout[rootIndex];
  if (root.carryFrom) return null;
  const nextBlocks = extractTranslationLines(await pageTextContent(next), next.baseViewport);
  const first = firstReadingBlock(nextBlocks, next.baseViewport.height);
  const rootText = root.joinedText || root.text;
  if (!first || (first.kind || "body") !== "body" || !LexiLoopPdfLayout.startsContinuation(first.text)) return null;
  if (rootText.length + first.text.length > 1900) return null;
  const parts = root.segments?.length
    ? root.segments.map((segment) => ({ page: segment.page, index: segment.index, length: segment.length }))
    : [{ page: view.pageNumber, index: rootIndex, length: root.text.length }];
  parts.push({ page: next.pageNumber, index: null, length: first.text.length });
  root.joinedText = LexiLoopPdfLayout.joinContinuation(rootText, first.text);
  root.segments = LexiLoopPdfLayout.segmentRanges(parts);
  const nextLinks = await getPageLinks(next).catch(() => []);
  root.carryTail = {
    page: next.pageNumber,
    block: first,
    linkRefs: nextLinks.filter((link) => blockContainingRect([first], link.rect)).map((link) => ({ key: link.key, offset: linkOffsetInBlock(first, link.rect) }))
  };
  next.carryIn = { page: view.pageNumber, index: rootIndex, text: first.text };
  return { next, rootIndex };
}

// 合并翻译的句子：阅读栏里整句显示在开头段落；版面对照里按比例拆回各段原位置
function distributeContinuations(view, layout, carryOut) {
  layout.forEach((root, rootIndex) => {
    if (!root.segments?.length || Number.isInteger(root.continuationOf) || root.carryFrom) return;
    const parts = splitAcrossSegments(root.failed ? "" : root.translated, root.segments);
    root.overlayText = root.failed ? root.text : parts[0];
    root.segments.forEach((segment, order) => {
      if (order === 0) return;
      if (segment.page === view.pageNumber && Number.isInteger(segment.index)) {
        const tail = layout[segment.index];
        if (!tail) return;
        tail.failed = root.failed;
        tail.translated = root.failed ? tail.text : parts[order];
      } else if (carryOut && segment.page === carryOut.next.pageNumber && rootIndex === carryOut.rootIndex) {
        carryOut.next.carryIn.translatedTail = root.failed ? undefined : parts[order];
      }
    });
  });
}

function splitAcrossSegments(text, segments) {
  const parts = [];
  let rest = String(text || "");
  let consumed = 0;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const share = (segment.end - segment.start) / Math.max(1e-6, 1 - consumed);
    const [head, tail] = LexiLoopPdfBilingual.splitTranslation(rest, share);
    parts.push(head);
    rest = tail;
    consumed = segment.end;
  }
  parts.push(rest);
  return parts;
}

function renderTranslationLayer(view) {
  view.translationLayer.replaceChildren();
  const blocks = [];
  for (const line of view.translationLayout || []) {
    if (line.failed) continue;
    const text = line.overlayText ?? line.translated;
    if (!text) continue;
    const block = document.createElement("div");
    block.className = "translation-text-block";
    block.lang = /[㐀-鿿]/u.test(text) ? "zh-CN" : "en";
    block.textContent = text;
    block.title = line.text;
    // 框比原文段落四周各外扩 1px，盖住原文笔画的边缘
    Object.assign(block.style, {
      left: `${line.x - 1}px`,
      top: `${line.top - 1}px`,
      width: `${line.width + 2}px`,
      height: `${line.height + 2}px`,
      fontSize: `${preferredTranslationFontSize(line)}px`
    });
    view.translationLayer.appendChild(block);
    blocks.push([block, line]);
  }
  // 先全部插入再统一测量，避免逐个测量反复触发排版
  blocks.forEach(([block, line]) => fitTranslationBlock(block, line));
  // 译文页当时不可见只能估算字号；等显示后（syncTranslationCanvas）再按实测重排
  view.translationFitPending = blocks.some(([block]) => !block.clientWidth);
}

function preferredTranslationFontSize(line) {
  const lineHeight = Number(line.lineHeight) || Number(line.height) || 10;
  return Math.max(6, lineHeight * 0.9);
}

// 在段落框内按实际排版测量：从接近原文的字号开始，二分缩小到不溢出为止。
function fitTranslationBlock(block, line) {
  const boxHeight = line.height + 2;
  const preferred = preferredTranslationFontSize(line);
  const lineCount = Math.max(1, Number(line.lineCount) || 1);
  // 行距：多行段落贴近原文行距，单行用紧凑行距
  block.style.lineHeight = lineCount > 1 ? String(Math.min(1.45, Math.max(1.12, line.height / lineCount / preferred))) : "1.15";
  if (!block.clientWidth) {
    // 页面当前不可见（未显示译文页），退回估算
    const characterFactor = block.lang === "zh-CN" ? 1 : 0.56;
    const estimated = Math.sqrt((line.width * boxHeight) / Math.max(1, block.textContent.length * characterFactor * 1.3));
    block.style.fontSize = `${Math.max(5, Math.min(preferred, estimated))}px`;
    return;
  }
  if (block.scrollHeight <= boxHeight + 0.5) return;
  let low = 4.5;
  let high = preferred;
  for (let step = 0; step < 7; step += 1) {
    const middle = (low + high) / 2;
    block.style.fontSize = `${middle}px`;
    if (block.scrollHeight <= boxHeight + 0.5) low = middle;
    else high = middle;
  }
  block.style.fontSize = `${low}px`;
  if (block.scrollHeight > boxHeight + 0.5) block.style.lineHeight = "1.05";
}

function syncTranslationCanvas(view) {
  const visible = translationMode || view.spread.classList.contains("has-page-translation");
  if (!visible || !view.canvas.width || !view.canvas.height) return;
  const canvas = view.translationCanvas;
  canvas.width = view.canvas.width;
  canvas.height = view.canvas.height;
  canvas.style.width = view.canvas.style.width;
  canvas.style.height = view.canvas.style.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(view.canvas, 0, 0);
  if (view.translationFitPending && view.translationLayout) renderTranslationLayer(view);
}

function setTranslationPageStatus(view, state, message) {
  view.translationState = state;
  view.translationStatus.textContent = message;
  view.translationStatus.className = `translation-page-status is-${state}`;
  view.translationStatus.hidden = state === "complete" && !message;
  if (view.pageNumber === currentPage) updatePageTranslationControl();
  renderTranslationSection(view);
  updateTranslationProgressLabel();
}

function updatePageTranslationControl() {
  const view = pageViews.get(currentPage);
  const visible = Boolean(view?.spread.classList.contains("has-page-translation"));
  const state = view?.translationState || "idle";
  elements.pageTranslationButton.disabled = !view || translationMode;
  elements.pageTranslationButton.setAttribute("aria-pressed", String(visible));

  let label = "版面对照";
  if (translationMode) label = "对照阅读中";
  else if (visible && state === "loading") label = "翻译中";
  else if (visible && state === "error") label = "重试本页";
  else if (visible && state === "complete") label = "隐藏本页";
  else if (!visible && state === "complete") label = "显示本页";
  elements.pageTranslationLabel.textContent = label;
  elements.pageTranslationButton.title = translationMode ? "对照阅读已开启" : label;
  elements.pageTranslationButton.setAttribute("aria-label", `${label}，第 ${currentPage} 页`);
}

async function readPdfLibrary() {
  const response = await chrome.runtime.sendMessage({ type: "PDF_LIBRARY_GET" });
  if (!response?.ok) throw new Error(response?.error || "无法读取文献库");
  return LexiLoopPdfLibrary.normalizeLibrary(response.papers);
}

async function addCurrentPdfToLibrary() {
  if (!pdfDocument || elements.addToLibraryButton.disabled) return;
  elements.addToLibraryButton.disabled = true;
  if (pdfLibraryPaperId) {
    try {
      await syncCurrentPdfLibraryPaper(true);
      showToast("文献资料与阅读进度已同步");
    } catch (error) {
      showToast(error.message || "文献同步失败");
    } finally {
      elements.addToLibraryButton.disabled = false;
    }
    return;
  }

  const requestedId = documentKey || `paper-${Date.now()}`;
  const local = !sourceUrl;
  try {
    if (local) {
      const bytes = await pdfDocument.getData();
      const blob = new Blob([bytes], { type: "application/pdf" });
      currentPdfFileSize = blob.size;
      await LexiLoopPdfLibrary.putPdfBlob(requestedId, blob);
    }
    pdfLibraryPaperId = requestedId;
    currentLibraryPaper = await syncCurrentPdfLibraryPaper(true);
    showToast("已加入 PDF 文献库");
    setTimeout(() => ensureDocumentIndexed(false), 300);
  } catch (error) {
    if (local) await LexiLoopPdfLibrary.deletePdfBlob(requestedId).catch(() => {});
    pdfLibraryPaperId = "";
    currentLibraryPaper = null;
    updateLibraryButton();
    showToast(error.message || "无法加入文献库");
  } finally {
    elements.addToLibraryButton.disabled = false;
  }
}

async function syncCurrentPdfLibraryPaper(markOpened = false) {
  if (!pdfDocument || !pdfLibraryPaperId) return null;
  const existing = currentLibraryPaper;
  const useEmbeddedTitle = !existing?.title || isGenericPaperTitle(existing.title, existing.fileName);
  const title = useEmbeddedTitle && pdfEmbeddedMetadata.title
    ? pdfEmbeddedMetadata.title
    : (existing?.title || sourceTitle);
  const status = existing?.status === "finished" || currentPage >= pdfDocument.numPages
    ? "finished"
    : "reading";
  const paper = {
    id: pdfLibraryPaperId,
    fingerprint: documentKey,
    title,
    authors: existing?.authors?.length ? existing.authors : pdfEmbeddedMetadata.authors,
    year: existing?.year || pdfEmbeddedMetadata.year,
    venue: existing?.venue || pdfEmbeddedMetadata.venue,
    tags: existing?.tags?.length ? existing.tags : pdfEmbeddedMetadata.tags,
    sourceType: sourceUrl ? "remote" : "local",
    sourceUrl,
    fileName: existing?.fileName || safePdfFileName(sourceTitle),
    fileSize: currentPdfFileSize,
    pageCount: pdfDocument.numPages,
    currentPage,
    progress: currentPage / pdfDocument.numPages,
    status,
    ...(markOpened ? { lastOpenedAt: new Date().toISOString() } : {})
  };
  const response = await chrome.runtime.sendMessage({ type: "PDF_LIBRARY_UPSERT", paper });
  if (!response?.ok || !response.paper) throw new Error(response?.error || "文献库更新失败");
  currentLibraryPaper = response.paper;
  pdfLibraryPaperId = response.paper.id;
  if (useEmbeddedTitle && response.paper.title && response.paper.title !== sourceTitle) {
    sourceTitle = response.paper.title;
    document.documentElement.dataset.lexiloopSourceTitle = sourceTitle;
    document.title = `${sourceTitle} - LexiLoop`;
    elements.documentTitle.textContent = sourceTitle;
    elements.documentTitle.title = sourceTitle;
  }
  updateLibraryButton();
  return response.paper;
}

function updateLibraryButton() {
  const saved = Boolean(pdfLibraryPaperId);
  elements.addToLibraryButton.setAttribute("aria-pressed", String(saved));
  elements.addToLibraryButton.title = saved ? "已在文献库，点击同步进度" : "加入文献库";
  elements.addToLibraryButton.setAttribute("aria-label", saved ? "同步文献库阅读进度" : "加入文献库");
  updateIndexButton();
}

function updateIndexButton() {
  const button = elements.indexDocumentButton;
  const status = currentLibraryPaper?.indexStatus || "idle";
  const labels = {
    idle: "建立全文索引",
    indexing: `正在建立全文索引 ${currentLibraryPaper?.indexedPageCount || 0}/${pdfDocument?.numPages || currentLibraryPaper?.pageCount || 0}`,
    ready: currentLibraryPaper?.indexTruncated ? "全文索引已建立（部分）" : "全文索引已建立",
    "needs-ocr": "可选文字过少，需要 OCR",
    error: `全文索引失败${currentLibraryPaper?.indexError ? `：${currentLibraryPaper.indexError}` : ""}`
  };
  const label = pdfLibraryPaperId ? (labels[status] || labels.idle) : "加入文献库后可建立全文索引";
  button.dataset.indexStatus = status;
  button.title = status === "ready" ? `${label}，点击重新建立` : label;
  button.setAttribute("aria-label", button.title);
  button.disabled = !pdfLibraryPaperId || status === "indexing";
}

async function ensureDocumentIndexed(force = false) {
  if (!pdfDocument || !pdfLibraryPaperId) {
    if (force) showToast("请先将 PDF 加入文献库");
    return null;
  }
  const generation = documentGeneration;
  if (indexBuildPromise && indexBuildDocumentGeneration === generation) return indexBuildPromise;
  const paperId = pdfLibraryPaperId;
  const fingerprint = documentKey;
  const pageCount = pdfDocument.numPages;
  const title = sourceTitle;

  const work = (async () => {
    const existing = await LexiLoopPdfLibrary.getPdfIndex(paperId).catch(() => null);
    const reusable = existing
      && Number(existing.version) === LexiLoopPdfIndex.INDEX_VERSION
      && existing.fingerprint === fingerprint
      && Number(existing.pageCount) === pageCount;
    if (reusable && !force) {
      const status = LexiLoopPdfIndex.needsOcr(existing) ? "needs-ocr" : "ready";
      aiContextPages = existing.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }));
      await patchPaperIndexState(paperId, {
        indexStatus: status,
        indexVersion: existing.version,
        indexedPageCount: existing.indexedPageCount,
        indexCharacterCount: existing.characterCount,
        indexTruncated: Boolean(existing.truncated),
        indexedAt: existing.indexedAt,
        indexError: ""
      }, generation);
      return existing;
    }

    await patchPaperIndexState(paperId, {
      indexStatus: "indexing",
      indexVersion: LexiLoopPdfIndex.INDEX_VERSION,
      indexedPageCount: 0,
      indexCharacterCount: 0,
      indexTruncated: false,
      indexError: ""
    }, generation);

    const pages = [];
    let characterCount = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (generation !== documentGeneration || paperId !== pdfLibraryPaperId || !pdfDocument) return null;
      const view = pageViews.get(pageNumber);
      if (!view) continue;
      const remaining = LexiLoopPdfIndex.MAX_INDEX_CHARACTERS - characterCount;
      if (remaining <= 0 || pages.length >= LexiLoopPdfIndex.MAX_INDEX_PAGES) {
        truncated = true;
        break;
      }
      const textContent = view.textContent || await view.page.getTextContent({ includeMarkedContent: true });
      view.textContent = textContent;
      const page = LexiLoopPdfIndex.pageIndexFromTextContent(textContent, view.baseViewport, pageNumber, {
        maximumCharacters: Math.min(LexiLoopPdfIndex.MAX_PAGE_CHARACTERS, remaining)
      });
      pages.push(page);
      characterCount += page.text.length;
      truncated ||= page.truncated;

      if (pageNumber === pageCount || pageNumber % 8 === 0) {
        await patchPaperIndexState(paperId, {
          indexStatus: "indexing",
          indexedPageCount: pageNumber,
          indexCharacterCount: characterCount,
          indexTruncated: truncated
        }, generation);
        await yieldToBrowser();
      }
    }

    const index = LexiLoopPdfIndex.createDocumentIndex({
      id: paperId,
      fingerprint,
      title,
      pageCount,
      pages,
      truncated
    });
    if (generation !== documentGeneration || paperId !== pdfLibraryPaperId) return null;
    await LexiLoopPdfLibrary.putPdfIndex(paperId, index);
    const status = LexiLoopPdfIndex.needsOcr(index) ? "needs-ocr" : "ready";
    aiContextPages = index.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }));
    await patchPaperIndexState(paperId, {
      indexStatus: status,
      indexVersion: index.version,
      indexedPageCount: index.indexedPageCount,
      indexCharacterCount: index.characterCount,
      indexTruncated: index.truncated,
      indexedAt: index.indexedAt,
      indexError: ""
    }, generation);
    showToast(status === "needs-ocr" ? "可选文字过少，这份 PDF 需要 OCR" : "全文索引已建立");
    return index;
  })().catch(async (error) => {
    if (generation === documentGeneration && paperId === pdfLibraryPaperId) {
      await patchPaperIndexState(paperId, {
        indexStatus: "error",
        indexError: error.message || "索引建立失败"
      }, generation).catch(() => {});
      showToast(error.message || "全文索引建立失败");
    }
    return null;
  }).finally(() => {
    if (indexBuildDocumentGeneration === generation) indexBuildPromise = null;
  });

  indexBuildDocumentGeneration = generation;
  indexBuildPromise = work;
  return work;
}

async function patchPaperIndexState(paperId, changes, generation) {
  if (generation !== documentGeneration || paperId !== pdfLibraryPaperId) return null;
  const response = await chrome.runtime.sendMessage({
    type: "PDF_LIBRARY_PATCH",
    id: paperId,
    changes
  });
  if (!response?.ok) throw new Error(response?.error || "索引状态保存失败");
  if (generation === documentGeneration && paperId === pdfLibraryPaperId) {
    currentLibraryPaper = response.paper || { ...currentLibraryPaper, ...changes };
    updateIndexButton();
  }
  return response.paper || null;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function queueLibraryProgressUpdate() {
  if (!pdfLibraryPaperId || !pdfDocument) return;
  clearTimeout(libraryProgressTimer);
  libraryProgressTimer = setTimeout(() => {
    libraryProgressTimer = null;
    flushLibraryProgress().catch((error) => console.warn("LexiLoop PDF progress save failed", error));
  }, 700);
}

async function flushLibraryProgress() {
  clearTimeout(libraryProgressTimer);
  libraryProgressTimer = null;
  if (!pdfLibraryPaperId || !pdfDocument) return;
  const status = currentLibraryPaper?.status === "finished" || currentPage >= pdfDocument.numPages
    ? "finished"
    : "reading";
  const response = await chrome.runtime.sendMessage({
    type: "PDF_LIBRARY_PATCH",
    id: pdfLibraryPaperId,
    changes: {
      currentPage,
      pageCount: pdfDocument.numPages,
      progress: currentPage / pdfDocument.numPages,
      status,
      lastOpenedAt: new Date().toISOString()
    }
  });
  if (!response?.ok) throw new Error(response?.error || "阅读进度保存失败");
  currentLibraryPaper = response.paper || currentLibraryPaper;
}

function isGenericPaperTitle(title, fileName) {
  const normalizedTitle = String(title || "").replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
  const normalizedFile = String(fileName || "").replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
  return !normalizedTitle || normalizedTitle === normalizedFile || ["pdf 文献", "pdf 文档", "未命名文献"].includes(normalizedTitle);
}

function cleanPdfMetadata(value, maximumLength) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

async function downloadPdf() {
  if (!pdfDocument) return;
  elements.downloadButton.disabled = true;
  try {
    const bytes = await pdfDocument.getData();
    const url = makePdfBlobUrl(bytes);
    const filename = safePdfFileName(sourceTitle);
    if (typeof chrome.downloads?.download === "function") {
      await chrome.downloads.download({ url, filename });
    } else {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    }
    showToast("PDF 下载已开始");
  } catch (error) {
    showToast(`下载失败：${error.message}`);
  } finally {
    elements.downloadButton.disabled = false;
  }
}

async function printPdf() {
  if (!pdfDocument || printing) return;
  printing = true;
  elements.printButton.disabled = true;
  showToast("正在准备打印页面");
  try {
    for (const view of pageViews.values()) await renderPage(view);
    document.body.classList.add("is-printing");
    requestAnimationFrame(() => window.print());
  } catch (error) {
    finishPrinting();
    showToast(`打印准备失败：${error.message}`);
  }
}

function finishPrinting() {
  printing = false;
  document.body.classList.remove("is-printing");
  elements.printButton.disabled = false;
}

function makePdfBlobUrl(bytes) {
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  return currentBlobUrl;
}

function updateControls() {
  if (!pdfDocument) return;
  elements.previousPage.disabled = currentPage <= 1;
  elements.nextPage.disabled = currentPage >= pdfDocument.numPages;
  if (readingMode === "translation") {
    elements.zoomOut.disabled = translationFontSize <= LexiLoopPdfBilingual.MIN_FONT_SIZE;
    elements.zoomIn.disabled = translationFontSize >= LexiLoopPdfBilingual.MAX_FONT_SIZE;
    elements.resetZoom.textContent = `${Math.round(translationFontSize / LexiLoopPdfBilingual.DEFAULT_FONT_SIZE * 100)}%`;
    elements.resetZoom.title = "恢复默认译文字号";
    elements.zoomOut.title = "缩小译文";
    elements.zoomIn.title = "放大译文";
  } else {
    elements.zoomOut.disabled = scale <= MIN_ZOOM;
    elements.zoomIn.disabled = scale >= MAX_ZOOM;
    elements.resetZoom.textContent = `${Math.round(scale * 100)}%`;
    elements.resetZoom.title = "在适应宽度与 100% 之间切换";
    elements.zoomOut.title = "缩小";
    elements.zoomIn.title = "放大";
  }
  updatePageTranslationControl();
}

function handleReaderShortcut(event) {
  if (!pdfDocument || event.defaultPrevented) return;
  const key = String(event.key || "").toLowerCase();
  if (event.key === "Escape" && !elements.figureLightbox.hidden) {
    event.preventDefault();
    closeFigureLightbox();
    return;
  }
  if (event.key === "Escape" && !elements.linkPreview.hidden) {
    event.preventDefault();
    hideLinkPreview();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "f") {
    if (readingMode === "translation") return;
    event.preventDefault();
    openFindBar();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "g") {
    event.preventDefault();
    if (elements.findBar.hidden) openFindBar();
    else stepFind(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Escape" && !elements.findBar.hidden) {
    event.preventDefault();
    closeFindBar();
    return;
  }
  if (event.key === "Escape" && pdfCaptureMode) {
    event.preventDefault();
    cancelPdfCaptureMode();
    showToast("已取消截图");
  } else if (event.key === "Escape" && !elements.aiConversationMenu.hidden) {
    event.preventDefault();
    setAiConversationMenuOpen(false);
  } else if (event.key === "Escape" && document.body.classList.contains("ai-panel-open") && !isEditing()) {
    event.preventDefault();
    setAiPanelOpen(false);
  } else if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    if (readingMode === "translation") changeTranslationFontSize(1);
    else changeZoom(0.15);
  } else if ((event.ctrlKey || event.metaKey) && event.key === "-") {
    event.preventDefault();
    if (readingMode === "translation") changeTranslationFontSize(-1);
    else changeZoom(-0.15);
  } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
    event.preventDefault();
    if (readingMode === "translation") {
      changeTranslationFontSize(0);
      return;
    }
    zoomFitMode = false;
    setZoom(1);
  } else if (event.key === "PageUp" && !isEditing()) {
    event.preventDefault();
    scrollToPage(currentPage - 1);
  } else if (event.key === "PageDown" && !isEditing()) {
    event.preventDefault();
    scrollToPage(currentPage + 1);
  }
}

function isEditing() {
  return ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
}

function showState(state) {
  elements.readerEmpty.hidden = state !== "empty";
  elements.readerLoading.hidden = state !== "loading";
  elements.readerError.hidden = state !== "error";
  elements.documentShell.hidden = state !== "document";
  elements.documentBar.hidden = state !== "document";
  document.body.classList.toggle("has-document", state === "document");
}

function showError(message) {
  elements.errorMessage.textContent = message;
  showState("error");
}

async function cleanupDocument() {
  await flushLibraryProgress().catch((error) => console.warn("LexiLoop PDF progress flush failed", error));
  documentGeneration += 1;
  aiAbortController?.abort();
  aiAbortController = null;
  translationRun += 1;
  resetReadingMode();
  hideLinkPreview();
  hideLinkReturn();
  closeFigureLightbox();
  releaseFigureImages();
  hideVocabTooltip();
  clearTimeout(pinchCommitTimer);
  pinchCommitTimer = 0;
  pinchScale = null;
  cancelAnimationFrame(pinchFrame);
  pinchFrame = 0;
  pinchPointer = null;
  endPinchGesture();
  textLayerFontChoices.clear();
  loadedPdfFonts.clear();
  vocabAnalysis = null;
  vocabAnalysisPromise = null;
  elements.vocabPanelBody?.replaceChildren();
  if (elements.vocabCount) elements.vocabCount.textContent = "";
  elements.pageTranslationButton.setAttribute("aria-pressed", "false");
  elements.pageTranslationButton.disabled = true;
  elements.pageTranslationLabel.textContent = "版面对照";
  cancelPdfCaptureMode();
  aiPanelResize = null;
  document.body.classList.remove("ai-panel-resizing");
  setAiPanelOpen(false, false);
  aiContextPages = [];
  aiContextPromise = null;
  aiRequestPending = false;
  elements.sendAiQuestionButton.disabled = false;
  elements.aiQuestionInput.disabled = false;
  elements.clearAiChatButton.disabled = false;
  elements.newAiChatButton.disabled = false;
  elements.aiConversationMenuButton.disabled = false;
  resetAiConversationState();
  annotations = [];
  documentKey = "";
  pdfLibraryPaperId = "";
  currentLibraryPaper = null;
  pdfEmbeddedMetadata = {};
  currentPdfFileSize = 0;
  clearTimeout(libraryProgressTimer);
  libraryProgressTimer = null;
  updateLibraryButton();
  indexBuildPromise = null;
  pendingAnnotationSelection = null;
  editingAnnotationId = "";
  hideAnnotationSelectionToolbar();
  hideTranslationUi();
  if (elements.annotationDialog.open) elements.annotationDialog.close();
  closeFindBar(false);
  renderVersion += 1;
  disconnectObservers();
  pageViews.forEach((view) => {
    view.renderTask?.cancel();
    view.textLayerTask?.cancel();
  });
  pageViews.clear();
  if (loadingTask) await loadingTask.destroy().catch(() => {});
  loadingTask = null;
  if (pdfDocument) await pdfDocument.destroy().catch(() => {});
  pdfDocument = null;
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = "";
}

function disconnectObservers() {
  pageObserver?.disconnect();
  thumbnailObserver?.disconnect();
  pageObserver = null;
  thumbnailObserver = null;
}

function handleRenderError(error) {
  if (isRenderingCancellation(error)) return;
  console.error("LexiLoop PDF render failed", error);
  showToast("当前页面渲染失败，请重试");
}

function isRenderingCancellation(error) {
  return error?.name === "RenderingCancelledException" || error?.name === "AbortException";
}

function friendlyPdfError(error) {
  const message = String(error?.message || error || "未知错误");
  if (/password/i.test(message)) return "这份 PDF 需要密码，当前阅读模式暂不支持加密文档。";
  if (/fetch|network|cors|response/i.test(message)) return "无法下载该 PDF。可先保存到本地，再使用“打开本地 PDF”。";
  return `文档解析失败：${message}`;
}

function pageNumberFromUrl(url) {
  const match = String(url || "").match(/#(?:.*&)?page=(\d+)/i);
  return Math.max(1, Number(match?.[1] || 1));
}

function stripUrlFragment(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

function safePdfFileName(value) {
  const base = String(value || "document.pdf").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return /\.pdf$/i.test(base) ? base : `${base || "document"}.pdf`;
}

function fileNameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "PDF 文档");
    return name || "PDF 文档";
  } catch {
    return "PDF 文档";
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.readerToast.textContent = message;
  elements.readerToast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.readerToast.classList.remove("is-visible"), 2200);
}

// ---- 文档内查找（⌘/Ctrl+F）----
// 用 CSS Custom Highlight API 高亮，不改动文字层 DOM，不影响划词与批注选区。

function openFindBar() {
  if (!pdfDocument) return;
  const wasHidden = elements.findBar.hidden;
  elements.findBar.hidden = false;
  elements.findButton.setAttribute("aria-expanded", "true");
  const selected = String(window.getSelection?.() || "").replace(/\s+/g, " ").trim();
  if (selected && selected.length <= 80 && selected !== elements.findInput.value) {
    elements.findInput.value = selected;
    runFind();
  } else if (wasHidden && elements.findInput.value.trim()) {
    runFind();
  }
  elements.findInput.focus();
  elements.findInput.select();
}

function closeFindBar(restoreFocus = true) {
  findState.token += 1;
  clearTimeout(findState.inputTimer);
  elements.findBar.hidden = true;
  elements.findButton.setAttribute("aria-expanded", "false");
  clearFindHighlights();
  if (restoreFocus && document.activeElement === elements.findInput) elements.pageStage.focus({ preventScroll: true });
}

async function runFind() {
  const token = ++findState.token;
  findState.pendingReveal = false;
  const pattern = LexiLoopPdfFind.buildPattern(elements.findInput.value, { caseSensitive: findState.caseSensitive });
  findState.pattern = pattern;
  findState.pageCounts = new Map();
  findState.total = 0;
  findState.index = -1;
  clearFindHighlights();
  if (!pattern || !pdfDocument) { renderFindCount(); return; }
  elements.findBar.classList.add("is-searching");
  renderFindCount();
  let jumped = false;
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const view = pageViews.get(pageNumber);
    if (!view) continue;
    try {
      if (!view.textLayerContent) {
        view.textLayerContent = await view.page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
      }
    } catch { continue; }
    if (token !== findState.token) return;
    const count = LexiLoopPdfFind.findAll(LexiLoopPdfFind.pageText(view.textLayerContent), pattern).length;
    findState.pageCounts.set(pageNumber, count);
    findState.total += count;
    // 当前页及之后一出现匹配就先跳过去，不必等整份文档扫完。
    if (!jumped && count && pageNumber >= currentPage) {
      jumped = true;
      findState.index = LexiLoopPdfFind.globalIndex(findState.pageCounts, pageNumber, 0);
      goToFindMatch(findState.index);
    }
    if (pageNumber % 8 === 0) renderFindCount();
  }
  elements.findBar.classList.remove("is-searching");
  if (!jumped && findState.total) {
    findState.index = LexiLoopPdfFind.firstIndexFromPage(findState.pageCounts, currentPage);
    goToFindMatch(findState.index);
  }
  renderFindCount();
  scheduleFindPaint();
}

function renderFindCount() {
  const searching = elements.findBar.classList.contains("is-searching");
  const hasQuery = Boolean(findState.pattern);
  elements.findBar.classList.toggle("has-no-match", hasQuery && !searching && !findState.total);
  elements.findCount.textContent = !hasQuery ? ""
    : findState.total ? `${findState.index + 1}/${findState.total}${searching ? "+" : ""}`
    : searching ? "搜索中…" : "无结果";
  elements.findPrevious.disabled = !findState.total;
  elements.findNext.disabled = !findState.total;
}

function stepFind(delta) {
  if (!findState.total) {
    if (elements.findInput.value.trim() && !findState.pattern) runFind();
    return;
  }
  findState.index = (findState.index + delta + findState.total) % findState.total;
  goToFindMatch(findState.index);
}

async function goToFindMatch(index) {
  const target = LexiLoopPdfFind.resolveIndex(findState.pageCounts, index);
  renderFindCount();
  if (!target) return;
  const view = pageViews.get(target.pageNumber);
  if (!view) return;
  const token = findState.token;
  globalThis.CSS?.highlights?.delete(FIND_CURRENT_HIGHLIGHT);
  if (view.renderedScale !== scale) {
    findState.pendingReveal = true;
    scrollToPage(target.pageNumber, false);
    try { await renderPage(view); } catch { return; }
  }
  if (token !== findState.token || index !== findState.index) return;
  // 渲染可能被缩放打断（自动适应宽度），此时等页面按新缩放渲染完由 scheduleFindPaint 接着定位。
  if (view.renderedScale !== scale) return;
  const current = paintFindHighlights();
  if (current) {
    revealFindRange(current);
  } else {
    // 页面还没渲染完（例如刚好赶上缩放重排）：先跳到该页，渲染完成后再滚到匹配处。
    findState.pendingReveal = true;
    scrollToPage(target.pageNumber, false);
  }
}

function revealFindRange(range) {
  findState.pendingReveal = false;
  const rect = range.getBoundingClientRect();
  const stage = elements.pageStage.getBoundingClientRect();
  if (rect.top < stage.top + 60 || rect.bottom > stage.bottom - 80) {
    elements.pageStage.scrollTo({ top: elements.pageStage.scrollTop + rect.top - stage.top - stage.height / 3, behavior: "instant" });
  }
}

function scheduleFindPaint() {
  if (!findState.pattern || elements.findBar.hidden) return;
  cancelAnimationFrame(findState.paintFrame);
  findState.paintFrame = requestAnimationFrame(() => {
    const current = paintFindHighlights();
    if (current && findState.pendingReveal) revealFindRange(current);
  });
}

// 为所有已渲染页面的匹配建立高亮，返回当前匹配的 Range。
function paintFindHighlights() {
  if (!globalThis.CSS?.highlights || typeof Highlight !== "function" || !findState.pattern) return null;
  const target = LexiLoopPdfFind.resolveIndex(findState.pageCounts, findState.index);
  const ranges = [];
  let current = null;
  pageViews.forEach((view, pageNumber) => {
    // 只用按当前缩放渲染完成的文字层；缩放后尚未重绘的旧文字层位置已失效。
    if (!findState.pageCounts.get(pageNumber) || view.renderedScale !== scale || !view.textLayer.firstChild) return;
    const pageRanges = findRangesInTextLayer(view.textLayer, findState.pattern);
    ranges.push(...pageRanges);
    if (target?.pageNumber === pageNumber) current = pageRanges[target.ordinal] || null;
  });
  CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...ranges));
  if (current) CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, new Highlight(current));
  else CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
  return current;
}

function findRangesInTextLayer(container, pattern) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const text = nodes.map((node) => node.data).join("");
  return LexiLoopPdfFind.findAll(text, pattern).map(({ start, end }) => {
    const located = LexiLoopPdfFind.locate(nodes, start, end);
    if (!located) return null;
    const range = document.createRange();
    range.setStart(located.from.node, located.from.offset);
    range.setEnd(located.to.node, located.to.offset);
    return range;
  }).filter(Boolean);
}

function clearFindHighlights() {
  cancelAnimationFrame(findState.paintFrame);
  globalThis.CSS?.highlights?.delete(FIND_HIGHLIGHT);
  globalThis.CSS?.highlights?.delete(FIND_CURRENT_HIGHLIGHT);
}

// ==================== 原文 / 译文对照阅读（参考 Reader） ====================
// 译文按段落重排在右侧阅读栏；两栏以「基准线所在段落 + 段内位置」互相对齐，
// 只有最近收到用户输入的一栏会带动另一栏，避免程序滚动来回触发。

function setReadingMode(mode) {
  const next = LexiLoopPdfBilingual.normalizeMode(mode);
  if (next !== "source" && !pdfDocument) return;
  if (next === readingMode) return;
  const previous = readingMode;
  const anchorPage = currentPage;
  // 译文栏宽度变化会让排版高度改变：切换前记下正在读的段落，切换后对回去
  const translationAnchor = previous !== "source" ? translationAnchorAtReadingLine() : null;
  readingMode = next;
  translationMode = next !== "source";
  document.body.dataset.readingMode = next;
  elements.translationPane.hidden = next === "source";
  elements.paneDivider.hidden = next !== "parallel";
  // 对照阅读时收起版面覆盖式的单页译文，避免两种译文同时出现
  if (translationMode) pageViews.forEach((view) => view.spread.classList.remove("has-page-translation"));
  clearLinkedBlock();
  hideBlockTools();
  updateReadingModeSwitch();
  applyPaneLayout();
  if (next === "source") {
    translationRun += 1; // 停止排队翻译；已译好的页保留，再切回来直接显示
    translationPaused = false;
    translationOnlyPage = 0;
  } else {
    ensureTranslationDocument();
    scheduleTranslationQueue();
  }
  updateTranslationProgressLabel();
  updateControls();
  requestAnimationFrame(() => {
    if (next === "translation") {
      if (translationAnchor) scrollTranslationToAnchor(translationAnchor);
      else scrollTranslationToPage(anchorPage);
      return;
    }
    if (previous === "translation") {
      // 原文栏刚从隐藏恢复，滚动位置已丢失：按译文栏当时读到的位置对回去
      if (translationAnchor) {
        scrollToPage(translationAnchor.page, false);
        syncSourceToTranslation(translationAnchor);
      } else {
        scrollToPage(anchorPage, false);
      }
    }
    if (next === "parallel" && previous === "translation" && translationAnchor) {
      scrollTranslationToAnchor(translationAnchor);
      paneLeader = "translation";
    } else if (next === "parallel") {
      paneLeader = "source";
      syncTranslationToSource();
    }
  });
}

function resetReadingMode() {
  readingMode = "source";
  translationMode = false;
  paneLeader = "source";
  translationQueueRun = -1;
  translationPaused = false;
  translationOnlyPage = 0;
  linkedBlockKey = "";
  document.body.dataset.readingMode = "source";
  elements.translationPane.hidden = true;
  elements.paneDivider.hidden = true;
  elements.translationDoc.replaceChildren();
  delete elements.translationDoc.dataset.generation;
  sourceLinkBoxes.forEach((box) => box.remove());
  sourceLinkBoxes = [];
  hideBlockTools();
  updateReadingModeSwitch();
  applyPaneLayout();
  updateTranslationProgressLabel();
}

function updateReadingModeSwitch() {
  const index = LexiLoopPdfBilingual.MODES.indexOf(readingMode);
  elements.readingModeSwitch.style.setProperty("--seg-index", String(Math.max(0, index)));
  document.querySelectorAll("[data-reading-mode-option]").forEach((button) => {
    const active = button.dataset.readingModeOption === readingMode;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function handleReadingModeKey(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const modes = LexiLoopPdfBilingual.MODES;
  let index = modes.indexOf(readingMode);
  if (event.key === "ArrowLeft") index = (index + modes.length - 1) % modes.length;
  else if (event.key === "ArrowRight") index = (index + 1) % modes.length;
  else if (event.key === "Home") index = 0;
  else index = modes.length - 1;
  setReadingMode(modes[index]);
  elements.readingModeSwitch.querySelector(`[data-reading-mode-option="${modes[index]}"]`)?.focus();
}

// ---- 译文栏内容 ----

function ensureTranslationDocument() {
  const doc = elements.translationDoc;
  if (doc.dataset.generation === String(documentGeneration) && doc.childElementCount === pageViews.size) return;
  const fragment = document.createDocumentFragment();
  pageViews.forEach((view) => {
    const section = document.createElement("section");
    section.className = "tp-page";
    section.dataset.page = String(view.pageNumber);
    section.setAttribute("aria-label", `第 ${view.pageNumber} 页译文`);
    const head = document.createElement("header");
    head.className = "tp-page-head";
    const label = document.createElement("span");
    label.textContent = `第 ${view.pageNumber} 页`;
    head.append(label);
    const body = document.createElement("div");
    body.className = "tp-page-body";
    section.append(head, body);
    view.translationSection = section;
    fragment.append(section);
  });
  doc.replaceChildren(fragment);
  doc.dataset.generation = String(documentGeneration);
  pageViews.forEach(renderTranslationSection);
}

function renderTranslationSection(view) {
  const section = view?.translationSection;
  if (!section || !section.isConnected) return;
  const body = section.querySelector(".tp-page-body");
  const state = view.translationState || "idle";
  section.dataset.state = state;

  if (state === "complete") {
    const layout = view.translationLayout || [];
    const flow = view.translationFlow || layout.map((_, index) => ({ type: "text", index }));
    const fragment = document.createDocumentFragment();
    // 插图按「原文正文字号 → 译文字号」等比缩放：公式与译文文字一样大，插图随字号一起放大缩小
    const bodySizes = layout.filter((block) => (block.kind || "body") === "body").map((block) => Number(block.lineHeight) || 0).filter(Boolean).sort((a, b) => a - b);
    const bodySize = bodySizes[Math.floor(bodySizes.length / 2)] || 10;
    for (const entry of flow) {
      if (entry.type === "figure") {
        const figure = view.translationFigures?.[entry.index];
        if (!figure?.url) continue;
        const node = document.createElement("figure");
        node.className = `tp-block tp-figure is-${figure.kind || "figure"}`;
        node.dataset.page = String(view.pageNumber);
        node.dataset.ref = `f${entry.index}`;
        const image = document.createElement("img");
        image.src = figure.url;
        image.alt = figure.kind === "equation" ? `第 ${view.pageNumber} 页公式` : `第 ${view.pageNumber} 页插图`;
        image.draggable = false;
        image.decoding = "async";
        image.style.width = `min(100%, ${(figure.width / bodySize).toFixed(2)}em)`;
        node.append(image);
        fragment.append(node);
        continue;
      }
      const block = layout[entry.index];
      // 被接续的后半句已经并入开头段落的整句译文
      if (!block || Number.isInteger(block.continuationOf) || block.carryFrom) continue;
      const tag = block.kind === "title" ? "h2" : block.kind === "heading" ? "h3" : "p";
      const node = document.createElement(tag);
      node.className = `tp-block is-${block.kind || "body"}`;
      node.dataset.page = String(view.pageNumber);
      node.dataset.ref = `t${entry.index}`;
      const inline = block.inline || { text: block.joinedText || block.text, tokens: [] };
      if (block.failed) {
        node.classList.add("is-failed");
        node.lang = "en";
        node.innerHTML = LexiLoopPdfInline.renderInline(inline.text, inline.tokens, { html: true, chinese: false });
        node.title = "这一段翻译失败，暂时显示原文";
      } else {
        node.lang = LexiLoopPdfBilingual.isChineseText(block.translated) ? "zh-CN" : "en";
        node.innerHTML = LexiLoopPdfInline.renderInline(block.translatedRaw ?? block.translated, inline.tokens, { html: true });
      }
      fragment.append(node);
    }
    view.flowGeometry = null;
    if (!fragment.childNodes.length) {
      const note = document.createElement("p");
      note.className = "tp-note";
      note.textContent = "本页没有需要翻译的正文";
      body.replaceChildren(note);
      return;
    }
    body.replaceChildren(fragment);
    // 骨架换成真实译文后高度改变：正在读的这几页重新对齐一次
    if (readingMode === "parallel" && paneLeader === "source" && Math.abs(view.pageNumber - currentPage) <= 1) {
      requestAnimationFrame(syncTranslationToSource);
    }
    return;
  }

  if (state === "error") {
    const box = document.createElement("div");
    box.className = "tp-error";
    const message = document.createElement("span");
    message.textContent = view.translationStatus.textContent || "翻译暂时不可用";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "tp-retry";
    retry.textContent = "重试";
    retry.addEventListener("click", () => retryPageTranslation(view));
    box.append(message, retry);
    body.replaceChildren(box);
    return;
  }

  // 等待 / 翻译中：骨架占位，高度接近一页译文，滚动条长度更贴近实际
  let pending = body.firstElementChild;
  if (!pending?.classList.contains("tp-pending")) {
    pending = document.createElement("div");
    pending.className = "tp-pending";
    for (let index = 0; index < 6; index += 1) pending.append(document.createElement("i"));
    const label = document.createElement("span");
    pending.append(label);
    body.replaceChildren(pending);
  }
  pending.classList.toggle("is-loading", state === "loading");
  pending.querySelector("span").textContent = state === "loading" ? "正在翻译本页…" : "等待翻译";
}

function retryPageTranslation(view) {
  if (!view || view.translationState === "loading") return;
  translationPaused = false;
  translationOnlyPage = 0;
  setTranslationPageStatus(view, "idle", "等待翻译");
  scheduleTranslationQueue(view.pageNumber);
}

function toggleTranslationPause() {
  if (!translationMode || !pdfDocument) return;
  translationPaused = !translationPaused;
  translationOnlyPage = 0;
  if (!translationPaused) scheduleTranslationQueue(currentPage);
  updateTranslationProgressLabel();
  showToast(translationPaused ? "翻译已暂停" : "继续翻译后续页面");
}

function translateOnlyCurrentPage() {
  if (!translationMode || !pdfDocument) return;
  const view = pageViews.get(currentPage);
  if (!view) return;
  translationOnlyPage = currentPage;
  translationPaused = false;
  if (view.translationState === "error") setTranslationPageStatus(view, "idle", "等待翻译");
  if (view.translationState === "complete") {
    translationPaused = true;
    translationOnlyPage = 0;
    updateTranslationProgressLabel();
    showToast(`第 ${currentPage} 页已经翻译过，后续已暂停`);
    return;
  }
  scheduleTranslationQueue(currentPage);
  updateTranslationProgressLabel();
  showToast(`只翻译第 ${currentPage} 页，完成后暂停`);
}

// ---- 排队翻译：从当前页附近开始，读到哪里优先翻到哪里，再依次翻完全文 ----

function scheduleTranslationQueue(priorityPage = 0) {
  if (!translationMode || !pdfDocument) return;
  if (priorityPage) translationQueuePriority = priorityPage;
  if (translationQueueRun === translationRun) return;
  const run = translationRun;
  translationQueueRun = run;
  runTranslationQueue(run)
    .catch((error) => console.warn("LexiLoop translation queue failed", error))
    .finally(() => {
      if (translationQueueRun === run) translationQueueRun = -1;
      updateTranslationProgressLabel();
    });
}


async function runTranslationQueue(run) {
  let consecutiveErrors = 0;
  while (run === translationRun && translationMode && pdfDocument) {
    const priority = translationQueuePriority;
    translationQueuePriority = 0;
    const pageNumber = LexiLoopPdfBilingual.translationTarget({
      paused: translationPaused,
      onlyPage: translationOnlyPage,
      priority,
      currentPage,
      totalPages: pdfDocument.numPages,
      getState: (page) => pageViews.get(page)?.translationState || "complete"
    });
    if (!pageNumber) {
      if (translationOnlyPage) {
        translationPaused = true;
        translationOnlyPage = 0;
        updateTranslationProgressLabel();
      }
      return;
    }
    const view = pageViews.get(pageNumber);
    let result = "";
    try {
      result = await translatePageView(view, run);
      consecutiveErrors = result === "error" ? consecutiveErrors + 1 : 0;
    } catch (error) {
      if (run !== translationRun) return;
      setTranslationPageStatus(view, "error", error.message || "翻译暂时不可用");
      consecutiveErrors += 1;
    }
    if (result === "cancelled") return;
    // 连续两页失败多半是服务不可用（未配置密钥、网络断开）：先停下，避免逐页重复报错
    if (consecutiveErrors >= 2) {
      showToast("翻译服务暂时不可用，已暂停。可在失败的页点「重试」");
      return;
    }
  }
}

function updateTranslationProgressLabel() {
  const label = elements.translationProgress;
  if (!translationMode || !pdfDocument) {
    label.hidden = true;
    return;
  }
  const total = pdfDocument.numPages;
  let done = 0;
  let failed = 0;
  let loading = false;
  pageViews.forEach((view) => {
    if (view.translationState === "complete") done += 1;
    else if (view.translationState === "error") failed += 1;
    else if (view.translationState === "loading") loading = true;
  });
  const busy = !translationPaused && (loading || translationQueueRun === translationRun);
  label.hidden = false;
  label.classList.toggle("is-busy", busy);
  label.classList.toggle("is-error", failed > 0 && !busy);
  label.classList.toggle("is-done", done >= total);
  label.textContent = done >= total
    ? "翻译完成"
    : `${translationPaused ? "已暂停" : busy ? "翻译中" : "已译"} ${done}/${total}${failed ? ` · ${failed} 页失败` : ""}`;
  label.title = translationPaused
    ? "翻译已暂停。点「继续」从当前页接着翻，或点「只翻本页」。"
    : done >= total ? "全部页面已翻译" : `已翻译 ${done} 页，共 ${total} 页`;
  if (elements.translationPauseButton) {
    elements.translationPauseButton.hidden = done >= total;
    elements.translationPauseButton.textContent = translationPaused ? "继续" : "暂停";
    elements.translationPauseButton.title = translationPaused ? "从当前页继续翻译后面的页" : "译完正在翻的这一页后停下";
  }
  if (elements.translationPageButton) {
    elements.translationPageButton.hidden = done >= total;
    elements.translationPageButton.textContent = `只翻第 ${currentPage} 页`;
    elements.translationPageButton.title = "只翻译当前这一页，完成后不再继续";
  }
}

// ---- 两栏滚动同步 ----

function sourceAnchorAtReadingLine() {
  const stageRect = elements.pageStage.getBoundingClientRect();
  if (!stageRect.height || !pageViews.size) return null;
  const lineY = stageRect.top + stageRect.height * READING_LINE;
  const views = [...pageViews.values()];
  let low = 0;
  let high = views.length - 1;
  let found = views.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (views[middle].element.getBoundingClientRect().bottom > lineY) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const view = views[found];
  const rect = view.element.getBoundingClientRect();
  if (!rect.height || !rect.width) return null;
  const fraction = clamp((lineY - rect.top) / rect.height, 0, 1);
  // 横向参考鼠标所在的栏（读双栏论文时鼠标通常停在正在读的那栏），没有鼠标时取视口中线
  const pointerX = pagePointerX ?? stageRect.left + stageRect.width / 2;
  return {
    view,
    fraction,
    baseX: clamp((pointerX - rect.left) / rect.width, 0, 1) * view.baseViewport.width,
    baseY: fraction * view.baseViewport.height
  };
}

function restoreSourceAnchor(anchor) {
  const stage = elements.pageStage;
  const stageRect = stage.getBoundingClientRect();
  const rect = anchor.view.element.getBoundingClientRect();
  const y = rect.top + anchor.fraction * rect.height;
  stage.scrollTo({ top: stage.scrollTop + y - (stageRect.top + stageRect.height * READING_LINE), behavior: "instant" });
}

// 译文栏里每一项（文字段落 t<n> / 插图 f<n>）的引用
function parseRef(ref) {
  const match = /^([tf])(\d+)$/.exec(String(ref || ""));
  return match ? { type: match[1] === "t" ? "text" : "figure", index: Number(match[2]) } : null;
}

// 被接续的段落指向整句的开头段落（可能在上一页）
function translationRoot(pageNumber, index) {
  const block = pageViews.get(pageNumber)?.translationLayout?.[index];
  if (block && Number.isInteger(block.continuationOf)) return { page: pageNumber, index: block.continuationOf };
  if (block?.carryFrom) return { ...block.carryFrom };
  return { page: pageNumber, index };
}

function translationNode(pageNumber, ref) {
  return pageViews.get(pageNumber)?.translationSection?.querySelector(`.tp-block[data-ref="${ref}"]`) || null;
}

// 原文页上所有可对应的区域：文字段落 + 插图
function flowGeometry(view) {
  if (view?.translationState !== "complete") return [];
  if (view.flowGeometry) return view.flowGeometry;
  const entries = [];
  (view.translationLayout || []).forEach((block, index) => entries.push({ ref: `t${index}`, x: block.x, top: block.top, width: block.width, height: block.height }));
  (view.translationFigures || []).forEach((figure, index) => {
    if (figure.url) entries.push({ ref: `f${index}`, x: figure.x, top: figure.top, width: figure.width, height: figure.height });
  });
  view.flowGeometry = entries;
  return entries;
}

// 原文上的一处 → 译文栏里的节点与节点内比例
function translationTargetFor(view, ref, fraction) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  if (parsed.type === "figure") return { node: translationNode(view.pageNumber, ref), fraction };
  const root = translationRoot(view.pageNumber, parsed.index);
  const rootBlock = pageViews.get(root.page)?.translationLayout?.[root.index];
  const value = rootBlock?.segments ? LexiLoopPdfBilingual.rootFraction(rootBlock.segments, view.pageNumber, parsed.index, fraction) : fraction;
  return { node: translationNode(root.page, `t${root.index}`), fraction: value };
}

// 译文栏的一处 → 原文页与页内纵坐标
function sourcePointFor(anchor) {
  const view = pageViews.get(anchor?.page);
  if (!view) return null;
  const parsed = parseRef(anchor.ref);
  if (parsed?.type === "figure") {
    const figure = view.translationFigures?.[parsed.index];
    if (figure) return { view, baseY: figure.top + figure.height * anchor.fraction };
  } else if (parsed) {
    const block = view.translationLayout?.[parsed.index];
    if (block?.segments) {
      const segment = LexiLoopPdfBilingual.segmentAt(block.segments, anchor.fraction);
      let targetView = pageViews.get(segment.page) || view;
      let index = segment.index;
      if (!Number.isInteger(index)) {
        // 跨页的后半句：在下一页里找指向本段的段落
        index = targetView.translationLayout?.findIndex((item) => item.carryFrom?.page === view.pageNumber && item.carryFrom.index === parsed.index) ?? -1;
        if (index < 0) return { view: targetView, baseY: 0 };
      }
      const tail = targetView.translationLayout?.[index];
      if (tail) return { view: targetView, baseY: tail.top + tail.height * segment.fraction };
      targetView = view;
    }
    if (block) return { view, baseY: block.top + block.height * anchor.fraction };
  }
  return { view, baseY: anchor.fraction * view.baseViewport.height };
}

// 原文上一处对应的所有框：整句的各段（可能跨栏、跨页）或插图
function sourceBoxesFor(pageNumber, ref) {
  const view = pageViews.get(pageNumber);
  const parsed = parseRef(ref);
  if (!view || !parsed) return [];
  if (parsed.type === "figure") {
    const figure = view.translationFigures?.[parsed.index];
    return figure ? [{ view, rect: figure }] : [];
  }
  const root = translationRoot(pageNumber, parsed.index);
  const rootView = pageViews.get(root.page);
  const rootBlock = rootView?.translationLayout?.[root.index];
  if (!rootBlock) return [];
  if (!rootBlock.segments) return [{ view: rootView, rect: rootBlock }];
  return rootBlock.segments.map((segment) => {
    const segmentView = pageViews.get(segment.page);
    let index = segment.index;
    if (!Number.isInteger(index)) {
      index = segmentView?.translationLayout?.findIndex((item) => item.carryFrom?.page === root.page && item.carryFrom.index === root.index) ?? -1;
    }
    const rect = segmentView?.translationLayout?.[index];
    return rect ? { view: segmentView, rect } : null;
  }).filter(Boolean);
}

function translationAnchorAtReadingLine() {
  const pane = elements.translationScroll;
  const paneRect = pane.getBoundingClientRect();
  const sections = elements.translationDoc.children;
  if (!paneRect.height || !sections.length) return null;
  const lineY = paneRect.top + paneRect.height * READING_LINE;
  let low = 0;
  let high = sections.length - 1;
  let found = sections.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sections[middle].getBoundingClientRect().bottom > lineY) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const section = sections[found];
  const page = Number(section.dataset.page);
  const blocks = section.querySelectorAll(".tp-block");
  for (const node of blocks) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= lineY) continue;
    return { page, ref: node.dataset.ref, fraction: clamp((lineY - rect.top) / Math.max(1, rect.height), 0, 1) };
  }
  if (blocks.length) {
    // 基准线已过本页最后一项：对齐到最后一项的末尾
    return { page, ref: blocks[blocks.length - 1].dataset.ref, fraction: 1 };
  }
  const rect = section.getBoundingClientRect();
  return { page, ref: null, fraction: clamp((lineY - rect.top) / Math.max(1, rect.height), 0, 1) };
}

function syncTranslationToSource() {
  if (readingMode !== "parallel") return;
  const stage = elements.pageStage;
  const pane = elements.translationScroll;
  // 原文滚到最顶 / 最底时，译文也停在最顶 / 最底
  if (stage.scrollTop <= 1) {
    if (pane.scrollTop > 0) pane.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1) {
    pane.scrollTo({ top: pane.scrollHeight, behavior: "instant" });
    return;
  }
  const anchor = sourceAnchorAtReadingLine();
  const section = anchor?.view.translationSection;
  if (!section) return;
  let target = section;
  let fraction = anchor.fraction;
  const geometry = flowGeometry(anchor.view);
  if (geometry.length) {
    const pick = LexiLoopPdfBilingual.pickBlockAt(geometry, anchor.baseX, anchor.baseY);
    const mapped = pick && translationTargetFor(anchor.view, geometry[pick.index].ref, pick.fraction);
    if (mapped?.node) {
      target = mapped.node;
      fraction = mapped.fraction;
    }
  }
  const paneRect = pane.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const delta = rect.top + rect.height * fraction - (paneRect.top + paneRect.height * READING_LINE);
  if (Math.abs(delta) >= 1) pane.scrollTo({ top: pane.scrollTop + delta, behavior: "instant" });
}

function syncSourceToTranslation(anchor) {
  const point = sourcePointFor(anchor);
  if (!point) return;
  const stage = elements.pageStage;
  const stageRect = stage.getBoundingClientRect();
  const pageRect = point.view.element.getBoundingClientRect();
  if (!pageRect.height || !stageRect.height) return;
  const targetY = pageRect.top + (point.baseY / point.view.baseViewport.height) * pageRect.height;
  const delta = targetY - (stageRect.top + stageRect.height * READING_LINE);
  if (Math.abs(delta) >= 1) stage.scrollTo({ top: stage.scrollTop + delta, behavior: "instant" });
}

function handleTranslationScroll() {
  hideBlockTools();
  hideLinkPreview();
  window.cancelAnimationFrame(translationScrollFrame);
  translationScrollFrame = window.requestAnimationFrame(() => {
    if (!translationMode || !pdfDocument) return;
    const anchor = translationAnchorAtReadingLine();
    if (!anchor) return;
    if (readingMode === "translation") {
      if (anchor.page !== currentPage) setCurrentPage(anchor.page);
      return;
    }
    if (paneLeader !== "translation") return;
    const pane = elements.translationScroll;
    const stage = elements.pageStage;
    if (pane.scrollTop <= 1) stage.scrollTo({ top: 0, behavior: "instant" });
    else if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) stage.scrollTo({ top: stage.scrollHeight, behavior: "instant" });
    else syncSourceToTranslation(anchor);
  });
}

function scrollTranslationToPage(pageNumber) {
  const section = pageViews.get(pageNumber)?.translationSection;
  if (!section) return;
  const pane = elements.translationScroll;
  const top = pane.scrollTop + section.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
  pane.scrollTo({ top: Math.max(0, top), behavior: "instant" });
}

function scrollTranslationToAnchor(anchor, line = READING_LINE, smooth = false) {
  const section = pageViews.get(anchor?.page)?.translationSection;
  if (!section) return;
  const target = (anchor.ref && section.querySelector(`.tp-block[data-ref="${anchor.ref}"]`)) || section;
  const pane = elements.translationScroll;
  const paneRect = pane.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const top = pane.scrollTop + rect.top + rect.height * anchor.fraction - (paneRect.top + paneRect.height * line);
  if (smooth) animateScrollTo(pane, top);
  else pane.scrollTo({ top, behavior: "instant" });
}

// ---- 段落悬停联动 ----

function handleSourcePointerMove(event) {
  pagePointerX = event.clientX;
  if (readingMode !== "parallel" || event.buttons) return;
  const pageElement = event.target.closest?.(".original-page");
  const { clientX, clientY } = event;
  window.cancelAnimationFrame(paneHoverFrame);
  paneHoverFrame = window.requestAnimationFrame(() => {
    const view = pageElement ? pageViews.get(Number(pageElement.dataset.pageNumber)) : null;
    const geometry = flowGeometry(view);
    if (!geometry.length) {
      clearLinkedBlock();
      return;
    }
    const rect = pageElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * view.baseViewport.width;
    const y = ((clientY - rect.top) / rect.height) * view.baseViewport.height;
    const pick = LexiLoopPdfBilingual.pickBlockAt(geometry, x, y, 3);
    if (pick?.inside) setLinkedBlock(view.pageNumber, geometry[pick.index].ref);
    else clearLinkedBlock();
  });
}

function handleTranslationPointerMove(event) {
  if (event.buttons) return;
  const node = event.target.closest?.(".tp-block");
  if (!node) {
    clearLinkedBlock();
    hideBlockTools();
    return;
  }
  setLinkedBlock(Number(node.dataset.page), node.dataset.ref);
  showBlockTools(node);
}

function setLinkedBlock(pageNumber, ref) {
  const key = `${pageNumber}:${ref}`;
  if (key === linkedBlockKey) return;
  clearLinkedBlock();
  linkedBlockKey = key;
  const view = pageViews.get(pageNumber);
  const parsed = parseRef(ref);
  if (view && parsed) {
    const target = parsed.type === "figure"
      ? translationNode(pageNumber, ref)
      : (() => {
        const root = translationRoot(pageNumber, parsed.index);
        return translationNode(root.page, `t${root.index}`);
      })();
    target?.classList.add("is-linked");
  }
  if (readingMode === "parallel") showSourceBoxes(sourceBoxesFor(pageNumber, ref));
}

function clearLinkedBlock() {
  if (!linkedBlockKey) return;
  linkedBlockKey = "";
  elements.translationDoc.querySelectorAll(".tp-block.is-linked").forEach((node) => node.classList.remove("is-linked"));
  sourceLinkBoxes.forEach((box) => box.classList.remove("is-visible"));
}

// 在原文页上框出对应区域（整句跨栏、跨页时有多个框）；用百分比定位，缩放后不需要重新计算
function showSourceBoxes(targets, flash = false) {
  sourceLinkBoxes.forEach((box) => box.classList.remove("is-visible", "is-flash"));
  targets.forEach(({ view, rect }, index) => {
    let box = sourceLinkBoxes[index];
    if (!box) {
      box = document.createElement("div");
      box.className = "source-link-box";
      box.setAttribute("aria-hidden", "true");
      sourceLinkBoxes.push(box);
    }
    if (box.parentElement !== view.element) view.element.insertBefore(box, view.textLayer);
    const { width, height } = view.baseViewport;
    const pad = 3;
    Object.assign(box.style, {
      left: `${((rect.x - pad) / width) * 100}%`,
      top: `${((rect.top - pad) / height) * 100}%`,
      width: `${((rect.width + pad * 2) / width) * 100}%`,
      height: `${((rect.height + pad * 2) / height) * 100}%`
    });
    box.classList.add("is-visible");
    if (flash) {
      void box.offsetWidth;
      box.classList.add("is-flash");
    }
  });
}

function handleTranslationClick(event) {
  const link = event.target.closest?.(".tp-link");
  if (link) {
    activateLinkElement(event, link);
    return;
  }
  const node = event.target.closest?.(".tp-block");
  if (!node || event.target.closest("button")) return;
  if (node.classList.contains("tp-figure")) {
    openFigureLightbox(Number(node.dataset.page), node.dataset.ref, node.querySelector("img"));
    return;
  }
  if (readingMode !== "parallel") return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && node.contains(selection.anchorNode)) return;
  focusSourceBlock(Number(node.dataset.page), node.dataset.ref);
}

// 把原文对应区域滚到原文栏中央并闪烁标出
function focusSourceBlock(pageNumber, ref) {
  const targets = sourceBoxesFor(pageNumber, ref);
  if (!targets.length) return;
  const { view, rect } = targets[0];
  paneLeader = "translation"; // 原文栏的这次滚动不反过来带动译文
  const stage = elements.pageStage;
  const stageRect = stage.getBoundingClientRect();
  const pageRect = view.element.getBoundingClientRect();
  const centerY = pageRect.top + ((rect.top + Math.min(rect.height, stageRect.height * 0.6) / 2) / view.baseViewport.height) * pageRect.height;
  const centerX = pageRect.left + ((rect.x + rect.width / 2) / view.baseViewport.width) * pageRect.width;
  animateScrollTo(
    stage,
    stage.scrollTop + centerY - (stageRect.top + stageRect.height / 2),
    stage.scrollWidth > stage.clientWidth ? stage.scrollLeft + centerX - (stageRect.left + stageRect.width / 2) : stage.scrollLeft
  );
  renderPage(view).catch(handleRenderError);
  showSourceBoxes(targets, true);
}

// ---- 反向联动：在原文上点击一段 → 译文栏滚到对应段落并闪烁 ----

function handleSourceClickStart(event) {
  sourceClickStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
}

function handleSourceClick(event) {
  const start = sourceClickStart;
  sourceClickStart = null;
  if (readingMode !== "parallel" || !pdfDocument || pdfCaptureMode) return;
  if (event.button !== 0) return;
  // 拖选文字、点链接、点批注标记时不搬动译文位置
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
  if (event.target.closest?.(".pdf-link, .pdf-note-marker, .annotation-selection-toolbar, .annotation-dialog, .source-link-box, .vocab-mark")) return;
  const pageElement = event.target.closest?.(".original-page");
  if (!pageElement) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) return;
  const view = pageViews.get(Number(pageElement.dataset.pageNumber));
  const geometry = flowGeometry(view);
  if (!geometry.length) return;
  const rect = pageElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = ((event.clientX - rect.left) / rect.width) * view.baseViewport.width;
  const y = ((event.clientY - rect.top) / rect.height) * view.baseViewport.height;
  const pick = LexiLoopPdfBilingual.pickBlockAt(geometry, x, y, 3);
  if (pick?.inside) focusTranslationBlock(view.pageNumber, geometry[pick.index].ref, pick.fraction);
}

// 与 focusSourceBlock 对称：原文一处 → 译文栏对应段落（整句跨栏、跨页时落到开头那段）
function focusTranslationBlock(pageNumber, ref, fraction) {
  const mapped = translationTargetFor(pageViews.get(pageNumber), ref, fraction);
  if (!mapped?.node) return;
  // 这次由原文发起：译文栏的滚动不要反过来把原文拽走
  paneLeader = "source";
  translationFocusLockUntil = performance.now() + 700;
  hideBlockTools();
  setLinkedBlock(pageNumber, ref);
  scrollTranslationNodeToLine(mapped.node, mapped.fraction, true);
  flashTranslationNode(mapped.node);
}

function scrollTranslationNodeToLine(node, fraction, smooth) {
  const pane = elements.translationScroll;
  const paneRect = pane.getBoundingClientRect();
  if (!paneRect.height) return;
  const rect = node.getBoundingClientRect();
  const top = pane.scrollTop + rect.top + rect.height * clamp(fraction, 0, 1) - (paneRect.top + paneRect.height * READING_LINE);
  // 原生平滑滚动交给浏览器合成线程，不受主线程 rAF 节流影响；
  // 跨越多屏时直接跳过去，否则闪一下的段落还在屏幕外，看不到定位结果。
  const behavior = smooth && Math.abs(top - pane.scrollTop) <= pane.clientHeight * 1.2 ? "smooth" : "instant";
  pane.scrollTo({ top, behavior });
}

function flashTranslationNode(node) {
  if (!node) return;
  clearTimeout(node.flashTimer);
  node.classList.remove("is-flash");
  void node.offsetWidth;
  node.classList.add("is-flash");
  node.flashTimer = setTimeout(() => node.classList.remove("is-flash"), 1300);
}

// ---- 悬停工具条：段落（定位原文 / 复制译文 / 复制原文 / 问 AI），插图（定位 / 放大 / 复制图片 / 问 AI） ----

function showBlockTools(node) {
  const tools = elements.tpBlockTools;
  const paneRect = elements.translationPane.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const figure = node.classList.contains("tp-figure");
  tools.style.top = `${Math.max(6, rect.top - paneRect.top - 16)}px`;
  tools.style.right = `${Math.max(8, paneRect.right - rect.right - 6)}px`;
  tools.dataset.page = node.dataset.page;
  tools.dataset.ref = node.dataset.ref;
  tools.classList.toggle("is-figure", figure);
  tools.querySelector('[data-tp-action="locate"]').title = readingMode === "parallel" ? "在原文中定位" : "切到对照模式并定位原文";
  tools.querySelector('[data-tp-action="copy"]').title = figure ? "复制图片" : "复制译文";
  tools.querySelector('[data-tp-action="ask"]').title = figure ? "让 AI 解释这张图" : "让 AI 解释这一段";
  tools.classList.add("is-visible");
}

function hideBlockTools() {
  elements.tpBlockTools?.classList.remove("is-visible");
}

async function handleBlockToolClick(event) {
  const button = event.target.closest("[data-tp-action]");
  if (!button) return;
  const tools = elements.tpBlockTools;
  const pageNumber = Number(tools.dataset.page);
  const ref = tools.dataset.ref;
  const parsed = parseRef(ref);
  const view = pageViews.get(pageNumber);
  if (!view || !parsed) return;
  const action = button.dataset.tpAction;

  if (action === "locate") {
    hideBlockTools();
    if (readingMode === "parallel") {
      focusSourceBlock(pageNumber, ref);
    } else {
      setReadingMode("parallel");
      // 等原文栏显示并完成适应宽度后再定位
      setTimeout(() => focusSourceBlock(pageNumber, ref), 320);
    }
    return;
  }

  if (parsed.type === "figure") {
    const figure = view.translationFigures?.[parsed.index];
    if (!figure?.url) return;
    if (action === "zoom") {
      openFigureLightbox(pageNumber, ref, translationNode(pageNumber, ref)?.querySelector("img"));
    } else if (action === "copy") {
      try {
        const blob = await (await fetch(figure.url)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
        showToast("已复制图片");
      } catch {
        showToast("复制图片失败，可放大后右键另存");
      }
    } else if (action === "ask") {
      hideBlockTools();
      const imageDataUrl = await figureDataUrl(figure).catch(() => "");
      if (!imageDataUrl) {
        showToast("无法读取这张图");
        return;
      }
      const label = figure.kind === "equation" ? "公式" : "图";
      askPdfAi(`请解释第 ${pageNumber} 页的这张${label}`, { imageDataUrl, pageNumber });
    }
    return;
  }

  const root = translationRoot(pageNumber, parsed.index);
  const block = pageViews.get(root.page)?.translationLayout?.[root.index];
  if (!block) return;
  const sourceText = block.joinedText || block.text;
  if (action === "copy" || action === "copy-source") {
    const text = action === "copy" && !block.failed ? block.translated : sourceText;
    try {
      await navigator.clipboard.writeText(text);
      showToast(action === "copy" ? "已复制译文" : "已复制原文");
    } catch {
      showToast("复制失败，请手动选择文字复制");
    }
  } else if (action === "ask") {
    hideBlockTools();
    askAiAboutText(sourceText, root.page);
  }
}

// ---- 分栏宽度、左右交换、译文字号 ----

function applyPaneLayout() {
  const panes = elements.readingPanes;
  panes.style.setProperty("--source-share", `${paneSplit}%`);
  panes.classList.toggle("is-swapped", paneSwapped);
  const parallel = readingMode === "parallel";
  const sourceCenter = parallel ? (paneSwapped ? 100 - paneSplit / 2 : paneSplit / 2) : 50;
  elements.documentShell.style.setProperty("--dock-center", `${sourceCenter}%`);
  elements.documentShell.style.setProperty("--find-right", parallel && !paneSwapped ? `calc(${100 - paneSplit}% + 18px)` : "18px");
  elements.paneDivider.setAttribute("aria-valuenow", String(Math.round(paneSplit)));
  elements.translationDoc.style.setProperty("--tp-font-size", `${translationFontSize}px`);
}

function loadPaneLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(READING_LAYOUT_KEY) || "{}");
    paneSplit = LexiLoopPdfBilingual.clampSplit(saved.split ?? 50);
    paneSwapped = saved.swapped === true;
    translationFontSize = LexiLoopPdfBilingual.clampFontSize(saved.fontSize ?? LexiLoopPdfBilingual.DEFAULT_FONT_SIZE);
  } catch {
    paneSplit = 50;
    paneSwapped = false;
    translationFontSize = LexiLoopPdfBilingual.DEFAULT_FONT_SIZE;
  }
}

function savePaneLayout() {
  try {
    localStorage.setItem(READING_LAYOUT_KEY, JSON.stringify({ split: paneSplit, swapped: paneSwapped, fontSize: translationFontSize }));
  } catch {
    // 存储不可用时只在本次会话生效
  }
}

function startPaneResize(event) {
  if (event.button !== 0 || event.target.closest(".pane-swap")) return;
  event.preventDefault();
  paneDividerDrag = { pointerId: event.pointerId };
  elements.paneDivider.setPointerCapture(event.pointerId);
  document.body.classList.add("pane-resizing");
}

function movePaneResize(event) {
  if (!paneDividerDrag || paneDividerDrag.pointerId !== event.pointerId) return;
  const rect = elements.readingPanes.getBoundingClientRect();
  if (!rect.width) return;
  const leftShare = ((event.clientX - rect.left) / rect.width) * 100;
  paneSplit = LexiLoopPdfBilingual.clampSplit(paneSwapped ? 100 - leftShare : leftShare);
  applyPaneLayout();
}

function finishPaneResize(event) {
  if (!paneDividerDrag) return;
  if (elements.paneDivider.hasPointerCapture?.(event.pointerId)) elements.paneDivider.releasePointerCapture(event.pointerId);
  paneDividerDrag = null;
  document.body.classList.remove("pane-resizing");
  savePaneLayout();
}

function handlePaneDividerKey(event) {
  if (event.target !== elements.paneDivider) return;
  let delta = 0;
  if (event.key === "ArrowLeft") delta = -2;
  else if (event.key === "ArrowRight") delta = 2;
  else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    paneSplit = 50;
    applyPaneLayout();
    savePaneLayout();
    return;
  }
  if (!delta) return;
  event.preventDefault();
  // 分隔条左移 = 左边一栏变窄；交换后左边是译文
  paneSplit = LexiLoopPdfBilingual.clampSplit(paneSplit + (paneSwapped ? -delta : delta));
  applyPaneLayout();
  savePaneLayout();
}

function swapPanes() {
  paneSwapped = !paneSwapped;
  applyPaneLayout();
  savePaneLayout();
  requestAnimationFrame(() => {
    paneLeader = "source";
    syncTranslationToSource();
  });
}

function changeTranslationFontSize(delta) {
  const anchor = translationAnchorAtReadingLine();
  translationFontSize = LexiLoopPdfBilingual.clampFontSize(
    delta === 0 ? LexiLoopPdfBilingual.DEFAULT_FONT_SIZE : translationFontSize + delta
  );
  applyPaneLayout();
  savePaneLayout();
  updateControls();
  // 字号变化会改变排版高度：保持正在读的那一段停在原位
  if (anchor) scrollTranslationToAnchor(anchor);
}

// ==================== 超链接：原文链接层、译文链接、内部链接预览与返回 ====================

async function getPageLinks(view) {
  if (view.links) return view.links;
  if (!view.linksPromise) {
    view.linksPromise = (async () => {
      const annotations = await view.page.getAnnotations({ intent: "display" });
      const items = pageTextItems(await pageTextContent(view), view.baseViewport).map((item) => ({ ...item, text: item.str }));
      const links = [];
      for (const annotation of annotations || []) {
        if (annotation?.subtype !== "Link" || !Array.isArray(annotation.rect)) continue;
        const url = LexiLoopPdfBilingual.safeHref(annotation.url || annotation.unsafeUrl || "");
        const dest = annotation.dest ?? null;
        if (!url && (dest === null || dest === undefined)) continue;
        const corners = view.baseViewport.convertToViewportRectangle(annotation.rect);
        const rect = {
          x: Math.min(corners[0], corners[2]),
          top: Math.min(corners[1], corners[3]),
          width: Math.abs(corners[2] - corners[0]),
          height: Math.abs(corners[3] - corners[1])
        };
        if (rect.width < 1 || rect.height < 1) continue;
        const destName = typeof dest === "string" ? dest : "";
        links.push({
          id: links.length,
          key: `${view.pageNumber}:${links.length}`,
          rect,
          url,
          dest,
          kind: url ? "url" : /^cite\./i.test(destName) ? "cite" : "ref",
          anchor: LexiLoopPdfBilingual.anchorTextForRect(items, rect)
        });
      }
      view.links = links;
      return links;
    })().catch((error) => {
      view.linksPromise = null;
      throw error;
    });
  }
  return view.linksPromise;
}

function assignLinksToBlocks(layout, links, pageNumber) {
  for (const link of links || []) {
    const block = blockContainingRect(layout, link.rect);
    if (!block) continue;
    const key = `${pageNumber}:${link.id}`;
    (block.linkKeys ||= []).push(key);
    (block.linkRefs ||= []).push({ key, offset: linkOffsetInBlock(block, link.rect) });
  }
}

function blockContainingRect(blocks, rect) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return blocks.find((item) => cx >= item.x - 2 && cx <= item.x + item.width + 2 && cy >= item.top - 3 && cy <= item.top + item.height + 3) || null;
}

// 链接框在段落文字里的大致字符位置：先找所在的行，再按横向比例换算
function linkOffsetInBlock(block, rect) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const span of block.lineSpans || []) {
    const distance = cy < span.top ? span.top - cy : cy > span.bottom ? cy - span.bottom : 0;
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  if (!best) return Number.NaN;
  const ratio = clamp((cx - best.x) / Math.max(1, best.right - best.x), 0, 1);
  return Math.round(best.start + ratio * (best.end - best.start));
}

// 一整句（可能由同页几段、甚至下一页开头接成）里所有链接，位置换算到合并后的文字上
function collectRootLinks(view, root, rootIndex, layout) {
  const parts = root.segments?.length ? root.segments : [{ page: view.pageNumber, index: rootIndex }];
  const entries = [];
  let joined = "";
  for (const segment of parts) {
    let block = null;
    let refs = [];
    if (segment.page === view.pageNumber && Number.isInteger(segment.index)) {
      block = layout[segment.index];
      refs = block?.linkRefs || [];
    } else if (root.carryTail && segment.page === root.carryTail.page) {
      block = root.carryTail.block;
      refs = root.carryTail.linkRefs;
    }
    if (!block) continue;
    const next = joined ? LexiLoopPdfLayout.joinContinuation(joined, block.text) : block.text;
    const base = next.length - block.text.length;
    joined = next;
    for (const ref of refs) {
      const link = linkByKey(ref.key);
      if (link) entries.push({ key: link.key, anchor: link.anchor, url: link.url, kind: link.kind, offset: base + ref.offset });
    }
  }
  return entries;
}

function linkByKey(key) {
  const [page, id] = String(key || "").split(":").map(Number);
  return pageViews.get(page)?.links?.[id] || null;
}

// 原文页上的可点击链接层（PDF 原有的超链接、引用、图表跳转）
async function ensureLinkLayer(view) {
  if (view.linkLayerReady || !view.linkLayer) return;
  view.linkLayerReady = true;
  const links = await getPageLinks(view).catch(() => []);
  if (pageViews.get(view.pageNumber) !== view) return;
  const { width, height } = view.baseViewport;
  const fragment = document.createDocumentFragment();
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.className = `pdf-link${link.url ? " is-external" : ""}`;
    anchor.dataset.link = link.key;
    anchor.draggable = false;
    if (link.url) {
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.title = link.url;
    } else {
      anchor.href = "#";
      anchor.setAttribute("aria-label", link.anchor ? `跳转到 ${link.anchor}` : "跳转到文档内位置");
    }
    Object.assign(anchor.style, {
      left: `${(link.rect.x / width) * 100}%`,
      top: `${(link.rect.top / height) * 100}%`,
      width: `${(link.rect.width / width) * 100}%`,
      height: `${(link.rect.height / height) * 100}%`
    });
    fragment.append(anchor);
  }
  view.linkLayer.replaceChildren(fragment);
}

function handlePageLinkClick(event) {
  const anchor = event.target.closest?.(".pdf-link");
  if (anchor) activateLinkElement(event, anchor);
}

function activateLinkElement(event, element) {
  const link = linkByKey(element.dataset.link);
  if (link?.url || (!link && element.classList.contains("is-external"))) {
    // 外部链接交给浏览器在新标签页打开
    hideLinkPreview();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (link?.dest !== undefined && link?.dest !== null) navigateToDestination(link.dest);
}

async function resolveDestination(dest) {
  if (!pdfDocument) return null;
  const explicit = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return null;
  const pageNumber = await destinationPageNumber(explicit);
  const view = pageViews.get(pageNumber);
  if (!view) return null;
  const mode = explicit[1]?.name;
  let left = null;
  let top = null;
  if (mode === "XYZ") {
    left = explicit[2];
    top = explicit[3];
  } else if (mode === "FitH" || mode === "FitBH") {
    top = explicit[2];
  } else if (mode === "FitR") {
    left = explicit[2];
    top = explicit[5];
  }
  const pageTop = view.page.view?.[3] ?? view.baseViewport.height;
  const [x, y] = view.baseViewport.convertToViewportPoint(Number.isFinite(left) ? left : 0, Number.isFinite(top) ? top : pageTop);
  return {
    pageNumber,
    x: Number.isFinite(left) ? clamp(x, 0, view.baseViewport.width) : 0,
    y: Number.isFinite(top) ? clamp(y, 0, view.baseViewport.height) : 0
  };
}

// 链接目标处的内容：先看是不是插图，再找目标点下方的段落（参考文献条目、图注等）
async function destinationContent(target) {
  const view = pageViews.get(target.pageNumber);
  if (!view) return null;
  const figure = (view.translationFigures || []).find((item) => item.url
    && target.y >= item.top - 24 && target.y <= item.top + item.height
    && (!target.x || (target.x >= item.x - 24 && target.x <= item.x + item.width)));
  if (figure) return { view, figure };
  const blocks = await pagePreviewBlocks(view);
  let index = LexiLoopPdfBilingual.blockAtDestination(blocks, target.x, target.y);
  if (index < 0) return { view };
  if (Number.isInteger(blocks[index].continuationOf)) index = blocks[index].continuationOf;
  const block = blocks[index];
  const translated = view.translationState === "complete" && blocks === view.translationLayout && !block.failed
    ? (block.overlayText ?? block.translated)
    : "";
  return { view, block, index: blocks === view.translationLayout ? index : -1, translated };
}

async function navigateToDestination(dest) {
  const target = await resolveDestination(dest).catch(() => null);
  if (!target) {
    showToast("无法跳转到链接位置");
    return;
  }
  hideLinkPreview();
  rememberLinkReturn();
  const view = pageViews.get(target.pageNumber);
  const content = await destinationContent(target).catch(() => null);
  if (readingMode === "translation") {
    let ref = null;
    if (content?.figure) ref = `f${view.translationFigures.indexOf(content.figure)}`;
    else if (content?.index >= 0) {
      const root = translationRoot(target.pageNumber, content.index);
      ref = `t${root.index}`;
      scrollTranslationToAnchor({ page: root.page, ref, fraction: 0 }, 0.22, true);
      flashTranslationNode(translationNode(root.page, ref));
      return;
    }
    if (ref) {
      scrollTranslationToAnchor({ page: target.pageNumber, ref, fraction: 0 }, 0.22, true);
      flashTranslationNode(translationNode(target.pageNumber, ref));
    } else {
      scrollTranslationToPage(target.pageNumber);
    }
    return;
  }
  paneLeader = "source";
  const stage = elements.pageStage;
  const stageRect = stage.getBoundingClientRect();
  const pageRect = view.element.getBoundingClientRect();
  const y = pageRect.top + (target.y / view.baseViewport.height) * pageRect.height;
  animateScrollTo(stage, stage.scrollTop + y - stageRect.top - stageRect.height * 0.22);
  renderPage(view).catch(handleRenderError);
  const rect = content?.figure || content?.block;
  if (rect) showSourceBoxes([{ view, rect }], true);
}

// ---- 跳转后返回原阅读位置 ----

function rememberLinkReturn() {
  linkReturnState = {
    mode: readingMode,
    page: currentPage,
    source: readingMode !== "translation" ? sourceAnchorAtReadingLine() : null,
    translation: readingMode !== "source" ? translationAnchorAtReadingLine() : null
  };
  elements.linkReturnLabel.textContent = `返回第 ${currentPage} 页`;
  elements.linkReturn.hidden = false;
}

function returnFromLink() {
  const state = linkReturnState;
  hideLinkReturn();
  if (!state) return;
  if (readingMode === "translation") {
    if (state.translation) scrollTranslationToAnchor(state.translation);
    else scrollTranslationToPage(state.page);
    return;
  }
  if (state.source && pageViews.get(state.source.view.pageNumber) === state.source.view) {
    paneLeader = "source";
    restoreSourceAnchor(state.source);
  } else {
    scrollToPage(state.page, false);
  }
}

function hideLinkReturn() {
  linkReturnState = null;
  if (elements.linkReturn) elements.linkReturn.hidden = true;
}

// ---- 内部链接悬停预览（参考文献、图表、章节） ----

function handleLinkPointerOver(event) {
  const element = event.target.closest?.(".pdf-link, .tp-link");
  if (!element) return;
  const link = linkByKey(element.dataset.link);
  if (!link || link.url || link.dest === null || link.dest === undefined) return;
  clearTimeout(linkPreviewTimer);
  if (linkPreviewAnchor === element && !elements.linkPreview.hidden) return;
  linkPreviewTimer = setTimeout(() => showLinkPreview(element, link), 280);
}

function handleLinkPointerOut(event) {
  const element = event.target.closest?.(".pdf-link, .tp-link");
  if (!element || element.contains(event.relatedTarget)) return;
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = setTimeout(hideLinkPreview, 220);
}

async function showLinkPreview(element, link) {
  const token = ++linkPreviewToken;
  const target = await resolveDestination(link.dest).catch(() => null);
  if (token !== linkPreviewToken || !target || !element.isConnected) return;
  const content = await destinationContent(target).catch(() => null);
  if (token !== linkPreviewToken || !content) return;
  const preview = elements.linkPreview;
  elements.linkPreviewLabel.textContent = `第 ${target.pageNumber} 页`;
  elements.linkPreviewImage.hidden = !content.figure;
  if (content.figure) elements.linkPreviewImage.src = content.figure.url;
  const source = content.block ? (content.block.joinedText || content.block.text) : "";
  elements.linkPreviewText.hidden = !source || Boolean(content.figure);
  elements.linkPreviewText.textContent = source.length > 1600 ? `${source.slice(0, 1600)}…` : source;
  elements.linkPreviewTranslation.hidden = !content.translated || Boolean(content.figure);
  elements.linkPreviewTranslation.textContent = content.translated || "";
  if (!content.figure && !source) {
    elements.linkPreviewText.hidden = false;
    elements.linkPreviewText.textContent = "点击跳转到该位置";
  }
  linkPreviewAnchor = element;
  linkPreviewDest = link.dest;
  preview.hidden = false;
  const anchorRect = element.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const below = anchorRect.bottom + 8 + previewRect.height <= window.innerHeight - 8;
  const top = below ? anchorRect.bottom + 8 : Math.max(8, anchorRect.top - 8 - previewRect.height);
  const left = clamp(anchorRect.left + anchorRect.width / 2 - previewRect.width / 2, 8, window.innerWidth - previewRect.width - 8);
  preview.style.top = `${top}px`;
  preview.style.left = `${left}px`;
  preview.dataset.side = below ? "below" : "above";
  preview.classList.remove("is-visible");
  void preview.offsetWidth;
  preview.classList.add("is-visible");
}

function hideLinkPreview() {
  clearTimeout(linkPreviewTimer);
  linkPreviewToken += 1;
  linkPreviewAnchor = null;
  if (!elements.linkPreview || elements.linkPreview.hidden) return;
  elements.linkPreview.classList.remove("is-visible");
  elements.linkPreview.hidden = true;
}

// ==================== 插图、表格、公式：从原文裁成图片放进译文栏 ====================


async function extractPageFigures(view, blocks, items) {
  if (view.figureRegions) return view.figureRegions;
  const viewport = view.page.getViewport({ scale: FIGURE_DETECT_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await view.page.render({
    canvasContext: context,
    viewport,
    annotationMode: pdfjs.AnnotationMode?.DISABLE ?? 0
  }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  const grid = LexiLoopPdfFigures.buildInkGrid(pixels.data, pixels.width, pixels.height, FIGURE_DETECT_SCALE);
  // 已翻译的文字段落不算插图：上下各留出行高的余量，盖住下伸笔画与上标
  const textRects = blocks.map((block) => {
    const line = Number(block.lineHeight) || 10;
    return { x: block.x - 2, top: block.top - line * 0.25, width: block.width + 4, height: block.height + line * 0.6 };
  });
  const rotatedRects = items.filter((item) => item.rotated && item.box).map((item) => ({
    x: item.box.x - 2, top: item.box.top - 2, width: item.box.width + 4, height: item.box.height + 4
  }));
  // 页眉、页脚文字所在的横条不参与识别，避免页眉被并进下面的插图
  const pageWidth = view.baseViewport.width;
  const pageHeightBase = view.baseViewport.height;
  const bandRects = [];
  const headerItems = items.filter((item) => !item.rotated && item.top + item.height < pageHeightBase * 0.075);
  if (headerItems.length) {
    const bottom = Math.max(...headerItems.map((item) => item.top + item.height)) + 3;
    bandRects.push({ x: 0, top: 0, width: pageWidth, height: bottom });
  }
  const footerItems = items.filter((item) => !item.rotated && item.top > pageHeightBase * 0.93);
  if (footerItems.length) {
    const top = Math.min(...footerItems.map((item) => item.top)) - 3;
    bandRects.push({ x: 0, top, width: pageWidth, height: pageHeightBase - top });
  }
  LexiLoopPdfFigures.clearRects(grid, [...textRects, ...rotatedRects, ...bandRects]);
  const pageHeight = view.baseViewport.height;
  // 三线表、算法框：按横线和「Table N」标题整块识别，表格里的文字不再逐格翻译
  const tables = LexiLoopPdfFigures.findTableRegions(
    LexiLoopPdfFigures.findHorizontalRules(pixels.data, pixels.width, pixels.height, FIGURE_DETECT_SCALE),
    blocks
  );
  // 页眉、页脚里的装饰（Logo、日期条、页码条）不算插图
  const operators = await view.page.getOperatorList().catch(() => null);
  const imageRects = (operators
    ? LexiLoopPdfFigures.imageRectsFromOperators(operators.fnArray, operators.argsArray, viewport.transform)
    : []
  ).filter((rect) => {
    const pageArea = Math.max(1, view.baseViewport.width * view.baseViewport.height);
    // 整页底图、或大半盖住正文的图，不当成插图
    return rect.width * rect.height < pageArea * 0.72
      && LexiLoopPdfFigures.textCoverage(rect, textRects) < 0.55;
  });
  const inkRegions = LexiLoopPdfFigures.findRegions(grid, textRects);
  // 照片按图片对象的完整矩形裁，再把贴在上面的标签并进去，避免只剩深色碎片
  const regions = LexiLoopPdfFigures.mergeTableRegions(
    LexiLoopPdfFigures.absorbImageRegions(imageRects, inkRegions, textRects),
    tables
  ).filter((region) => region.kind === "table" || !(
    region.height < 60 && (region.top < pageHeight * 0.07 || region.top + region.height > pageHeight * 0.94)
  ));
  for (const region of regions) {
    region.url = await renderRegionImage(view, region, FIGURE_CROP_SCALE).catch(() => "");
  }
  const figures = regions.filter((region) => region.url);
  view.figureRegions = figures;
  return figures;
}

async function renderRegionImage(view, rect, targetScale) {
  const maxPixels = 4_000_000;
  let renderScale = targetScale;
  if (rect.width * rect.height * renderScale * renderScale > maxPixels) {
    renderScale = Math.sqrt(maxPixels / Math.max(1, rect.width * rect.height));
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(rect.width * renderScale));
  canvas.height = Math.max(1, Math.ceil(rect.height * renderScale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await view.page.render({
    canvasContext: context,
    viewport: view.page.getViewport({ scale: renderScale }),
    transform: [1, 0, 0, 1, -rect.x * renderScale, -rect.top * renderScale],
    annotationMode: pdfjs.AnnotationMode?.DISABLE ?? 0
  }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  figureObjectUrls.add(url);
  return url;
}

async function figureDataUrl(figure) {
  const blob = await (await fetch(figure.url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function releaseFigureImages() {
  figureObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  figureObjectUrls.clear();
}

// ---- 放大查看：从译文栏里的位置放大到屏幕中央，再换成更清晰的版本 ----

async function openFigureLightbox(pageNumber, ref, imageElement) {
  const view = pageViews.get(pageNumber);
  const parsed = parseRef(ref);
  const figure = parsed?.type === "figure" ? view?.translationFigures?.[parsed.index] : null;
  if (!figure?.url) return;
  hideBlockTools();
  const lightbox = elements.figureLightbox;
  const image = elements.figureLightboxImage;
  image.src = figure.url;
  elements.figureLightboxCaption.textContent = `第 ${pageNumber} 页 · ${figure.kind === "equation" ? "公式" : "插图"} · 点击任意处关闭`;
  lightbox.hidden = false;
  lightbox.dataset.page = String(pageNumber);
  lightbox.dataset.ref = ref;
  requestAnimationFrame(() => {
    lightbox.classList.add("is-open");
    const from = imageElement?.getBoundingClientRect();
    const to = image.getBoundingClientRect();
    if (from?.width && to.width && !prefersReducedMotion()) {
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      image.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: "none" }],
        { duration: 380, easing: "cubic-bezier(.22, 1, .36, 1)" }
      );
    }
  });
  // 按屏幕尺寸重新渲染一份更清晰的
  const wanted = Math.min(6, Math.max(FIGURE_CROP_SCALE, (window.innerWidth * 0.9 * (window.devicePixelRatio || 1)) / figure.width));
  if (wanted > FIGURE_CROP_SCALE + 0.5) {
    const sharp = await renderRegionImage(view, figure, wanted).catch(() => "");
    if (sharp && lightbox.dataset.ref === ref && !lightbox.hidden) image.src = sharp;
  }
}

function closeFigureLightbox() {
  const lightbox = elements.figureLightbox;
  if (lightbox.hidden) return;
  lightbox.classList.remove("is-open");
  delete lightbox.dataset.ref;
  setTimeout(() => {
    if (!lightbox.classList.contains("is-open")) lightbox.hidden = true;
  }, prefersReducedMotion() ? 0 : 200);
}

// 程序滚动动画（参考 Reader 的 animatePDFScroll）：按时间推进的缓出曲线，长距离跳转也一定落到目标位置；
// 用户在动画中途滚动、点击时立即停下。
function animateScrollTo(host, top, left = host.scrollLeft) {
  const targetTop = clamp(top, 0, Math.max(0, host.scrollHeight - host.clientHeight));
  const targetLeft = clamp(left, 0, Math.max(0, host.scrollWidth - host.clientWidth));
  scrollAnimations.get(host)?.cancel();
  const fromTop = host.scrollTop;
  const fromLeft = host.scrollLeft;
  const distance = Math.hypot(targetTop - fromTop, targetLeft - fromLeft);
  if (prefersReducedMotion() || distance < 2) {
    host.scrollTo({ top: targetTop, left: targetLeft, behavior: "instant" });
    return;
  }
  const duration = Math.min(420, 220 + distance / 40);
  let frame = 0;
  let started = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    host.removeEventListener("wheel", stop);
    host.removeEventListener("pointerdown", stop);
    host.removeEventListener("touchstart", stop);
    if (scrollAnimations.get(host)?.stop === stop) scrollAnimations.delete(host);
  };
  const step = (now) => {
    started ||= now;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    host.scrollTo({ top: fromTop + (targetTop - fromTop) * eased, left: fromLeft + (targetLeft - fromLeft) * eased, behavior: "instant" });
    if (progress < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  host.addEventListener("wheel", stop, { passive: true });
  host.addEventListener("pointerdown", stop, { passive: true });
  host.addEventListener("touchstart", stop, { passive: true });
  scrollAnimations.set(host, { cancel: stop, stop });
  frame = requestAnimationFrame(step);
}

// ==================== PDF 阅读 × 词库 ====================
// 划词记录带上文献、页码与整句；正文标出词库词（悬停看释义）；侧栏「生词」汇总本文查过的词、
// 文中出现的词库词与本文高频术语；从词库/复习卡可以跳回原文位置。

function loadVocabWords() {
  return chrome.storage.local.get(WORDS_STORAGE_KEY)
    .then((stored) => setVocabWords(stored[WORDS_STORAGE_KEY]))
    .catch((error) => console.warn("LexiLoop vocab load failed", error));
}

function setVocabWords(value) {
  vocabWords = Array.isArray(value) ? value : [];
  vocabMatcher = LexiLoopPdfVocab.buildVocabMatcher(vocabWords);
  vocabVersion += 1;
  if (vocabAnalysis) vocabAnalysis.occurrences = null;
  refreshVocabMarks();
  updateVocabCount();
  if (vocabPanelVisible()) renderVocabPanel();
}

function currentDocRef() {
  return { paperId: pdfLibraryPaperId || "", documentKey: documentKey || "", url: sourceUrl || "" };
}

// 记录到词库时的来源：文献、页码与 PDF 指纹，用来从词库跳回原文
function documentSource(page) {
  return {
    title: sourceTitle || "PDF 文档",
    url: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : "",
    paperId: pdfLibraryPaperId || "",
    documentKey: documentKey || "",
    page: Math.max(1, Math.round(Number(page) || currentPage || 1)),
    kind: "pdf"
  };
}

// 阅读用的页面文字：按 PDF.js 文本条目拼接，行尾补空格，行尾连字符断词接回，连字（ﬁ）还原
async function pageReadingText(view) {
  if (typeof view.readingText === "string") return view.readingText;
  if (!view.textLayerContent) {
    view.textLayerContent = await view.page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  }
  const items = (view.textLayerContent.items || []).filter((item) => typeof item.str === "string");
  let text = "";
  items.forEach((item, index) => {
    text += item.str;
    if (!item.hasEOL) return;
    const next = items[index + 1]?.str || "";
    if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(next)) text = text.slice(0, -1);
    else text += " ";
  });
  view.readingText = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  return view.readingText;
}

// ---- 正文中标出词库词 ----

// 词库词在页面上的位置：直接用 PDF.js 文本条目的真实位置和宽度，再用 PDF 内嵌字体测量词在条目里的相对位置。
// 不依赖透明文字层（文字层用替代字体排字，一行内部的字符位置会漂移几个字母）。

function pdfFontLoaded(fontName) {
  if (!fontName) return false;
  if (loadedPdfFonts.get(fontName)) return true;
  for (const face of document.fonts || []) {
    if (face.family.replace(/["']/g, "") === fontName && face.status === "loaded") {
      loadedPdfFonts.set(fontName, true);
      return true;
    }
  }
  return false;
}

function measureWidth(text, fontName, style) {
  const family = pdfFontLoaded(fontName) ? `"${fontName}"` : (style?.fontFamily || "sans-serif");
  const font = `100px ${family}`;
  if (vocabMeasureContext.font !== font) vocabMeasureContext.font = font;
  return vocabMeasureContext.measureText(text).width;
}

// 页面文字与每个字符所属的文本条目（连字 ﬁ 展开成 fi，仍对应原字符）
function itemCharMap(textContent) {
  let text = "";
  const map = [];
  for (const item of textContent?.items || []) {
    if (typeof item.str !== "string") continue;
    for (let index = 0; index < item.str.length; index += 1) {
      for (const character of item.str[index].normalize("NFKC")) {
        text += character;
        map.push({ item, offset: index });
      }
    }
    if (item.hasEOL) {
      text += " ";
      map.push(null);
    }
  }
  return { text, map };
}

function computeVocabMarks(view) {
  const content = view.textLayerContent;
  if (!content) return [];
  const { text, map } = itemCharMap(content);
  const matches = LexiLoopPdfVocab.findVocabMatches(text, vocabMatcher);
  const viewport = view.baseViewport;
  const marks = [];
  const geometry = new Map();
  const itemGeometry = (item) => {
    if (geometry.has(item)) return geometry.get(item);
    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const rotated = Math.abs(transform[1]) > Math.abs(transform[0]) * 0.1 || Math.abs(transform[2]) > Math.abs(transform[3]) * 0.1;
    const style = content.styles?.[item.fontName] || {};
    const ascent = Number(style.ascent) || 0.8;
    const descent = Number(style.descent) || -0.2;
    const value = rotated || !fontHeight || !item.width ? null : {
      x: transform[4],
      top: transform[5] - fontHeight * ascent,
      height: fontHeight * (ascent - descent),
      width: Number(item.width),
      fullWidth: measureWidth(item.str, item.fontName, style) || 1,
      style
    };
    geometry.set(item, value);
    return value;
  };
  for (const match of matches) {
    // 一个匹配可能跨两个条目（词组跨行时）：按条目分段各画一段
    let index = match.start;
    while (index < match.end) {
      const first = map[index];
      if (!first) { index += 1; continue; }
      let last = index;
      while (last + 1 < match.end && map[last + 1]?.item === first.item) last += 1;
      const box = itemGeometry(first.item);
      if (box) {
        const str = first.item.str;
        const startOffset = first.offset;
        const endOffset = map[last].offset + 1;
        const before = measureWidth(str.slice(0, startOffset), first.item.fontName, box.style);
        const inside = measureWidth(str.slice(startOffset, endOffset), first.item.fontName, box.style);
        const ratio = box.width / box.fullWidth;
        marks.push({
          wordId: match.word.id,
          x: box.x + before * ratio,
          top: box.top,
          width: Math.max(1, inside * ratio),
          height: box.height,
          familiar: Number(match.word.review?.stage || 0) >= 3
        });
      }
      index = last + 1;
    }
  }
  return marks;
}

function paintVocabMarks(view) {
  const layer = view?.vocabLayer;
  if (!layer) return;
  if (!vocabMarksEnabled || !vocabMatcher?.size) {
    layer.replaceChildren();
    view.vocabMarks = [];
    view.vocabMarksVersion = vocabVersion;
    return;
  }
  if (view.vocabMarksVersion === vocabVersion && view.vocabMarks) return;
  if (!view.textLayerContent) return;
  const marks = computeVocabMarks(view);
  const baseWidth = view.baseViewport.width;
  const baseHeight = view.baseViewport.height;
  const fragment = document.createDocumentFragment();
  for (const mark of marks) {
    const element = document.createElement("i");
    element.className = mark.familiar ? "vocab-mark is-familiar" : "vocab-mark";
    element.style.left = `${(mark.x / baseWidth) * 100}%`;
    element.style.top = `${(mark.top / baseHeight) * 100}%`;
    element.style.width = `${(mark.width / baseWidth) * 100}%`;
    element.style.height = `${(mark.height / baseHeight) * 100}%`;
    fragment.append(element);
  }
  layer.replaceChildren(fragment);
  view.vocabMarks = marks;
  view.vocabMarksVersion = vocabVersion;
}

function refreshVocabMarks() {
  pageViews.forEach((view) => {
    view.vocabMarks = null;
    if (!vocabMarksEnabled) {
      view.vocabLayer?.replaceChildren();
      return;
    }
    if (view.renderedScale) paintVocabMarks(view);
    else view.vocabLayer?.replaceChildren();
  });
  hideVocabTooltip();
}

function setVocabMarksEnabled(enabled) {
  vocabMarksEnabled = Boolean(enabled);
  try {
    localStorage.setItem(VOCAB_MARKS_KEY, vocabMarksEnabled ? "on" : "off");
  } catch {
    // 存储不可用时只在本次生效
  }
  elements.vocabMarksToggle.checked = vocabMarksEnabled;
  refreshVocabMarks();
}

// ---- 悬停词库词显示释义 ----

function handleVocabHover(event) {
  if (!vocabMarksEnabled || event.buttons || !vocabWords.length) return;
  const pageElement = event.target.closest?.(".original-page");
  const { clientX, clientY } = event;
  window.cancelAnimationFrame(vocabHoverFrame);
  vocabHoverFrame = window.requestAnimationFrame(() => {
    const view = pageElement ? pageViews.get(Number(pageElement.dataset.pageNumber)) : null;
    const marks = view?.vocabMarks;
    if (!marks?.length || !window.getSelection()?.isCollapsed || !elements.annotationSelectionToolbar.hidden) {
      hideVocabTooltip();
      return;
    }
    const rect = pageElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * view.baseViewport.width;
    const y = ((clientY - rect.top) / rect.height) * view.baseViewport.height;
    const mark = marks.find((item) => x >= item.x - 1 && x <= item.x + item.width + 1 && y >= item.top - 1 && y <= item.top + item.height + 1);
    if (!mark) {
      hideVocabTooltip();
      return;
    }
    const key = `${view.pageNumber}:${mark.x.toFixed(1)}:${mark.top.toFixed(1)}`;
    if (key === vocabTooltipKey) return;
    vocabTooltipKey = key;
    clearTimeout(vocabTooltipTimer);
    const anchor = {
      left: rect.left + (mark.x / view.baseViewport.width) * rect.width,
      top: rect.top + (mark.top / view.baseViewport.height) * rect.height,
      width: (mark.width / view.baseViewport.width) * rect.width,
      height: (mark.height / view.baseViewport.height) * rect.height
    };
    vocabTooltipTimer = setTimeout(() => showVocabTooltip(mark.wordId, anchor), 180);
  });
}

function showVocabTooltip(wordId, anchor) {
  const word = vocabWords.find((item) => item.id === wordId);
  if (!word) return;
  const tooltip = elements.vocabTooltip;
  tooltip.replaceChildren(...vocabWordSummary(word));
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const below = anchor.top + anchor.height + 8 + box.height <= window.innerHeight - 8;
  tooltip.style.top = `${below ? anchor.top + anchor.height + 8 : Math.max(8, anchor.top - box.height - 8)}px`;
  tooltip.style.left = `${clamp(anchor.left + anchor.width / 2 - box.width / 2, 8, window.innerWidth - box.width - 8)}px`;
  tooltip.classList.remove("is-visible");
  void tooltip.offsetWidth;
  tooltip.classList.add("is-visible");
}

function hideVocabTooltip() {
  clearTimeout(vocabTooltipTimer);
  vocabTooltipKey = "";
  if (!elements.vocabTooltip || elements.vocabTooltip.hidden) return;
  elements.vocabTooltip.classList.remove("is-visible");
  elements.vocabTooltip.hidden = true;
}

function vocabWordSummary(word) {
  const head = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = word.original;
  head.append(title);
  const phonetic = word.phonetics?.us || word.phonetics?.uk || word.phonetics?.generic;
  if (phonetic) {
    const span = document.createElement("span");
    span.textContent = `/${String(phonetic).replace(/^\/|\/$/g, "")}/`;
    head.append(span);
  }
  const meaning = document.createElement("p");
  meaning.className = "vocab-tip-meaning";
  const groups = (word.meanings || []).slice(0, 2).map((group) => `${group.partOfSpeech ? `${group.partOfSpeech} ` : ""}${(group.definitions || []).slice(0, 2).join("；")}`).filter(Boolean);
  meaning.textContent = groups.length ? groups.join("\n") : word.translated || "";
  const meta = document.createElement("p");
  meta.className = "vocab-tip-meta";
  const here = LexiLoopPdfVocab.wordsForDocument([word], currentDocRef())[0];
  const parts = [`查过 ${Math.max(1, Number(word.translationCount) || (word.lookups || []).length || 1)} 次`];
  if (here?.pages.length) parts.push(`本文 ${here.pages.slice(0, 4).map((page) => `p.${page}`).join(" ")}`);
  const due = Date.parse(word.review?.dueAt || "");
  if (Number.isFinite(due)) parts.push(due <= Date.now() ? "待复习" : `${Math.max(1, Math.round((due - Date.now()) / 86400000))} 天后复习`);
  meta.textContent = parts.join(" · ");
  return [head, meaning, meta];
}

// ---- 侧栏「生词」 ----

function vocabPanelVisible() {
  return elements.vocabPanel?.classList.contains("is-active") && !elements.documentShell.hidden;
}

function updateVocabCount() {
  if (!elements.vocabCount) return;
  const count = pdfDocument ? LexiLoopPdfVocab.wordsForDocument(vocabWords, currentDocRef()).length : 0;
  elements.vocabCount.textContent = count ? String(count) : "";
}

async function ensureVocabAnalysis() {
  const generation = documentGeneration;
  if (vocabAnalysis?.generation === generation && vocabAnalysis.pageTexts && vocabAnalysis.occurrences && vocabAnalysis.version === vocabVersion) return vocabAnalysis;
  if (vocabAnalysisPromise?.generation === generation) return vocabAnalysisPromise.promise;
  const promise = (async () => {
    let pageTexts = vocabAnalysis?.generation === generation ? vocabAnalysis.pageTexts : null;
    if (!pageTexts) {
      pageTexts = [];
      const views = [...pageViews.values()];
      for (const view of views) {
        if (generation !== documentGeneration) return null;
        try {
          pageTexts.push({ page: view.pageNumber, text: await pageReadingText(view) });
        } catch {
          // 个别页取不到文字时跳过
        }
        if (view.pageNumber % 10 === 0) {
          setVocabAnalysisStatus(`正在分析全文 ${view.pageNumber}/${views.length} 页…`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    if (generation !== documentGeneration) return null;
    const known = new Set(vocabWords.map((word) => LexiLoopPdfVocab.normalizeTerm(word.original)));
    vocabAnalysis = {
      generation,
      version: vocabVersion,
      pageTexts,
      occurrences: LexiLoopPdfVocab.vocabOccurrences(pageTexts, vocabMatcher),
      terms: LexiLoopPdfVocab.analyzeTerms(pageTexts, { known, limit: 30, minCount: pageTexts.length > 3 ? 3 : 2 })
    };
    return vocabAnalysis;
  })().finally(() => {
    if (vocabAnalysisPromise?.promise === promise) vocabAnalysisPromise = null;
  });
  vocabAnalysisPromise = { generation, promise };
  return promise;
}

function setVocabAnalysisStatus(text) {
  const status = elements.vocabPanelBody.querySelector(".vocab-analysis-status");
  if (status) status.textContent = text;
}

function vocabSection(title, count, note) {
  const section = document.createElement("section");
  section.className = "vocab-section";
  const head = document.createElement("header");
  const strong = document.createElement("strong");
  strong.textContent = title;
  head.append(strong);
  if (count !== undefined) {
    const badge = document.createElement("span");
    badge.textContent = String(count);
    head.append(badge);
  }
  section.append(head);
  if (note) {
    const p = document.createElement("p");
    p.className = "vocab-section-note";
    p.textContent = note;
    section.append(p);
  }
  return section;
}

function vocabRow({ term, meaning, pages = [], count, page, actions = [], known = false }) {
  const row = document.createElement("div");
  row.className = `vocab-row${known ? " is-known" : ""}`;
  const main = document.createElement("button");
  main.type = "button";
  main.className = "vocab-row-main";
  main.title = page || pages[0] ? `在原文中定位「${term}」` : term;
  const top = document.createElement("span");
  top.className = "vocab-row-term";
  top.textContent = term;
  if (count) {
    const times = document.createElement("small");
    times.textContent = `×${count}`;
    top.append(times);
  }
  main.append(top);
  if (meaning) {
    const sub = document.createElement("span");
    sub.className = "vocab-row-meaning";
    sub.textContent = meaning;
    main.append(sub);
  }
  const pageList = pages.length ? pages : page ? [page] : [];
  if (pageList.length) {
    const chips = document.createElement("span");
    chips.className = "vocab-row-pages";
    chips.textContent = pageList.slice(0, 5).map((value) => `p.${value}`).join("  ") + (pageList.length > 5 ? " …" : "");
    main.append(chips);
  }
  main.addEventListener("click", () => findTermInDocument(term, pageList[0]));
  row.append(main, ...actions);
  return row;
}

function shortMeaning(word) {
  const text = word.translated || (word.meanings?.[0]?.definitions || []).join("；") || "";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

async function renderVocabPanel() {
  const body = elements.vocabPanelBody;
  if (!pdfDocument) {
    body.replaceChildren();
    return;
  }
  const generation = documentGeneration;
  const looked = LexiLoopPdfVocab.wordsForDocument(vocabWords, currentDocRef());
  const lookedSection = vocabSection("在本文查过", looked.length, looked.length ? "" : "在正文中划词翻译，词会自动记到这里，并在词库里记下页码和原句。");
  looked.forEach((item) => lookedSection.append(vocabRow({ term: item.word.original, meaning: shortMeaning(item.word), pages: item.pages, count: item.count > 1 ? item.count : 0 })));

  const status = document.createElement("p");
  status.className = "vocab-analysis-status";
  status.textContent = "正在分析全文…";
  body.replaceChildren(lookedSection, status);

  const analysis = await ensureVocabAnalysis().catch((error) => {
    console.warn("LexiLoop vocab analysis failed", error);
    return null;
  });
  if (generation !== documentGeneration || !vocabPanelVisible()) return;
  if (!analysis) {
    status.textContent = "全文分析失败";
    return;
  }
  const lookedIds = new Set(looked.map((item) => item.word.id));
  const occurrences = analysis.occurrences.filter((item) => !lookedIds.has(item.word.id));
  const occurrenceSection = vocabSection("文中出现的词库词", occurrences.length, occurrences.length ? "以前在别处查过、本文里又出现的词，正文中带下划线。" : "本文没有出现词库里的其它词。");
  occurrences.slice(0, 60).forEach((item) => occurrenceSection.append(vocabRow({ term: item.word.original, meaning: shortMeaning(item.word), pages: item.pages, count: item.count })));

  const termSection = vocabSection("本文高频术语", analysis.terms.length, "按出现次数自动提取，点「查词」翻译并加入词库（记下所在页和原句）。");
  analysis.terms.forEach((item) => {
    const actions = [];
    if (!item.known) {
      const lookup = document.createElement("button");
      lookup.type = "button";
      lookup.className = "vocab-row-action";
      lookup.textContent = "查词";
      lookup.addEventListener("click", () => lookupTermFromPanel(item, lookup));
      actions.push(lookup);
    } else {
      const tag = document.createElement("span");
      tag.className = "vocab-row-tag";
      tag.textContent = "已在词库";
      actions.push(tag);
    }
    termSection.append(vocabRow({ term: item.term, count: item.count, page: item.firstPage, actions, known: item.known }));
  });
  status.remove();
  body.append(occurrenceSection, termSection);
}

async function lookupTermFromPanel(item, button) {
  button.disabled = true;
  button.textContent = "翻译中";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE",
      text: item.term,
      target: "auto",
      context: item.sample || item.term,
      trigger: "pdf-terms",
      source: documentSource(item.firstPage)
    });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    showToast(`「${item.term}」：${response.result?.translated || ""}（已加入词库）`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "查词";
    showToast(error.message || "翻译失败");
  }
}

// 在原文中定位一个词：先到指定页，再用查找栏从该页开始找
function findTermInDocument(term, page) {
  const value = String(term || "").trim();
  if (!value || !pdfDocument) return;
  if (readingMode === "translation") setReadingMode("parallel");
  if (page) scrollToPage(page, false);
  elements.findBar.hidden = false;
  elements.findButton.setAttribute("aria-expanded", "true");
  elements.findInput.value = value;
  runFind();
}

// ---- 从词库 / 复习卡跳回：已打开的阅读器直接定位 ----

function readerMatchesJump(message) {
  if (!pdfDocument) return false;
  if (message.libraryId) return message.libraryId === pdfLibraryPaperId;
  if (message.documentKey && documentKey) return message.documentKey === documentKey;
  if (message.url && sourceUrl) return stripUrlFragment(message.url) === stripUrlFragment(sourceUrl);
  return false;
}

function handleReaderJumpMessage(message, _sender, sendResponse) {
  if (message?.type !== "READER_JUMP" || !readerMatchesJump(message)) return false;
  const page = Number(message.page) || 0;
  if (message.find) findTermInDocument(message.find, page);
  else if (page) scrollToPage(page);
  chrome.tabs.getCurrent((tab) => sendResponse({ ok: true, tabId: tab?.id, windowId: tab?.windowId }));
  return true;
}
