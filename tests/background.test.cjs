const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBackground(initialWords = [], overrides = {}) {
  const state = {
    lexiloopWords: structuredClone(initialWords),
    lexiloopTranslationConfig: overrides.translationConfig,
    lexiloopTranslationSecrets: overrides.translationSecrets
  };
  const noopEvent = { addListener() {} };
  const listeners = {};
  const recordEvent = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  const calls = { opened: [], clipboardReads: 0, sentToTab: 0, updatedTabs: [], createdTabs: [] };
  const chrome = {
    runtime: {
      onInstalled: noopEvent,
      onStartup: noopEvent,
      onMessage: noopEvent,
      async sendMessage(message) {
        if (message.type === "READ_CLIPBOARD") {
          calls.clipboardReads += 1;
          return { ok: true, text: overrides.clipboardText || "" };
        }
        return {};
      },
      getURL(value) { return `chrome-extension://test/${value}`; }
    },
    contextMenus: { onClicked: noopEvent },
    commands: { onCommand: recordEvent("command") },
    webRequest: { onHeadersReceived: noopEvent },
    tabs: {
      onUpdated: noopEvent,
      async sendMessage() {
        calls.sentToTab += 1;
        if (overrides.selection) return overrides.selection;
        throw new Error("content script unavailable");
      },
      async update(tabId, update) { calls.updatedTabs.push({ tabId, ...structuredClone(update) }); },
      async create(options) { calls.createdTabs.push(structuredClone(options)); }
    },
    sidePanel: {
      async open(options) { calls.panelOpens = (calls.panelOpens || 0) + 1; calls.panelOpenedBeforeSelection = calls.sentToTab === 0; return options; }
    },
    offscreen: {
      async hasDocument() { return false; },
      async createDocument() {},
      async closeDocument() {}
    },
    storage: {
      local: {
        async get(keys) { return readStorageState(state, keys); },
        async set(value) { Object.assign(state, structuredClone(value)); },
        async remove(key) { delete state[key]; }
      },
      sync: {
        async get(keys) { return readStorageState(state, keys); },
        async set(value) { Object.assign(state, structuredClone(value)); }
      },
      session: {
        async set(value) { calls.opened.push(structuredClone(value.lexiloopPending)); }
      }
    }
  };
  const context = vm.createContext({
    AbortController,
    URL,
    URLSearchParams,
    chrome,
    clearTimeout,
    console,
    crypto: crypto.webcrypto,
    fetch,
    importScripts() {},
    setTimeout
  });
  const filename = path.join(__dirname, "..", "background.js");
  const libraryFilename = path.join(__dirname, "..", "pdf-library.js");
  const metadataFilename = path.join(__dirname, "..", "paper-metadata.js");
  const providersFilename = path.join(__dirname, "..", "translation-providers.js");
  const vocabIoFilename = path.join(__dirname, "..", "vocab-io.js");
  const source = `${fs.readFileSync(libraryFilename, "utf8")}\n${fs.readFileSync(metadataFilename, "utf8")}\n${fs.readFileSync(providersFilename, "utf8")}\n${fs.readFileSync(vocabIoFilename, "utf8")}\n${fs.readFileSync(filename, "utf8")}\n` +
    "globalThis.__test = { extractYoudaoMeanings, readYoudaoWebTranslation, queueRecordLookup, queueWordMutation, queueWordsImport, normalizeSource, shouldRecordLookup, translatePdfBatchTexts, translateWithYoudao, isLikelyPdfTab, isRemotePdfUrl, isPdfResponse, openPdfReader, maybeOpenPdfReader, handleTranslateCommand, resolveTarget, preferredTargetLanguage };";
  vm.runInContext(source, context, { filename });
  return { api: context.__test, calls, state, listeners };
}

function readStorageState(state, keys) {
  const requested = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(requested.map((key) => [key, structuredClone(state[key])]).filter(([, value]) => value !== undefined));
}

