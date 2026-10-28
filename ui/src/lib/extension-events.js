const VALID_TABS = new Set(["lookup", "words", "review", "library"]);
const WORDS_KEY = "lexiloopWords";
const SETTINGS_KEY = "lexiloopSettings";
const PAPERS_KEY = "lexiloopPdfLibrary";
const PENDING_KEY = "lexiloopPending";
const PANEL_TAB_KEY = "lexiloopPanelTab";
const SETTINGS_PENDING_KEY = "lexiloopSettingsPending";

export function subscribeExtension(api, { onWords, onPapers, onSettings, onSelection, onTab } = {}) {
  const storageHandler = (changes, area) => {
    if (area !== "local") return;
    if (changes[WORDS_KEY]) onWords?.(Array.isArray(changes[WORDS_KEY].newValue) ? changes[WORDS_KEY].newValue : []);
    if (changes[PAPERS_KEY]) onPapers?.(changes[PAPERS_KEY].newValue);
    if (changes[SETTINGS_KEY]) onSettings?.(changes[SETTINGS_KEY].newValue || {});
  };
  const messageHandler = (message) => {
    if (message?.type === "PANEL_SELECTION") onSelection?.(message.payload);
    if (message?.type === "SHOW_PANEL_TAB" && VALID_TABS.has(message.tab)) onTab?.(message.tab);
  };
  api?.storage?.onChanged?.addListener(storageHandler);
  api?.runtime?.onMessage?.addListener(messageHandler);
  return () => {
    api?.storage?.onChanged?.removeListener(storageHandler);
    api?.runtime?.onMessage?.removeListener(messageHandler);
  };
}

export async function consumePanelIntent(api) {
  const session = await api.storage.session.get([PENDING_KEY, PANEL_TAB_KEY, SETTINGS_PENDING_KEY]);
  const intent = {
    selection: session[PENDING_KEY] || null,
    tab: VALID_TABS.has(session[PANEL_TAB_KEY]) ? session[PANEL_TAB_KEY] : null,
    settings: Boolean(session[SETTINGS_PENDING_KEY])
  };
  if (intent.selection || intent.tab || intent.settings) {
    await api.storage.session.remove([PENDING_KEY, PANEL_TAB_KEY, SETTINGS_PENDING_KEY]);
  }
  return intent;
}

export const extensionKeys = { WORDS_KEY, SETTINGS_KEY, PAPERS_KEY, PENDING_KEY, PANEL_TAB_KEY, SETTINGS_PENDING_KEY };
