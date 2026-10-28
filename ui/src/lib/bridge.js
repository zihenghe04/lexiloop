// 数据访问层：只走既有的后台消息契约，不直接碰 secrets 键。
// 在没有扩展 API 的普通页面（内置浏览器预览）里，自动回落到演示数据。
import {
  demoConnections,
  demoPapers,
  demoSettings,
  demoTranslation,
  demoWords
} from "./demo.js";

export const WORDS_KEY = "lexiloopWords";
export const SETTINGS_KEY = "lexiloopSettings";
export const THEME_KEY = "lexiloopReaderTheme";

let demoWordState = demoWords.map((word) => ({ ...word }));
let demoPaperState = demoPapers.map((paper) => ({ ...paper }));

export function isPreview() {
  return !(typeof chrome !== "undefined" && chrome?.runtime?.id);
}

const pause = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(type, payload = {}) {
  if (isPreview()) return demoResponse(type, payload);
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response) throw new Error("扩展后台没有响应，请重新加载扩展");
  if (response.ok === false) throw new Error(response.error || "请求失败");
  return response;
}

export async function getSettings() {
  return request("GET_TRANSLATION_SETTINGS");
}

export async function translate(text, options = {}) {
  const response = await request("TRANSLATE", {
    text,
    target: options.target || "auto",
    context: options.context || "",
    source: options.source || undefined,
    trigger: options.trigger || "manual"
  });
  return response.result;
}

export async function readWords() {
  if (isPreview()) {
    await pause(60);
    return demoWordState.map((word) => ({ ...word }));
  }
  const stored = await chrome.storage.local.get(WORDS_KEY);
  return Array.isArray(stored[WORDS_KEY]) ? stored[WORDS_KEY] : [];
}

export async function mutateWord(change) {
  if (isPreview()) {
    if (change.action === "delete") {
      demoWordState = demoWordState.filter((word) => word.id !== change.id);
    }
    if (change.action === "review" && change.id) {
      demoWordState = demoWordState.map((word) => (word.id === change.id
        ? { ...word, review: { dueAt: new Date(Date.now() + 86400000).toISOString(), interval: 2, ease: 2.5 } }
        : word));
    }
    await pause(80);
    return readWords();
  }
  const response = await request("WORD_MUTATE", change);
  if (!response.ok) throw new Error(response.error || "词库更新失败");
  return readWords();
}

export async function readUiSettings() {
  if (isPreview()) {
    await pause(40);
    return { ...demoSettings };
  }
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...demoSettings, ...(stored[SETTINGS_KEY] || {}) };
}

