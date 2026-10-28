chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "READ_CLIPBOARD") return;
  navigator.clipboard.readText()
    .then((text) => sendResponse({ ok: true, text }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
