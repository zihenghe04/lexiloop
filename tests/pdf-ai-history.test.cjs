const test = require("node:test");
const assert = require("node:assert/strict");

const history = require("../pdf-ai-history.js");

test('preserves long answers and incomplete markers when reloading history', () => {
  const content = 'Long paragraph. '.repeat(700) + '\\[x^2 + y^2\\]';
  const store = history.updateDocumentHistory({}, 'long-pdf', {
    messages: [{ role: 'assistant', content, incomplete: true }]
  });
  const restored = history.normalizeStore(JSON.parse(JSON.stringify(store)));
  const message = restored['long-pdf'].conversations[0].messages[0];
  assert.equal(message.content, content);
  assert.equal(message.incomplete, true);
});

test("migrates legacy messages into the first document conversation", () => {
  const updated = history.updateDocumentHistory({}, "fingerprint-a", {
    title: "Paper A",
    messages: [
      { role: "user", content: "解释截图", attachment: "screenshot", imageDataUrl: "data:image/jpeg;base64,large" },
      { role: "assistant", content: "这是一个公式。", meta: "model-a · p.2" }
    ]
  });

  const entry = updated["fingerprint-a"];
  assert.equal(entry.conversations.length, 1);
  assert.equal(entry.activeConversationId, entry.conversations[0].id);
  assert.equal(entry.conversations[0].title, "解释截图");
  assert.equal(entry.conversations[0].messages[0].attachment, "screenshot");
  assert.equal(entry.conversations[0].messages[0].imageDataUrl, undefined);
  assert.equal(history.removeDocumentHistory(updated, "fingerprint-a")["fingerprint-a"], undefined);
});

test("keeps every message, conversation and document after normalization", () => {
  const conversationCount = 20;
  const messageCount = 70;
  const documentCount = 27;
  let store = history.updateDocumentHistory({}, "conversation-heavy", {
    activeConversationId: "conversation-newest",
    conversations: Array.from({ length: conversationCount }, (_, conversationIndex) => ({
      id: conversationIndex === conversationCount - 1 ? "conversation-newest" : `conversation-${conversationIndex}`,
      updatedAt: conversationIndex,
      messages: Array.from({ length: messageCount }, (_, messageIndex) => ({
        role: messageIndex % 2 ? "assistant" : "user",
        content: `message-${messageIndex}`
      }))
    }))
  });
  const heavyEntry = store["conversation-heavy"];
  assert.equal(heavyEntry.conversations.length, conversationCount);
  assert.equal(heavyEntry.conversations[0].messages.length, messageCount);
  assert.equal(heavyEntry.activeConversationId, "conversation-newest");

  store = {};
  for (let index = 0; index < documentCount; index += 1) {
    store = history.updateDocumentHistory(store, `doc-${index}`, {
      conversations: [{ id: `chat-${index}`, messages: [{ role: "user", content: `question-${index}` }] }]
    });
  }

  assert.equal(Object.keys(store).length, documentCount);
  assert.ok(store['doc-0']);
  assert.ok(store[`doc-${documentCount - 1}`]);
});

test("preserves long answers and inactive conversations without a character budget", () => {
  const hugeMessage = "内容".repeat(60_000);
  const store = history.updateDocumentHistory({}, "large-document", {
    activeConversationId: "active-chat",
    conversations: Array.from({ length: 3 }, (_, index) => ({
      id: index === 2 ? "active-chat" : `chat-${index}`,
      updatedAt: index,
      messages: [{ role: "assistant", content: hugeMessage }]
    }))
  });

  const entry = store["large-document"];
  assert.ok(entry);
  assert.equal(entry.activeConversationId, "active-chat");
  assert.equal(entry.conversations.length, 3);
  assert.equal(entry.conversations[0].messages[0].content, hugeMessage);
});