test('review and delete never overwrite a concurrent lookup; stale grades are rejected', async () => {
  const { api, state } = loadBackground();
  const lookup = term => api.queueRecordLookup({ original: term, translated: term, service: 'test' }, {});
  await lookup('first');
  const first = structuredClone(state.lexiloopWords[0]);
  await Promise.all([
    api.queueWordMutation({ id: first.id, action: 'review', grade: 'good', expectedDueAt: first.review.dueAt }),
    lookup('second')
  ]);
  assert.equal(state.lexiloopWords.length, 2);
  assert.equal(state.lexiloopWords.find(word => word.id === first.id).review.stage, 1);
  await assert.rejects(api.queueWordMutation({ id: first.id, action: 'review', grade: 'good', expectedDueAt: first.review.dueAt }), /其他窗口/);
  await Promise.all([api.queueWordMutation({ id: first.id, action: 'delete' }), lookup('third')]);
  assert.deepEqual(state.lexiloopWords.map(word => word.original), ['third', 'second']);
});

test('recording a new lookup preserves more than 100 prior sources', async () => {
  const now = new Date().toISOString();
  const prior = Array.from({ length: 105 }, (_, index) => ({
    id: `lookup-${index}`, at: now, source: { title: `Page ${index}`, url: 'https://example.com' }, context: '', trigger: 'manual'
  }));
  const { api, state } = loadBackground([{
    id: 'word-1', original: 'loop', translated: '循环', translationCount: 105, lookups: prior
  }]);
  await api.queueRecordLookup({ original: 'loop', translated: '循环', service: 'test' }, {});
  assert.equal(state.lexiloopWords[0].lookups.length, 106);
  assert.equal(state.lexiloopWords[0].lookups.at(-1).id, 'lookup-104');
});

test("parses phonetic dictionary meanings by part of speech", () => {
  const { api } = loadBackground();
  const response = {
    expand_ec: {
      word: [{
        transList: [
          { pos: "n.", transList: [{ content: { trans: "循环；环状物" } }] },
          { pos: "v.", transList: [{ content: { trans: "使循环" } }] }
        ]
      }]
    },
    web_trans: { "web-translation": [{ trans: [{ value: "循环" }] }] }
  };
  assert.deepEqual(
    structuredClone(api.extractYoudaoMeanings(response)),
    [
      { partOfSpeech: "n.", definitions: ["循环；环状物"] },
      { partOfSpeech: "v.", definitions: ["使循环"] }
    ]
  );
  assert.equal(api.readYoudaoWebTranslation(response), "循环");
});

test("serializes repeated lookups and preserves both source records", async () => {
  const { api, state } = loadBackground();
  const result = {
    original: "loop",
    translated: "循环",
    detectedLanguage: "en",
    targetLanguage: "zh-CN",
    phonetics: { uk: "luːp", us: "luːp" },
    meanings: [{ partOfSpeech: "n.", definitions: ["循环"] }],
    service: "有道词典"
  };

  await Promise.all([
    api.queueRecordLookup(result, {
      source: { title: "页面 A", url: "https://example.com/a" },
      context: "first loop",
      trigger: "selection"
    }),
    api.queueRecordLookup(result, {
      source: { title: "页面 B", url: "https://example.com/b" },
      context: "second loop",
      trigger: "shortcut"
    })
  ]);

  assert.equal(state.lexiloopWords.length, 1);
  assert.equal(state.lexiloopWords[0].translationCount, 2);
  assert.deepEqual(
    state.lexiloopWords[0].lookups.map((lookup) => lookup.source.title),
    ["页面 B", "页面 A"]
  );
  assert.deepEqual(
    state.lexiloopWords[0].lookups.map((lookup) => lookup.trigger),
    ["shortcut", "selection"]
  );
});

