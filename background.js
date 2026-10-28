importScripts("pdf-library.js", "pdf-knowledge.js", "paper-metadata.js", "oauth-provider.js", "translation-providers.js", "vocab-io.js");

const MENU_ID = "lexiloop-translate-selection";
const PDF_MENU_ID = "lexiloop-open-pdf-reader";
const WORDS_KEY = "lexiloopWords";
const PENDING_KEY = "lexiloopPending";
const SETTINGS_PENDING_KEY = "lexiloopSettingsPending";
const SETTINGS_KEY = "lexiloopSettings";
const DEFAULT_SETTINGS = { selectionBubbleEnabled: true, enhancedPdfEnabled: true, targetLanguage: "auto" };
// 翻译目标语言。auto = 英文→中文、中文→英文；其余为固定语言。
const TARGET_LANGUAGES = ["auto", "zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "ru", "pt", "it", "ar"];
const MAX_TEXT_LENGTH = 500;
// PDF 翻译按段落发送，一段可能上千字符
const MAX_PDF_TEXT_LENGTH = 2000;
const MAX_PDF_TRANSLATION_BATCH = 80;
const PDF_TRANSLATION_CONCURRENCY = 3;
const translationProviders = globalThis.LexiLoopTranslationProviders;
const pdfLibrary = globalThis.LexiLoopPdfLibrary;
const paperMetadata = globalThis.LexiLoopPaperMetadata;

let recordQueue = Promise.resolve();
let knowledgeQueue = Promise.resolve();
let pdfLibraryQueue = Promise.resolve();
let offscreenDocumentPromise = null;
const pdfTakeovers = new Map();
// 目标语言缓存：PDF 逐段翻译时不必每次都读 settings
let preferredLanguageCache = null;

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) preferredLanguageCache = null;
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "翻译并打开 LexiLoop：%s",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: PDF_MENU_ID,
      title: "使用 LexiLoop 阅读当前 PDF",
      contexts: ["page"]
    });
  });

  await Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}),
    initializeStorage()
  ]);
});

chrome.runtime.onStartup.addListener(initializeStorage);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && info.selectionText) {
    translateAndOpen(info.selectionText, tab, "context-menu");
    return;
  }
  if (info.menuItemId === PDF_MENU_ID && isLikelyPdfTab(tab)) {
    openPdfReader(tab.url, tab.id);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || "";
  const navigated = Boolean(changeInfo.url || changeInfo.status === "loading");
  if (!navigated || !isRemotePdfUrl(url) || isPdfReaderUrl(url)) return;
  await maybeOpenPdfReader(url, tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || isPdfReaderUrl(details.url) || !isPdfResponse(details)) return;
    maybeOpenPdfReader(details.url, details.tabId);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"]
);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "translate-selection") return;
  // 必须在任何 await 之前调用：chrome.sidePanel.open 只能在用户操作的同一调用栈里执行
  if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  handleTranslateCommand(tab);
});

chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== "lexiloop-pdf-ai-stream") return;
  let disconnected = false;
  let started = false;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller.abort();
  });
  port.onMessage.addListener((message) => {
    if (started || message?.type !== "ASK_PDF_AI_STREAM") return;
    started = true;
    const send = (payload) => {
      if (!disconnected) {
        try { port.postMessage(payload); } catch { disconnected = true; }
      }
    };
    translationProviders.askPdfQuestionStream({
      question: message.question,
      context: message.context,
      history: message.history,
      imageDataUrl: message.imageDataUrl,
      title: message.title
    }, { signal: controller.signal }, (text) => send({ type: "chunk", text }))
      .then((result) => send({ type: "done", ok: true, ...result }))
      .catch((error) => send({ type: "done", ...providerErrorResponse(error) }));
  });
});

