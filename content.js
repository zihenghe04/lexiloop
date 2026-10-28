(() => {
  if (window.__lexiloopLoaded) return;
  window.__lexiloopLoaded = true;

  const SETTINGS_KEY = "lexiloopSettings";
  const DEFAULT_SETTINGS = { selectionBubbleEnabled: true, enhancedPdfEnabled: true };
  const TEXT_CONTROL_TYPES = new Set(["text", "search", "url", "tel", "email"]);
  const SELECTION_CACHE_MS = 1200;
  const usesIntegratedPdfToolbar = document.documentElement.hasAttribute("data-lexiloop-pdf-reader")
    && (location.protocol === "chrome-extension:" || Boolean(window.__lexiloopPreview));

  let settings = { ...DEFAULT_SETTINGS };
  let bubble;
  let card;
  let lastSelection = null;
  let lastSelectionAt = 0;
  let lastResult = null;
  let translateToken = 0;
  let selectionTimer;
  let composing = false;

  loadSettings();

  document.addEventListener("compositionstart", () => { composing = true; }, true);
  document.addEventListener("compositionend", () => {
    composing = false;
    scheduleSelectionCheck(80);
  }, true);
  document.addEventListener("selectionchange", () => scheduleSelectionCheck(90), true);
  document.addEventListener("mouseup", (event) => scheduleSelectionCheck(24, event), true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      hideAll();
      return;
    }
    if (String(event.key || "").startsWith("Arrow") || event.key === "Shift" || event.key === "Home" || event.key === "End") {
      scheduleSelectionCheck(36, event);
    }
  }, true);
  document.addEventListener("beforeinput", clearSelectionCache, true);
  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest?.(".lexiloop-root")) {
      clearSelectionCache();
      hideAll();
    }
  }, true);
  if (usesIntegratedPdfToolbar) {
    document.addEventListener("lexiloop:pdf-hide-translation-ui", hideAll);
    document.addEventListener("lexiloop:pdf-translate-selection", translateIntegratedPdfSelection);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
    if (!settings.selectionBubbleEnabled) hideBubble();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "GET_SELECTION") return;
    const selection = readSelection(true);
    if (selection) {
      sendResponse({ ...selection, rect: undefined, source: currentSource() });
      return;
    }
    // 快捷键会发给页面里所有 frame，只采用第一个回复：没有选区的 iframe 不回复；
    // 顶层页面晚一点再回复空结果，让 iframe（在线编辑器、邮件正文）里真正的选区先到
    if (window !== window.top) return;
    setTimeout(() => sendResponse({ text: "", context: "" }), 150);
    return true;
  });

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
      if (!settings.selectionBubbleEnabled) hideBubble();
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function scheduleSelectionCheck(delay, event) {
    if (composing || event?.target?.closest?.(".lexiloop-root")) return;
    rememberSelection(readSelection(false));
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(handleSelection, delay);
  }

  function handleSelection() {
    const selection = readSelection(true);
    if (!selection || selection.text.length > 500) {
      hideBubble();
      return;
    }

    rememberSelection(selection);
    if (settings.selectionBubbleEnabled && !card && !usesIntegratedPdfToolbar) showBubble(selection.rect);
  }

  function readSelection(allowCached = false) {
    const activeElement = deepActiveElement();
    const selection = isTextControl(activeElement)
      ? readTextControlSelection(activeElement)
      : readDomSelection();
    if (selection) return selection;
    return allowCached && Date.now() - lastSelectionAt <= SELECTION_CACHE_MS ? lastSelection : null;
  }

  function rememberSelection(selection) {
    if (!selection?.text || !selection.rect) return;
    const changed = selection.text !== lastSelection?.text
      || selection.context !== lastSelection?.context;
    lastSelection = selection;
    lastSelectionAt = Date.now();
    if (changed) lastResult = null;
  }

  function clearSelectionCache() {
    lastSelection = null;
    lastSelectionAt = 0;
    lastResult = null;
  }

  function readTextControlSelection(element) {
    if (!isTextControl(element) || typeof element.selectionStart !== "number") return null;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === end) return null;

    const rawText = element.value.slice(start, end);
    const text = cleanSelectionText(rawText);
    if (!text) return null;

    return {
      text,
      context: cleanSelectionText(element.value).slice(0, 300),
      rect: getTextControlSelectionRect(element, start, end)
    };
  }

  function readDomSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    if (usesIntegratedPdfToolbar && window.LexiLoopPdfSelection) {
      const sourceRange = selection.getRangeAt(0);
      const container = sourceRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? sourceRange.commonAncestorContainer.parentElement
        : sourceRange.commonAncestorContainer;
      const textLayer = container?.closest?.(".textLayer");
      const pdfSelection = textLayer
        ? window.LexiLoopPdfSelection.readTextLayerSelection(selection, textLayer, { mutate: true })
        : null;
      if (pdfSelection) {
        const rect = lastVisibleRect(pdfSelection.range.getClientRects())
          || pdfSelection.range.getBoundingClientRect();
        return isVisibleRect(rect)
          ? { text: pdfSelection.text, context: pdfSelection.context, rect }
          : null;
      }
    }

    const text = cleanSelectionText(selection.toString());
    if (!text) return null;

    const range = selection.getRangeAt(0);
    const rect = lastVisibleRect(range.getClientRects()) || range.getBoundingClientRect();
    if (!isVisibleRect(rect)) return null;

    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const editingRoot = container?.closest?.("[contenteditable]:not([contenteditable='false']), [role='textbox']");
    const contextNode = editingRoot || container?.closest?.("p, li, blockquote, article, section") || container;
    const context = cleanSelectionText(contextNode?.innerText || contextNode?.textContent || text).slice(0, 300);
    return { text, context, rect };
  }

  function getTextControlSelectionRect(element, start, end) {
    const style = getComputedStyle(element);
    const elementRect = element.getBoundingClientRect();
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    const copiedProperties = [
      "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth",
      "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch",
      "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform",
      "textIndent", "textDecoration", "letterSpacing", "wordSpacing", "tabSize", "direction"
    ];

    Object.assign(mirror.style, {
      position: "fixed",
      zIndex: "-1",
      top: `${elementRect.top}px`,
      left: `${elementRect.left}px`,
      visibility: "hidden",
      pointerEvents: "none",
      whiteSpace: element.tagName === "INPUT" ? "pre" : "pre-wrap",
      overflowWrap: element.tagName === "INPUT" ? "normal" : "break-word"
    });
    copiedProperties.forEach((property) => { mirror.style[property] = style[property]; });

    mirror.textContent = element.value.slice(0, start);
    marker.textContent = element.value.slice(start, end) || "\u200b";
    mirror.appendChild(marker);
    mirror.appendChild(document.createTextNode(element.value.slice(end) || "."));
    document.documentElement.appendChild(mirror);
    mirror.scrollTop = element.scrollTop;
    mirror.scrollLeft = element.scrollLeft;

    const rect = lastVisibleRect(marker.getClientRects()) || marker.getBoundingClientRect();
    const boundedRect = {
      left: Math.min(Math.max(rect.left, elementRect.left), elementRect.right),
      right: Math.min(Math.max(rect.right, elementRect.left), elementRect.right),
      top: Math.min(Math.max(rect.top, elementRect.top), elementRect.bottom),
      bottom: Math.min(Math.max(rect.bottom, elementRect.top), elementRect.bottom),
      width: Math.max(1, Math.min(rect.width, elementRect.width)),
      height: Math.max(1, Math.min(rect.height, elementRect.height))
    };
    mirror.remove();
    return boundedRect;
  }

  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function isTextControl(element) {
    if (!element || element.disabled) return false;
    if (element.tagName === "TEXTAREA") return true;
    return element.tagName === "INPUT" && TEXT_CONTROL_TYPES.has(String(element.type || "text").toLowerCase());
  }

  function lastVisibleRect(rectList) {
    return [...(rectList || [])].reverse().find(isVisibleRect) || null;
  }

  function isVisibleRect(rect) {
    return Boolean(rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && (rect.width || rect.height));
  }

  function cleanSelectionText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function showBubble(rect) {
    if (usesIntegratedPdfToolbar) return;
    if (!bubble) {
      bubble = document.createElement("button");
      bubble.className = "lexiloop-root lexiloop-bubble";
      bubble.type = "button";
      bubble.setAttribute("aria-label", "翻译所选文本");
      bubble.title = "用 LexiLoop 翻译";
      bubble.innerHTML = "<span>译</span>";
      bubble.addEventListener("mousedown", (event) => event.preventDefault());
      bubble.addEventListener("click", translateSelection);
      document.documentElement.appendChild(bubble);
    }

    positionNear(bubble, rect, 38, 10);
    bubble.classList.add("is-visible");
  }

  async function translateSelection() {
    // 存一份当前选区：等结果期间用户可能已经选了别的词
    const selection = lastSelection;
    if (!selection) return;
    const token = ++translateToken;
    hideBubble();
    showCard(selection.rect, { loading: true, original: selection.text }, selection);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE",
        text: selection.text,
        target: "auto",
        context: selection.context,
        trigger: selection.source?.kind === "pdf" ? "pdf-selection" : "selection",
        source: selection.source || currentSource()
      });
      if (token !== translateToken) return;
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      lastResult = response.result;
      showCard(selection.rect, response.result, selection);
    } catch (error) {
      if (token !== translateToken) return;
      showCard(selection.rect, { error: error.message, original: selection.text }, selection);
    }
  }

  function translateIntegratedPdfSelection(event) {
    const text = cleanSelectionText(event.detail?.text);
    const rect = event.detail?.rect;
    if (!text || text.length > 2000 || !isVisibleRect(rect)) return;
    lastSelection = {
      text,
      context: cleanSelectionText(event.detail?.context || text).slice(0, 420),
      rect,
      // 阅读器提供的来源：文献、页码、PDF 指纹，用来从词库跳回原文
      source: event.detail?.source && typeof event.detail.source === "object" ? event.detail.source : null
    };
    lastResult = null;
    translateSelection();
  }

  function currentSource() {
    const root = document.documentElement;
    const source = {
      title: root.hasAttribute("data-lexiloop-source-title") ? root.dataset.lexiloopSourceTitle : document.title,
      url: root.hasAttribute("data-lexiloop-source-url") ? root.dataset.lexiloopSourceUrl : location.href
    };
    // 在 LexiLoop 阅读器里（快捷键查词）：带上文献、PDF 指纹与当前页
    if (root.hasAttribute("data-lexiloop-pdf-reader")) {
      source.kind = "pdf";
      source.paperId = root.dataset.lexiloopPaperId || "";
      source.documentKey = root.dataset.lexiloopDocumentKey || "";
      source.page = Number(root.dataset.lexiloopCurrentPage) || 0;
      if (!/^https?:/i.test(source.url)) source.url = "";
    }
    return source;
  }

  function showCard(rect, state, selection = lastSelection) {
    hideCard();
    card = document.createElement("section");
    card.className = "lexiloop-root lexiloop-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "LexiLoop 翻译结果");

    if (state.loading) {
      card.innerHTML = `
        <div class="lexiloop-card-head"><strong>LexiLoop</strong><span class="lexiloop-spinner"></span></div>
        <p class="lexiloop-original">${escapeHtml(state.original)}</p>
        <div class="lexiloop-skeleton"></div>`;
    } else if (state.error) {
      card.innerHTML = `
        <div class="lexiloop-card-head"><strong>LexiLoop</strong><button data-close aria-label="关闭">×</button></div>
        <p class="lexiloop-original">${escapeHtml(state.original)}</p>
        <p class="lexiloop-error">${escapeHtml(state.error)}</p>`;
    } else {
      card.innerHTML = `
        <div class="lexiloop-card-head">
          <strong>LexiLoop</strong>
          <button data-close aria-label="关闭">×</button>
        </div>
        <div class="lexiloop-card-body">
          <div class="lexiloop-term-row">
            <div class="lexiloop-title-line">
              <p class="lexiloop-original">${escapeHtml(state.original)}</p>
              ${speakButtonMarkup(state.original)}
            </div>
            ${phoneticMarkup(state.phonetics)}
          </div>
          ${meaningsMarkup(state)}
          <p class="lexiloop-recorded">${state.recorded === false ? "长句只翻译，不收录进词库" : `已自动收录 · 第 ${Number(state.translationCount || 1)} 次翻译`}</p>
        </div>
        <div class="lexiloop-actions">
          <span>${escapeHtml(state.service || "翻译服务")}</span>
          <button data-panel type="button">打开个人中心</button>
        </div>`;
    }

    card.addEventListener("mousedown", (event) => event.stopPropagation());
    card.querySelector("[data-close]")?.addEventListener("click", hideCard);
    card.querySelector("[data-speak]")?.addEventListener("click", () => speak(state));
    card.querySelector("[data-panel]")?.addEventListener("click", () => {
      // 用这张卡片自己的选区和结果，不读之后可能已经变化的全局状态
      const cardSelection = selection || lastSelection;
      if (!cardSelection) return;
      const cardResult = !state.loading && !state.error ? state : null;
      chrome.runtime.sendMessage({
        type: "OPEN_IN_PANEL",
        text: cardSelection.text,
        context: cardSelection.context,
        source: cardSelection.source || currentSource(),
        result: cardResult
      });
    });

    document.documentElement.appendChild(card);
    positionNear(card, rect, 360, 12);
    requestAnimationFrame(() => card?.classList.add("is-visible"));
  }

  function meaningsMarkup(state) {
    if (!state.meanings?.length) {
      return `<p class="lexiloop-translation">${escapeHtml(state.translated)}</p>`;
    }
    return `<div class="lexiloop-meanings">${state.meanings.slice(0, 4).map((group) => `
      <div class="lexiloop-meaning-row">
        <span>${escapeHtml(group.partOfSpeech || "释义")}</span>
        <p>${escapeHtml(group.definitions?.join("；") || "")}</p>
      </div>`).join("")}</div>`;
  }

  function phoneticMarkup(phonetics = {}) {
    const values = [];
    if (phonetics.uk) values.push(`英 /${trimSlashes(phonetics.uk)}/`);
    if (phonetics.us) values.push(`美 /${trimSlashes(phonetics.us)}/`);
    if (!values.length && phonetics.generic) values.push(`/${trimSlashes(phonetics.generic)}/`);
    return values.length
      ? `<p class="lexiloop-phonetic">${values.map(escapeHtml).join("&nbsp;&nbsp;")}</p>`
      : "";
  }

  function speakButtonMarkup(text) {
    if (!canSpeak(text)) return "";
    return `<button class="lexiloop-speak" data-speak type="button" title="播放发音" aria-label="播放 ${escapeHtml(text)} 的发音">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a9 9 0 0 1 0 12"/></svg>
    </button>`;
  }

  function canSpeak(text) {
    return Boolean(String(text || "").trim()) && String(text).trim().length <= 120;
  }

  function speak(result) {
    const text = String(result.original || "").trim();
    if (!canSpeak(text)) return;
    const audioUrl = result.audio?.us || result.audio?.uk || result.audio?.generic;
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(() => speakWithSystem(text, result.detectedLanguage));
      return;
    }
    speakWithSystem(text, result.detectedLanguage);
  }

  function speakWithSystem(text, language) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = String(language || "").startsWith("zh") ? "zh-CN" : "en-US";
    utterance.rate = 0.92;
    speechSynthesis.speak(utterance);
  }

  function trimSlashes(value) {
    return String(value || "").replace(/^\/+|\/+$/g, "");
  }

  function positionNear(element, rect, width, gap) {
    const viewportPadding = 12;
    const effectiveWidth = Math.min(width, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left + window.scrollX),
      window.scrollX + window.innerWidth - effectiveWidth - viewportPadding
    );
    const estimatedHeight = element.classList.contains("lexiloop-card") ? 330 : 38;
    const fitsBelow = rect.bottom + gap + estimatedHeight < window.innerHeight;
    const top = fitsBelow
      ? rect.bottom + window.scrollY + gap
      : Math.max(window.scrollY + viewportPadding, rect.top + window.scrollY - estimatedHeight - gap);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function hideBubble() {
    bubble?.classList.remove("is-visible");
  }

  function hideCard() {
    card?.remove();
    card = null;
  }

  function hideAll() {
    hideBubble();
    hideCard();
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }
})();