test("migrates an old saved entry before incrementing it", async () => {
  const { api, state } = loadBackground([{
    id: "legacy-word",
    original: "Loop",
    translated: "循环",
    source: { title: "旧页面", url: "https://example.com/old" },
    context: "old context",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  }]);
  await api.queueRecordLookup({
    original: "loop",
    translated: "循环",
    detectedLanguage: "en",
    targetLanguage: "zh-CN",
    phonetics: {},
    meanings: [],
    service: "有道词典"
  }, {
    source: { title: "新页面", url: "https://example.com/new" },
    trigger: "selection"
  });

  assert.equal(state.lexiloopWords[0].id, "legacy-word");
  assert.equal(state.lexiloopWords[0].translationCount, 2);
  assert.equal(state.lexiloopWords[0].lookups.length, 2);
});

test("shows direct translation instead of dictionary fields for phrases", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        web_trans: { "web-translation": [{ trans: [{ value: "产生影响" }] }] },
        ec: { word: [{ trs: [{ tr: [{ l: { i: ["产生影响：引起变化。"] } }] }] }] }
      };
    }
  });
  try {
    const { api } = loadBackground();
    const result = await api.translateWithYoudao("make a difference", "zh-CN");
    assert.equal(result.translated, "产生影响");
    assert.deepEqual(structuredClone(result.meanings), []);
    assert.deepEqual(structuredClone(result.phonetics), {});
  } finally {
    global.fetch = originalFetch;
  }
});

test('translation target language follows the setting instead of always swapping Chinese and English', async () => {
  const { api, state } = loadBackground();
  // 默认（auto）：英文译成中文，中文译成英文
  assert.equal(api.resolveTarget('hello world', 'auto', 'auto'), 'zh-CN');
  assert.equal(api.resolveTarget('你好世界', 'auto', 'auto'), 'en');
  // 固定语言：两边都译成同一种
  assert.equal(api.resolveTarget('hello world', 'auto', 'ja'), 'ja');
  assert.equal(api.resolveTarget('你好世界', 'auto', 'ja'), 'ja');
  assert.equal(api.resolveTarget('hello world', 'auto', 'de'), 'de');
  // 调用方显式指定的语言优先于设置
  assert.equal(api.resolveTarget('hello world', 'fr', 'ja'), 'fr');
  // 不认识的值回落到自动判断
  assert.equal(api.resolveTarget('hello world', 'auto', 'klingon'), 'zh-CN');

  // 从设置里读出来的值
  state.lexiloopSettings = { targetLanguage: 'ko' };
  assert.equal(await api.preferredTargetLanguage(), 'ko');
  state.lexiloopSettings = { targetLanguage: 'nope' };
  assert.equal(await api.preferredTargetLanguage(), 'ko', '缓存有效时不重复读存储');
});

test("translates PDF batches without recording them in the word library", async () => {
  const { api, state } = loadBackground();
  const calls = [];
  const translations = await api.translatePdfBatchTexts(
    ["First line", "Second line", "First line"],
    "zh-CN",
    async (text) => {
      calls.push(text);
      return { translated: `译：${text}` };
    }
  );

  assert.deepEqual(calls.sort(), ["First line", "Second line"]);
  assert.deepEqual(
    structuredClone(translations.map((item) => item.translated)),
    ["译：First line", "译：Second line", "译：First line"]
  );
  assert.deepEqual(state.lexiloopWords, []);
});

test("keeps original PDF text when an individual batch translation fails", async () => {
  const { api } = loadBackground();
  const translations = await api.translatePdfBatchTexts(["works", "fails"], "zh-CN", async (text) => {
    if (text === "fails") throw new Error("provider unavailable");
    return { translated: "正常" };
  });

  assert.equal(translations[0].translated, "正常");
  assert.equal(translations[0].ok, true);
  assert.equal(translations[1].translated, "fails");
  assert.equal(translations[1].ok, false);
});