export async function writeUiSettings(patch) {
  if (isPreview()) {
    Object.assign(demoSettings, patch);
    return { ...demoSettings };
  }
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const next = { ...(stored[SETTINGS_KEY] || {}), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getLibrary() {
  const response = await request("PDF_LIBRARY_GET");
  return Array.isArray(response.papers) ? response.papers : [];
}

export async function patchPaper(id, changes) {
  if (isPreview()) {
    demoPaperState = demoPaperState.map((paper) => (paper.id === id ? { ...paper, ...changes } : paper));
    await pause(60);
    return demoPaperState;
  }
  const response = await request("PDF_LIBRARY_PATCH", { id, changes });
  return Array.isArray(response.papers) ? response.papers : [];
}

export async function removePaper(id) {
  if (isPreview()) {
    demoPaperState = demoPaperState.filter((paper) => paper.id !== id);
    await pause(60);
    return demoPaperState;
  }
  const response = await request("PDF_LIBRARY_REMOVE", { id });
  return Array.isArray(response.papers) ? response.papers : [];
}

export async function upsertPaper(paper) {
  if (isPreview()) {
    demoPaperState = [paper, ...demoPaperState];
    await pause(60);
    return demoPaperState;
  }
  const response = await request("PDF_LIBRARY_UPSERT", { paper });
  return Array.isArray(response.papers) ? response.papers : [];
}

async function localPdfId(file) {
  if (crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return `local-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return `local-${Date.now().toString(16)}`;
}

// 导入本地 PDF：写入 IndexedDB（复用 pdf-library.js 的 putPdfBlob），再登记到文献库
export async function importLocalPdf(file) {
  if (!file) throw new Error("没有选择文件");
  if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    throw new Error("请选择 PDF 文件");
  }
  if (isPreview()) {
    await pause(120);
    const id = `local-demo-${Date.now()}`;
    const paper = {
      id,
      title: file.name.replace(/\.pdf$/i, "") || file.name,
      fileName: file.name,
      fileSize: file.size,
      sourceType: "local",
      status: "unread",
      progress: 0,
      currentPage: 1,
      pageCount: null,
      updatedAt: new Date().toISOString()
    };
    demoPaperState = [paper, ...demoPaperState];
    return paper;
  }
  const lib = globalThis.LexiLoopPdfLibrary;
  if (!lib?.putPdfBlob) throw new Error("PDF 模块未加载，请重新加载扩展");
  const id = await localPdfId(file);
  await lib.putPdfBlob(id, file);
  try {
    const response = await request("PDF_LIBRARY_UPSERT", {
      paper: {
        id,
        title: file.name.replace(/\.pdf$/i, "") || file.name,
        fileName: file.name,
        fileSize: file.size,
        sourceType: "local",
        status: "unread"
      }
    });
    return response.paper || { id };
  } catch (error) {
    try { await lib.deletePdfBlob?.(id); } catch {}
    throw error;
  }
}

export function backupModule() {
  return globalThis.LexiLoopBackup || null;
}

export async function ccSwitchPreview() {
  if (isPreview()) {
    await pause(80);
    return { ok: true, providers: [], missing: true };
  }
  return request("CC_SWITCH_PREVIEW", {});
}

export async function saveConnection(config, options = {}) {
  return request("SAVE_TRANSLATION_SETTINGS", {
    config,
    apiKey: options.apiKey,
    clearApiKey: Boolean(options.clearApiKey),
    activate: options.activate !== false,
    connection: options.connection
  });
}

export async function removeConnection(id) {
  if (isPreview()) {
    await pause(80);
    return demoResponse("GET_TRANSLATION_SETTINGS");
  }
  return request("REMOVE_CONNECTION", { id });
}

export async function assignRoles(roles) {
  if (isPreview()) {
    await pause(60);
    return demoResponse("GET_TRANSLATION_SETTINGS");
  }
  return request("ASSIGN_CONNECTION_ROLES", { roles });
}

export async function testProvider(config, apiKey) {
  return request("TEST_TRANSLATION_PROVIDER", { config, apiKey });
}

export async function listModels(config, apiKey) {
  return request("LIST_API_MODELS", { config, apiKey: apiKey || undefined });
}

export async function oauthAccount(provider, action = "status") {
  return request("OAUTH_ACCOUNT", { provider, action });
}

// 后台契约字段名是 libraryId。早前这里写成 paperId，后台读不到，
// 于是退回 sender.tab.url，表现就是「点文献没有任何反应」。
export async function openReader(paperId, options = {}) {
  if (isPreview()) return { ok: true };
  return request("OPEN_PDF_READER", {
    libraryId: paperId || "",
    page: Number(options.page) > 0 ? Math.floor(Number(options.page)) : undefined,
    find: options.find || undefined,
    forceIndex: Boolean(options.forceIndex),
    reuse: Boolean(options.reuse)
  });
}

/** 词条最近一次被查到的位置（PDF 来源或网页来源） */
export function wordSourceOf(word) {
  const lookups = Array.isArray(word?.lookups) ? word.lookups : [];
  for (let index = lookups.length - 1; index >= 0; index -= 1) {
    const source = lookups[index]?.source;
    if (!source) continue;
    if (source.paperId || source.documentKey || /^https?:\/\//i.test(source.url || "")) return source;
  }
  return null;
}

/** 从词库跳回这个词出现的原文位置；sourceOverride 用于指定某一条历史记录 */
export async function openWordSource(word, sourceOverride = null) {
  const source = sourceOverride || wordSourceOf(word);
  if (!source) return null;
  if (isPreview()) return { ok: true };
  return request("OPEN_PDF_READER", {
    libraryId: source.paperId || "",
    url: /^https?:\/\//i.test(source.url || "") ? source.url : "",
    documentKey: source.documentKey || "",
    page: Number(source.page) > 0 ? Math.floor(Number(source.page)) : undefined,
    find: word.original,
    reuse: true
  });
}

export async function openPdfReaderBlank() {
  if (isPreview()) return { ok: true };
  return request("OPEN_PDF_READER", {});
}

export async function openSettingsShortcuts() {
  if (isPreview()) return { ok: true };
  return request("OPEN_SHORTCUT_SETTINGS");
}

// ---- 主题：与阅读器共用 localStorage 键，保持双向同步 ----
export function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return ["light", "sepia", "dark"].includes(value) ? value : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme) {
  const value = ["light", "sepia", "dark"].includes(theme) ? theme : "light";
  if (value === "light") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME_KEY, value); } catch {}
  return value;
}

export function nextTheme(theme) {
  const order = ["light", "sepia", "dark"];
  return order[(order.indexOf(theme) + 1) % order.length];
}

// ---- 预览模式的分发 ----
function demoResponse(type, payload = {}) {
  const profiles = Object.fromEntries(demoConnections.map(({ config, ...rest }) => [rest.id, { ...rest, config }]));
  switch (type) {
    case "GET_TRANSLATION_SETTINGS":
      return {
        ok: true,
        config: demoConnections[0].config,
        hasApiKey: true,
        connections: demoConnections.map(({ config, hasApiKey, ...rest }) => ({ ...rest, hasApiKey })),
        profiles,
        roles: { translation: "original", ai: "original" },
        builtinAvailable: { original: true },
        originalAvailable: true
      };
    case "TRANSLATE": {
      // 和真实后台保持一致：英文单词返回词典结构（音标/词性/释义/发音），句子只返回译文
      const value = String(payload.text || "").trim();
      const word = demoWordState.find((item) => String(item.original).toLowerCase() === value.toLowerCase());
      if (word) {
        return {
          ok: true,
          result: {
            original: word.original,
            translated: word.translated,
            detectedLanguage: "en",
            targetLanguage: payload.target || "zh-CN",
            phonetics: word.phonetics || {},
            audio: word.audio || {},
            meanings: word.meanings || [],
            service: "有道词典",
            recorded: true,
            entryId: word.id,
            translationCount: Number(word.translationCount || 1)
          }
        };
      }
      return {
        ok: true,
        result: {
          original: value,
          translated: demoTranslation.translated,
          detectedLanguage: "en",
          targetLanguage: payload.target || "zh-CN",
          service: demoTranslation.service,
          recorded: false
        }
      };
    }
    case "PDF_LIBRARY_GET":
      return { ok: true, papers: demoPaperState.map((paper) => ({ ...paper })) };
    case "WORD_MUTATE":
      return { ok: true };
    case "TEST_TRANSLATION_PROVIDER":
      return { ok: true, message: "连接成功（演示）", sample: "The quick brown fox jumps over the lazy dog." };
    case "LIST_API_MODELS":
      return { ok: true, models: ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017", "grok-4.7", "grok-4.6"] };
    default:
      return { ok: true, type, payload };
  }
}