async function handleTranslateCommand(tab) {
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
    if (response?.text) {
      await translateAndOpen(response.text, tab, "shortcut", response.context, response.source);
      return;
    }
  } catch {
    // Chrome PDF 阅读器和浏览器内部页面无法接收内容脚本消息。
  }

  if (isLikelyPdfTab(tab)) {
    try {
      const clipboardText = cleanText(await readClipboardText());
      if (clipboardText) {
        await translateAndOpen(clipboardText, tab, "pdf-clipboard");
        return;
      }
    } catch (error) {
      console.warn("LexiLoop could not read the PDF clipboard selection", error);
    }
    await openPanelWithPayload({
      text: "",
      notice: "PDF 中请先复制选中的文字，再按翻译快捷键",
      source: pageSource(tab),
      trigger: "pdf-clipboard"
    }, tab.windowId);
    return;
  }

  await openPanelWithPayload({
    text: "",
    notice: "当前页面无法读取选区，请使用右键翻译",
    source: pageSource(tab),
    trigger: "shortcut"
  }, tab.windowId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'WORD_MUTATE') {
    queueWordMutation(message).then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'KNOWLEDGE_PATCH') {
    const run = knowledgeQueue.catch(() => {}).then(async () => {
      const key = String(message.key || '');
      if (!key || key.length > 500) throw new Error('文档标识无效');
      const store = (await chrome.storage.local.get(LexiLoopKnowledge.KEY))[LexiLoopKnowledge.KEY] || {};
      const entry = LexiLoopKnowledge.patch(Object.hasOwn(store, key) ? store[key] : {}, message.action, message.value);
      const next = { ...store, [key]: entry };
      await chrome.storage.local.set({ [LexiLoopKnowledge.KEY]: next });
      return entry;
    });
    knowledgeQueue = run;
    run.then(entry => sendResponse({ ok: true, entry })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "CC_SWITCH_PREVIEW") {
    if (sender.tab) return false;
    LexiLoopOAuth.request("cc-switch-preview")
      .then((result) => sendResponse({ ok: true, providers: result.providers || [], missing: Boolean(result.missing) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "OPEN_PANEL_TAB") {
    const tabName = ["lookup", "words", "review", "library"].includes(message.tab) ? message.tab : "lookup";
    const windowId = sender.tab?.windowId;
    if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});
    chrome.storage.session.set({ lexiloopPanelTab: tabName }).catch(() => {});
    chrome.runtime.sendMessage({ type: "SHOW_PANEL_TAB", tab: tabName }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "OAUTH_ACCOUNT") {
    const provider = message.provider === "grok" ? "grok" : "chatgpt";
    const allowed = provider === "grok" ? ["status", "login", "logout", "models", "poll"] : ["status", "login", "logout", "models"];
    if (!allowed.includes(message.action) || sender.tab) return false;
    const action = provider === "grok" ? "grok-" + message.action : message.action;
    LexiLoopOAuth.request(action).then(async result => {
      const url = result.authUrl || result.verificationUri;
      if (url) {
        const parsed = new URL(url);
        const hosts = provider === "grok" ? ["accounts.x.ai", "auth.x.ai"] : ["auth.openai.com"];
        if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname)) throw new Error("授权地址异常");
        await chrome.tabs.create({ url: parsed.href });
      }
      sendResponse({
        ok: true, account: result.account, pending: result.pending, models: result.models,
        warning: result.warning || "", userCode: result.userCode || "", interval: result.interval
      });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "RESOLVE_PAPER_METADATA") {
    paperMetadata.resolvePaperMetadata(String(message.input || "").slice(0, 200_000))
      .then((metadata) => sendResponse({ ok: true, metadata }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PDF_LIBRARY_GET") {
    readPdfLibrary()
      .then((papers) => sendResponse({ ok: true, papers }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PDF_LIBRARY_UPSERT") {
    queuePdfLibraryMutation((papers) => pdfLibrary.upsertPaper(papers, message.paper))
      .then(({ papers, paper }) => sendResponse({ ok: true, papers, paper }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PDF_LIBRARY_PATCH") {
    queuePdfLibraryMutation((papers) => pdfLibrary.patchPaper(papers, message.id, message.changes))
      .then(({ papers, paper }) => sendResponse({ ok: true, papers, paper }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PDF_LIBRARY_REMOVE") {
    queuePdfLibraryMutation((papers) => ({
      papers: pdfLibrary.removePaper(papers, message.id),
      paper: null
    }))
      .then(({ papers }) => sendResponse({ ok: true, papers }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PDF_LIBRARY_RESET_INDEXES") {
    queuePdfLibraryMutation((papers) => ({
      papers: pdfLibrary.resetPaperIndexes(papers, message.ids),
      paper: null
    }))
      .then(({ papers }) => sendResponse({ ok: true, papers }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "WORDS_IMPORT") {
    queueWordsImport(message.words)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "TRANSLATE_PDF_BATCH") {
    translatePdfBatchTexts(message.texts, message.target || "auto")
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ASK_PDF_AI") {
    translationProviders.askPdfQuestion({
      question: message.question,
      context: message.context,
      history: message.history,
      imageDataUrl: message.imageDataUrl,
      title: message.title
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "TRANSLATE") {
    const tabSource = pageSource(sender.tab);
    translateAndRecord(message.text, {
      target: message.target || "auto",
      context: message.context || "",
      source: normalizeSource(message.source, tabSource),
      trigger: message.trigger || "manual"
    })
      .then(({ result, entry }) => sendResponse({
        ok: true,
        result: entry ? {
          ...result,
          entryId: entry.id,
          translationCount: entry.translationCount,
          recordedAt: entry.updatedAt
        } : result
      }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_TRANSLATION_SETTINGS") {
    translationProviders.getPublicSettings()
      .then((settings) => sendResponse({ ok: true, ...settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ASSIGN_CONNECTION_ROLES") {
    if (sender.tab) return false;
    translationProviders.assignRoles(message.roles || {})
      .then((settings) => sendResponse({ ok: true, ...settings }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "REMOVE_CONNECTION") {
    if (sender.tab) return false;
    translationProviders.removeConnection(String(message.id || ""))
      .then((settings) => sendResponse({ ok: true, ...settings }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "SAVE_TRANSLATION_SETTINGS") {
    translationProviders.saveSettings(message.config, {
      apiKey: message.apiKey,
      clearApiKey: Boolean(message.clearApiKey),
      activate: message.activate !== false,
      connection: message.connection
    })
      .then((settings) => sendResponse({ ok: true, ...settings }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "TEST_TRANSLATION_PROVIDER") {
    translationProviders.testOpenAIProvider(message.config, message.apiKey)
      .then((diagnostics) => sendResponse({ ok: true, ...diagnostics }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "LIST_API_MODELS") {
    translationProviders.listApiModels(message.config, message.apiKey)
      .then((models) => sendResponse({ ok: true, models }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "TEST_PDF_AI_PROVIDER") {
    translationProviders.testPdfAiProvider(message.config, message.apiKey)
      .then((diagnostics) => sendResponse({ ok: true, ...diagnostics }))
      .catch((error) => sendResponse(providerErrorResponse(error)));
    return true;
  }

  if (message.type === "OPEN_IN_PANEL") {
    const tab = sender.tab;
    openPanelWithPayload({
      text: message.text,
      context: message.context || "",
      source: normalizeSource(message.source, pageSource(tab)),
      trigger: "page",
      result: message.result || null
    }, tab?.windowId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "OPEN_SHORTCUT_SETTINGS") {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "OPEN_PDF_READER") {
    const requestedUrl = message.libraryId ? "" : (message.url || sender.tab?.url || "");
    openPdfReader(requestedUrl, undefined, message.libraryId, {
      page: message.page,
      forceIndex: Boolean(message.forceIndex),
      find: message.find,
      documentKey: message.documentKey,
      reuse: Boolean(message.reuse)
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "OPEN_PANEL") {
    const windowId = sender.tab?.windowId;
    const openPromise = windowId ? chrome.sidePanel.open({ windowId }) : Promise.resolve();
    openPromise
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "OPEN_SETTINGS") {
    const windowId = sender.tab?.windowId;
    const openPromise = windowId ? chrome.sidePanel.open({ windowId }) : Promise.resolve();
    Promise.all([
      chrome.storage.session.set({ [SETTINGS_PENDING_KEY]: true }),
      openPromise
    ])
      .then(() => chrome.runtime.sendMessage({ type: "SHOW_SETTINGS" }).catch(() => {}))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function openPdfReader(url = "", tabId, libraryId = "", options = {}) {
  if (isPdfReaderUrl(url) && !libraryId) return;
  // 从词库 / 复习卡跳回原文：这篇文献已经在阅读器里打开时，直接切过去定位
  if (options.reuse && await jumpInOpenReader({ libraryId, url, documentKey: options.documentKey, page: options.page, find: options.find })) return;
  if (options.reuse && !libraryId && !/^https?:\/\//i.test(String(url || ""))) {
    throw new Error("这份 PDF 是从本地打开的，没有加入文献库，无法自动重新打开。请先在阅读器里打开它，或把它加入文献库");
  }
  const readerUrl = new URL(chrome.runtime.getURL("pdf-reader.html"));
  if (/^https?:\/\//i.test(String(url || ""))) readerUrl.searchParams.set("url", url);
  if (libraryId) readerUrl.searchParams.set("library", String(libraryId));
  if (Number(options.page) > 0) readerUrl.searchParams.set("page", String(Math.floor(Number(options.page))));
  if (options.find) readerUrl.searchParams.set("find", String(options.find).slice(0, 120));
  if (libraryId && options.forceIndex) readerUrl.searchParams.set("index", "force");
  if (tabId) {
    await chrome.tabs.update(tabId, { url: readerUrl.href });
  } else {
    await chrome.tabs.create({ url: readerUrl.href });
  }
}

async function jumpInOpenReader(target) {
  if (!target.libraryId && !target.url && !target.documentKey) return false;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "READER_JUMP", ...target }),
      new Promise((resolve) => setTimeout(() => resolve(null), 800))
    ]);
    if (!response?.ok || !response.tabId) return false;
    await chrome.tabs.update(response.tabId, { active: true });
    if (response.windowId) await chrome.windows.update(response.windowId, { focused: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readPdfLibrary() {
  const stored = await chrome.storage.local.get(pdfLibrary.LIBRARY_KEY);
  return pdfLibrary.normalizeLibrary(stored[pdfLibrary.LIBRARY_KEY]);
}

function queuePdfLibraryMutation(mutator) {
  const work = pdfLibraryQueue.catch(() => {}).then(async () => {
    const papers = await readPdfLibrary();
    const result = mutator(papers) || { papers, paper: null };
    const normalized = pdfLibrary.normalizeLibrary(result.papers);
    await chrome.storage.local.set({ [pdfLibrary.LIBRARY_KEY]: normalized });
    return {
      papers: normalized,
      paper: result.paper ? pdfLibrary.findPaper(normalized, { id: result.paper.id }) : null
    };
  });
  pdfLibraryQueue = work;
  return work;
}

async function maybeOpenPdfReader(url, tabId) {
  if (!/^https?:\/\//i.test(String(url || "")) || isPdfReaderUrl(url)) return false;
  const recentTakeover = pdfTakeovers.get(tabId) || 0;
  if (Date.now() - recentTakeover < 5000) return false;
  pdfTakeovers.set(tabId, Date.now());

  const stored = await chrome.storage.local.get(SETTINGS_KEY).catch(() => ({}));
  const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  if (!settings.enhancedPdfEnabled) {
    pdfTakeovers.delete(tabId);
    return false;
  }

  try {
    await openPdfReader(url, tabId);
    return true;
  } catch (error) {
    pdfTakeovers.delete(tabId);
    console.warn("LexiLoop could not open the enhanced PDF reader", error);
    return false;
  }
}

async function translateAndOpen(text, tab, trigger, context = "", source) {
  await openPanelWithPayload({
    text,
    context,
    source: normalizeSource(source, pageSource(tab)),
    trigger
  }, tab?.windowId);
}

async function openPanelWithPayload(payload, windowId) {
  const storePayload = chrome.storage.session.set({ [PENDING_KEY]: payload });
  const openPanel = windowId
    ? chrome.sidePanel.open({ windowId }).catch(() => {})
    : Promise.resolve();

  // 在第一次 await 前调用 open，让 Chrome 保留用户点击手势。
  await Promise.all([storePayload, openPanel]);
  chrome.runtime.sendMessage({ type: "PANEL_SELECTION", payload }).catch(() => {});
}

function pageSource(tab) {
  return {
    title: tab?.title || "",
    url: tab?.url || ""
  };
}

function isLikelyPdfTab(tab) {
  const url = String(tab?.url || "");
  const title = String(tab?.title || "");
  return /\.pdf(?:$|[?#])/i.test(url)
    || /\.pdf\s*$/i.test(title)
    || url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/");
}

function isRemotePdfUrl(url) {
  return /^https?:\/\/.*\.pdf(?:$|[?#])/i.test(String(url || ""));
}

function isPdfResponse(details) {
  const headers = Array.isArray(details?.responseHeaders) ? details.responseHeaders : [];
  const contentType = headerValue(headers, "content-type").toLowerCase();
  const disposition = headerValue(headers, "content-disposition").toLowerCase();
  return /(?:^|;)\s*application\/(?:pdf|x-pdf)(?:\s*;|$)/i.test(`;${contentType}`)
    || /filename\*?\s*=.*\.pdf(?:["';]|$)/i.test(disposition);
}

function headerValue(headers, name) {
  return headers.find((header) => String(header?.name || "").toLowerCase() === name)?.value || "";
}

function isPdfReaderUrl(url) {
  return String(url || "").startsWith(chrome.runtime.getURL("pdf-reader.html"));
}

async function readClipboardText() {
  await ensureOffscreenDocument();
  try {
    const response = await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" });
    if (!response?.ok) throw new Error(response?.error || "无法读取剪贴板");
    return response.text || "";
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "读取用户在 PDF 阅读器中复制的选中文本以执行快捷键翻译"
    }).finally(() => {
      offscreenDocumentPromise = null;
    });
  }
  await offscreenDocumentPromise;
}

async function hasOffscreenDocument() {
  if (typeof chrome.offscreen.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")]
    });
    return contexts.length > 0;
  }
  return false;
}

// 词和短语才收进词库；长句、段落只翻译（上限与 PDF 段落一致），不当作词条
function shouldRecordLookup(text) {
  const value = cleanText(text, MAX_PDF_TEXT_LENGTH);
  if (!value) return false;
  if (/[㐀-鿿]/u.test(value)) return value.length <= 16;
  return value.length <= 64 && value.split(/\s+/).length <= 6;
}

async function translateAndRecord(text, metadata) {
  const record = shouldRecordLookup(text);
  const result = await translate(text, metadata.target, record ? MAX_TEXT_LENGTH : MAX_PDF_TEXT_LENGTH);
  if (!record) return { result: { ...result, recorded: false }, entry: null };
  const entry = await queueRecordLookup(result, metadata);
  return { result: { ...result, recorded: true }, entry };
}

async function translatePdfBatchWithSubscription(cleaned, requestedTarget, settings, preferred) {
  const groups = new Map();
  for (const text of [...new Set(cleaned.filter(Boolean))]) {
    const target = resolveTarget(text, requestedTarget, preferred);
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(text);
  }
  const translatedByText = new Map();
  for (const [target, texts] of groups) {
    for (let index = 0; index < texts.length; index += 12) {
      const chunk = texts.slice(index, index + 12);
      try {
        const results = await translationProviders.translateSubscriptionBatch(chunk, target, { settings });
        chunk.forEach((text, item) => translatedByText.set(text, results[item]));
      } catch (error) {
        for (const text of chunk) {
          try {
            const result = await translationProviders.textTranslate(text, target, { settings });
            translatedByText.set(text, { ok: true, translated: result.translated || text });
          } catch (itemError) {
            translatedByText.set(text, { ok: false, translated: text, error: itemError.message || error.message });
          }
        }
      }
    }
  }
  return cleaned.map((text) => ({ source: text, ...(translatedByText.get(text) || {
    ok: false, translated: text, error: "没有可翻译的文本"
  }) }));
}

async function translatePdfBatchTexts(texts, requestedTarget, translateText = translate) {
  const requested = Array.isArray(texts) ? texts.slice(0, MAX_PDF_TRANSLATION_BATCH) : [];
  const cleaned = requested.map((text) => cleanText(text, MAX_PDF_TEXT_LENGTH));
  const preferred = await preferredTargetLanguage();
  let settings = null;
  try { settings = await translationProviders.getRoleSettings("translation"); } catch { settings = null; }
  const config = settings ? translationProviders.normalizeConfig(settings.config) : null;
  if (config && (config.pdfAiAuth === "chatgpt" || config.pdfAiAuth === "grok")) {
    return translatePdfBatchWithSubscription(cleaned, requestedTarget, settings, preferred);
  }
  const uniqueTexts = [...new Set(cleaned.filter(Boolean))];
  const translatedByText = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < uniqueTexts.length) {
      const text = uniqueTexts[nextIndex];
      nextIndex += 1;
      try {
        const result = await translateText(text, requestedTarget, MAX_PDF_TEXT_LENGTH);
        translatedByText.set(text, { ok: true, translated: result.translated || text });
      } catch (error) {
        translatedByText.set(text, { ok: false, translated: text, error: error.message });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PDF_TRANSLATION_CONCURRENCY, uniqueTexts.length) }, worker)
  );
  return cleaned.map((text) => ({ source: text, ...(translatedByText.get(text) || {
    ok: false,
    translated: text,
    error: "没有可翻译的文本"
  }) }));
}

async function translate(text, requestedTarget, maxLength = MAX_TEXT_LENGTH) {
  const original = cleanText(text, maxLength);
  if (!original) throw new Error("没有可翻译的文本");

  const preferred = await preferredTargetLanguage();
  const targetLanguage = resolveTarget(original, requestedTarget, preferred);
  const errors = [];

  // 有道词典是中英互译，目标语言不是中文时直接走通用翻译
  if (isEnglishWord(original) && String(targetLanguage).startsWith("zh")) {
    try {
      const dictionaryResult = await translationProviders.dictionaryLookup(original, targetLanguage);
      if (dictionaryResult) return dictionaryResult;
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    return await translationProviders.textTranslate(original, targetLanguage);
  } catch (error) {
    errors.push(...(error.attempts || [error]));
  }

  console.warn("LexiLoop translation providers failed", errors);
  throw new translationProviders.ProviderAggregateError(errors);
}

async function translateWithYoudao(original, targetLanguage) {
  return translationProviders.translateWithYoudao(original, targetLanguage);
}

function extractYoudaoMeanings(data) {
  return translationProviders.extractYoudaoMeanings(data);
}

function readYoudaoWebTranslation(data) {
  return translationProviders.readYoudaoWebTranslation(data);
}

async function translateWithMyMemory(original, targetLanguage) {
  return translationProviders.translateWithMyMemory(original, targetLanguage);
}

async function translateWithGoogle(original, targetLanguage) {
  return translationProviders.translateWithGoogle(original, targetLanguage);
}

// 导入词库：与查词记录共用同一个写入队列，避免并发写坏
function queueWordsImport(imported) {
  const task = recordQueue.then(async () => {
    if (!Array.isArray(imported) || !imported.length) throw new Error("没有可导入的词条");
    const stored = await chrome.storage.local.get(WORDS_KEY);
    const result = globalThis.LexiLoopVocabIO.mergeImported(migrateWords(stored[WORDS_KEY]), imported.slice(0, 20000));
    await chrome.storage.local.set({ [WORDS_KEY]: migrateWords(result.words) });
    return { added: result.added, merged: result.merged, skipped: result.skipped };
  });
  recordQueue = task.catch(() => {});
  return task;
}

function queueRecordLookup(result, metadata) {
  const task = recordQueue.then(() => recordLookup(result, metadata));
  recordQueue = task.catch(() => {});
  return task;
}

function queueWordMutation({ id, action, grade, expectedDueAt, word: snapshot, index }) {
  const task = recordQueue.then(async () => {
    const stored = await chrome.storage.local.get(WORDS_KEY);
    const words = migrateWords(stored[WORDS_KEY]);
    if (action === 'restore') {
      // 撤销删除：把删除前的快照放回原位置；期间若重新查过同一个词则不覆盖。
      if (!snapshot || typeof snapshot !== 'object') throw new Error('无法恢复词条');
      const [restored] = migrateWords([snapshot]);
      if (!restored?.id || !restored.original) throw new Error('无法恢复词条');
      const term = normalizeTerm(restored.original);
      if (words.some(item => item.id === restored.id || normalizeTerm(item.original) === term)) throw new Error('这个词已经在词库中');
      const position = Math.min(Math.max(0, Math.floor(Number(index) || 0)), words.length);
      words.splice(position, 0, restored);
      await chrome.storage.local.set({ [WORDS_KEY]: words });
      return;
    }
    const word = words.find(item => item.id === id);
    if (!word) throw new Error('词条已被删除，请刷新后重试');
    if (action === 'delete') {
      await chrome.storage.local.set({ [WORDS_KEY]: words.filter(item => item.id !== id) });
      return;
    }
    const intervals = { again: [0, 0, 1, 1, 2, 3], hard: [1, 2, 3, 5, 8, 12], good: [1, 3, 7, 14, 30, 60] };
    if (action !== 'review' || !Object.hasOwn(intervals, grade)) throw new Error('无效的词库操作');
    if (word.review?.dueAt !== expectedDueAt) throw new Error('这条复习已在其他窗口更新，请刷新后重试');
    const stage = Math.max(0, Number(word.review?.stage || 0));
    const days = intervals[grade][Math.min(stage, intervals[grade].length - 1)];
    word.review = { stage: grade === 'again' ? 0 : grade === 'hard' ? Math.max(1, stage) : stage + 1,
      dueAt: new Date(Date.now() + (days ? days * 86400000 : 600000)).toISOString(), lastGrade: grade };
    await chrome.storage.local.set({ [WORDS_KEY]: words });
  });
  recordQueue = task.catch(() => {});
  return task;
}

async function recordLookup(result, metadata) {
  const stored = await chrome.storage.local.get(WORDS_KEY);
  const words = migrateWords(stored[WORDS_KEY]);
  const normalized = normalizeTerm(result.original);
  const existingIndex = words.findIndex((word) => normalizeTerm(word.original) === normalized);
  const existing = existingIndex >= 0 ? words[existingIndex] : null;
  const now = new Date().toISOString();
  const source = normalizeSource(metadata.source);
  const lookup = {
    id: crypto.randomUUID(),
    at: now,
    source,
    context: cleanContext(metadata.context),
    trigger: metadata.trigger || "manual"
  };
  const entry = {
    id: existing?.id || crypto.randomUUID(),
    original: result.original,
    translated: result.translated,
    detectedLanguage: result.detectedLanguage,
    targetLanguage: result.targetLanguage,
    phonetics: result.phonetics || existing?.phonetics || {},
    audio: result.audio || existing?.audio || {},
    meanings: result.meanings?.length ? result.meanings : existing?.meanings || [],
    service: result.service,
    context: lookup.context,
    source,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    translationCount: Math.max(0, Number(existing?.translationCount || 0)) + 1,
    lookups: [lookup, ...(existing?.lookups || [])],
    review: existing?.review || { stage: 0, dueAt: now }
  };

  if (existingIndex >= 0) words.splice(existingIndex, 1);
  words.unshift(entry);
  await chrome.storage.local.set({ [WORDS_KEY]: words });
  return entry;
}

async function initializeStorage() {
  const stored = await chrome.storage.local.get([WORDS_KEY, SETTINGS_KEY, pdfLibrary.LIBRARY_KEY]);
  const migrated = migrateWords(stored[WORDS_KEY]);
  await Promise.all([
    chrome.storage.local.set({
      [WORDS_KEY]: migrated,
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) },
      [pdfLibrary.LIBRARY_KEY]: pdfLibrary.normalizeLibrary(stored[pdfLibrary.LIBRARY_KEY])
    }),
    translationProviders.initializeStorage()
  ]);
}

function providerErrorResponse(error) {
  return {
    ok: false,
    error: error.message || "翻译服务请求失败",
    category: error.category || "unknown",
    requestPreview: error.details?.requestPreview || null,
    rawResponse: error.details?.rawResponse || ""
  };
}

function migrateWords(value) {
  if (!Array.isArray(value)) return [];
  return value.map((word) => {
    const createdAt = validDate(word.createdAt) || new Date().toISOString();
    const updatedAt = validDate(word.updatedAt) || createdAt;
    const source = normalizeSource(word.source);
    const lookups = Array.isArray(word.lookups) && word.lookups.length
      ? word.lookups.map((lookup) => ({
          id: lookup.id || crypto.randomUUID(),
          at: validDate(lookup.at) || updatedAt,
          source: normalizeSource(lookup.source, source),
          context: cleanContext(lookup.context),
          trigger: lookup.trigger || "legacy"
        }))
      : [{
          id: crypto.randomUUID(),
          at: updatedAt,
          source,
          context: cleanContext(word.context),
          trigger: "legacy"
        }];
    return {
      ...word,
      id: word.id || crypto.randomUUID(),
      phonetics: word.phonetics || {},
      audio: word.audio || {},
      meanings: Array.isArray(word.meanings) ? word.meanings : [],
      source,
      createdAt,
      updatedAt,
      translationCount: Math.max(Number(word.translationCount || 0), lookups.length, 1),
      lookups
    };
  });
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanContext(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 420);
}

function normalizeTerm(value) {
  return cleanText(value).toLocaleLowerCase();
}

function normalizeSource(source, fallback = {}) {
  const candidate = source && typeof source === "object" ? source : {};
  const normalized = {
    title: String(candidate.title || fallback.title || "手动输入").slice(0, 200),
    url: String(candidate.url || fallback.url || "").slice(0, 2000)
  };
  // PDF 来源：文献库 id、PDF 指纹与页码，用来从词库 / 复习卡跳回原文
  if (candidate.kind === "pdf" || candidate.paperId || candidate.documentKey) {
    normalized.kind = "pdf";
    const paperId = String(candidate.paperId || "").slice(0, 120);
    const documentKey = String(candidate.documentKey || "").slice(0, 300);
    const page = Math.floor(Number(candidate.page));
    if (paperId) normalized.paperId = paperId;
    if (documentKey) normalized.documentKey = documentKey;
    if (page > 0 && page < 100000) normalized.page = page;
  }
  return normalized;
}

// 调用方显式指定的语言优先；否则用设置里的目标语言；设置为 auto 时才按文本判断。
function resolveTarget(original, requestedTarget, preferred) {
  if (requestedTarget && requestedTarget !== "auto") return requestedTarget;
  const wanted = preferred || "auto";
  if (wanted !== "auto" && TARGET_LANGUAGES.includes(wanted)) return wanted;
  return hasCjk(original) ? "en" : "zh-CN";
}

async function preferredTargetLanguage() {
  if (preferredLanguageCache === null) {
    const stored = await chrome.storage.local.get(SETTINGS_KEY).catch(() => ({}));
    const settings = { ...DEFAULT_SETTINGS, ...(stored?.[SETTINGS_KEY] || {}) };
    const wanted = String(settings.targetLanguage || "auto");
    preferredLanguageCache = TARGET_LANGUAGES.includes(wanted) ? wanted : "auto";
  }
  return preferredLanguageCache;
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

function isEnglishWord(value) {
  return /^[A-Za-z][A-Za-z'-]{0,79}$/.test(value);
}

function validDate(value) {
  return value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : "";
}