test("uses the current page selection before considering the clipboard", async () => {
  const { api, calls } = loadBackground([], {
    selection: { text: "selected word", context: "page context" },
    clipboardText: "stale clipboard"
  });
  await api.handleTranslateCommand({
    id: 4,
    windowId: 2,
    title: "Article",
    url: "https://example.com/article"
  });

  assert.equal(calls.opened[0].text, "selected word");
  assert.equal(calls.opened[0].context, "page context");
  assert.equal(calls.opened[0].trigger, "shortcut");
  assert.equal(calls.clipboardReads, 0);
});

test("uses copied text when the shortcut runs in Chrome PDF viewer", async () => {
  const { api, calls } = loadBackground([], { clipboardText: "resilient" });
  const pdfTab = {
    id: 8,
    windowId: 3,
    title: "research-paper.pdf",
    url: "file:///Users/test/research-paper.pdf"
  };
  assert.equal(api.isLikelyPdfTab(pdfTab), true);
  await api.handleTranslateCommand(pdfTab);

  assert.equal(calls.clipboardReads, 1);
  assert.equal(calls.opened[0].text, "resilient");
  assert.equal(calls.opened[0].trigger, "pdf-clipboard");
  assert.equal(calls.opened[0].source.title, "research-paper.pdf");
});

test("shows a PDF copy hint when the clipboard is empty", async () => {
  const { api, calls } = loadBackground([], { clipboardText: "" });
  await api.handleTranslateCommand({
    id: 9,
    windowId: 3,
    title: "PDF",
    url: "https://example.com/guide.pdf#page=4"
  });

  assert.match(calls.opened[0].notice, /先复制/);
  assert.equal(calls.opened[0].text, "");
});

test("adds dictionary audio URLs to English word results", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        simple: { word: [{ ukphone: "luːp", usphone: "luːp" }] },
        web_trans: { "web-translation": [{ trans: [{ value: "循环" }] }] }
      };
    }
  });
  try {
    const { api } = loadBackground();
    const result = await api.translateWithYoudao("loop", "zh-CN");
    assert.match(result.audio.uk, /dictvoice\?audio=loop&type=1/);
    assert.match(result.audio.us, /dictvoice\?audio=loop&type=2/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("opens a remote PDF in the bundled reader", async () => {
  const { api, calls } = loadBackground();
  assert.equal(api.isRemotePdfUrl("https://example.com/paper.pdf#page=2"), true);
  assert.equal(api.isRemotePdfUrl("file:///tmp/paper.pdf"), false);
  await api.openPdfReader("https://example.com/paper.pdf#page=2", 12);

  assert.equal(calls.updatedTabs[0].tabId, 12);
  assert.match(calls.updatedTabs[0].url, /^chrome-extension:\/\/test\/pdf-reader\.html\?/);
  assert.match(decodeURIComponent(calls.updatedTabs[0].url), /https:\/\/example\.com\/paper\.pdf#page=2/);
});

test("passes a header-detected PDF URL without a PDF suffix to the reader", async () => {
  const { api, calls } = loadBackground();
  const url = "https://example.com/download?id=research-paper";
  await api.openPdfReader(url, 14);

  assert.equal(calls.updatedTabs[0].tabId, 14);
  assert.equal(new URL(calls.updatedTabs[0].url).searchParams.get("url"), url);
});

test("opens a saved library paper by id", async () => {
  const { api, calls } = loadBackground();
  await api.openPdfReader("", undefined, "paper-a", { page: 7, forceIndex: true });

  assert.equal(calls.createdTabs.length, 1);
  assert.equal(new URL(calls.createdTabs[0].url).searchParams.get("library"), "paper-a");
  assert.equal(new URL(calls.createdTabs[0].url).searchParams.get("page"), "7");
  assert.equal(new URL(calls.createdTabs[0].url).searchParams.get("index"), "force");
});

test("deduplicates simultaneous PDF takeover signals for one tab", async () => {
  const { api, calls } = loadBackground();
  const url = "https://example.com/paper.pdf";
  const results = await Promise.all([
    api.maybeOpenPdfReader(url, 15),
    api.maybeOpenPdfReader(url, 15)
  ]);

  assert.equal(calls.updatedTabs.length, 1);
  assert.deepEqual(results.sort(), [false, true]);
});

test("recognizes PDF responses even when the URL has no PDF suffix", () => {
  const { api } = loadBackground();
  assert.equal(api.isPdfResponse({
    responseHeaders: [{ name: "Content-Type", value: "application/pdf; charset=binary" }]
  }), true);
  assert.equal(api.isPdfResponse({
    responseHeaders: [{ name: "Content-Disposition", value: "inline; filename=paper.pdf" }]
  }), true);
  assert.equal(api.isPdfResponse({
    responseHeaders: [{ name: "Content-Type", value: "text/html" }]
  }), false);
});

test('restoring a deleted word puts the snapshot back at its index and refuses duplicates', async () => {
  const { api, state } = loadBackground([]);
  const lookup = term => api.queueRecordLookup({ original: term, translated: term, service: 'test' }, {});
  await lookup('alpha');
  await lookup('beta');
  await lookup('gamma');
  const index = state.lexiloopWords.findIndex(word => word.original === 'beta');
  const snapshot = structuredClone(state.lexiloopWords[index]);
  await api.queueWordMutation({ id: snapshot.id, action: 'delete' });
  assert.equal(state.lexiloopWords.some(word => word.id === snapshot.id), false);
  await api.queueWordMutation({ action: 'restore', word: snapshot, index });
  assert.equal(state.lexiloopWords[index].id, snapshot.id);
  assert.equal(state.lexiloopWords[index].translationCount, snapshot.translationCount);
  await assert.rejects(api.queueWordMutation({ action: 'restore', word: snapshot, index }), /已经在词库/);
  await assert.rejects(api.queueWordMutation({ action: 'restore', word: null, index: 0 }), /无法恢复/);
});

test("PDF 来源：保存文献 id、PDF 指纹与页码；网页来源不带这些字段", () => {
  const { api } = loadBackground();
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeSource({ title: "Paper", url: "", kind: "pdf", paperId: "p1", documentKey: "fp", page: 7 }))), { title: "Paper", url: "", kind: "pdf", paperId: "p1", documentKey: "fp", page: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeSource({ title: "Web", url: "https://a.org" }))), { title: "Web", url: "https://a.org" });
});

