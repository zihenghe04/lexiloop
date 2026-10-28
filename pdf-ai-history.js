(() => {
  const HISTORY_KEY = "lexiloopPdfAiHistory";

  function normalizeMessage(value) {
    if (!value || typeof value !== "object") return null;
    const content = String(value.content || "").trim();
    if (!content) return null;
    return {
      role: value.role === "assistant" ? "assistant" : "user",
      incomplete: value.incomplete === true,
      content,
      meta: String(value.meta || "").trim().slice(0, 400),
      attachment: value.attachment === "screenshot" ? "screenshot" : "",
      createdAt: Number(value.createdAt) || Date.now()
    };
  }

  function normalizeEntry(value) {
    const input = value && typeof value === "object" ? value : {};
    const legacyMessages = Array.isArray(input.messages) ? input.messages : [];
    const sourceConversations = Array.isArray(input.conversations) && input.conversations.length
      ? input.conversations
      : (legacyMessages.length ? [{
          id: `legacy-${Number(input.updatedAt) || 0}`,
          title: conversationTitle(legacyMessages),
          createdAt: Number(input.updatedAt) || Date.now(),
          updatedAt: Number(input.updatedAt) || Date.now(),
          messages: legacyMessages
        }] : []);
    const conversations = sourceConversations
      .map(normalizeConversation)
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const requestedActiveId = String(input.activeConversationId || "");
    return {
      title: String(input.title || "PDF 文档").trim().slice(0, 300),
      sourceUrl: String(input.sourceUrl || "").trim().slice(0, 2_000),
      updatedAt: Number(input.updatedAt) || 0,
      activeConversationId: conversations.some((conversation) => conversation.id === requestedActiveId)
        ? requestedActiveId
        : (conversations[0]?.id || ""),
      conversations
    };
  }

  function normalizeConversation(value) {
    if (!value || typeof value !== "object") return null;
    const messages = (Array.isArray(value.messages) ? value.messages : [])
      .map(normalizeMessage)
      .filter(Boolean);
    const createdAt = Number(value.createdAt) || messages[0]?.createdAt || Date.now();
    const updatedAt = Number(value.updatedAt) || messages.at(-1)?.createdAt || createdAt;
    const id = String(value.id || `conversation-${createdAt}`).trim().slice(0, 200);
    if (!id) return null;
    return {
      id,
      title: String(value.title || conversationTitle(messages) || "新对话").replace(/\s+/g, " ").trim().slice(0, 80),
      createdAt,
      updatedAt,
      messages
    };
  }

  function conversationTitle(messages) {
    const firstQuestion = (Array.isArray(messages) ? messages : [])
      .find((message) => message?.role !== "assistant" && String(message?.content || "").trim());
    const content = String(firstQuestion?.content || "").replace(/\s+/g, " ").trim();
    if (!content) return "";
    return content.length > 32 ? `${content.slice(0, 32)}…` : content;
  }

  function normalizeStore(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value)
      .filter(([key]) => key)
      .map(([key, entry]) => [String(key).slice(0, 500), normalizeEntry(entry)])
      .filter(([, entry]) => entry.conversations.length);
    return Object.fromEntries(entries);
  }

  function updateDocumentHistory(store, documentKey, entry) {
    const key = String(documentKey || "").trim().slice(0, 500);
    if (!key) return normalizeStore(store);
    const next = normalizeStore(store);
    const newestUpdate = Object.values(next).reduce((latest, item) => Math.max(latest, item.updatedAt), 0);
    const normalized = normalizeEntry({ ...entry, updatedAt: Math.max(Date.now(), newestUpdate + 1) });
    if (normalized.conversations.length) next[key] = normalized;
    else delete next[key];
    return normalizeStore(next);
  }

  function removeDocumentHistory(store, documentKey) {
    const next = normalizeStore(store);
    delete next[String(documentKey || "")];
    return next;
  }

  const api = Object.freeze({
    HISTORY_KEY,
    normalizeMessage,
    normalizeConversation,
    normalizeEntry,
    conversationTitle,
    normalizeStore,
    updateDocumentHistory,
    removeDocumentHistory
  });

  globalThis.LexiLoopPdfAiHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