test("长句、段落只翻译不收录；词和短语照常收录", () => {
  const { api } = loadBackground();
  assert.equal(api.shouldRecordLookup("embodiment"), true);
  assert.equal(api.shouldRecordLookup("state space model"), true);
  assert.equal(api.shouldRecordLookup("This is a full sentence that should not become a vocabulary entry."), false);
  assert.equal(api.shouldRecordLookup("具身智能"), true);
  assert.equal(api.shouldRecordLookup("这是一整句很长的中文句子不应该作为词条收录进词库"), false);
});

test("导入词库：经由写入队列合并，与查词记录不互相覆盖", async () => {
  const { api, state } = loadBackground();
  await api.queueRecordLookup({ original: "ground", translated: "使接地", service: "test" }, {});
  const [result] = await Promise.all([
    api.queueWordsImport([{ original: "Ground", translated: "x" }, { original: "token", translated: "词元" }]),
    api.queueRecordLookup({ original: "embodiment", translated: "具身", service: "test" }, {})
  ]);
  assert.equal(result.added, 1);
  assert.deepEqual(state.lexiloopWords.map((word) => word.original).sort(), ["embodiment", "ground", "token"]);
});

test("快捷键：先同步打开侧边栏，再去读选区（保留用户手势）", async () => {
  const { listeners, calls } = loadBackground([], { selection: { text: "token", context: "" } });
  listeners.command("translate-selection", { id: 1, windowId: 9, url: "https://a.org" });
  assert.equal(calls.panelOpens, 1);
  assert.equal(calls.panelOpenedBeforeSelection, true);
});
