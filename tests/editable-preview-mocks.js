const previewParams = new URLSearchParams(location.search);
const previewMode = previewParams.get("mode") || "input";
const bubbleEnabled = !previewParams.has("off");
let runtimeListener;

window.chrome = {
  storage: {
    local: {
      async get() {
        return { lexiloopSettings: { selectionBubbleEnabled: bubbleEnabled, enhancedPdfEnabled: true } };
      }
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    onMessage: { addListener(listener) { runtimeListener = listener; } },
    async sendMessage() { return { ok: true }; }
  }
};

window.addEventListener("load", () => {
  if (previewMode === "contenteditable") {
    const target = document.getElementById("notionBlock");
    target.focus();
    const range = document.createRange();
    range.setStart(target.firstChild, 0);
    range.setEnd(target.firstChild, 8);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    const target = document.getElementById(previewMode === "textarea" ? "textArea" : "textInput");
    target.focus();
    const start = target.value.indexOf(previewMode === "textarea" ? "selection" : "resilient");
    const length = previewMode === "textarea" ? "selection".length : "resilient".length;
    target.setSelectionRange(start, start + length);
  }

  document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  if (previewParams.has("clear") && previewMode === "contenteditable") {
    setTimeout(() => getSelection().removeAllRanges(), 20);
  }
  setTimeout(() => {
    runtimeListener?.({ type: "GET_SELECTION" }, {}, (response) => {
      window.__selectionResponse = response;
      const bubbleVisible = document.querySelector(".lexiloop-bubble")?.classList.contains("is-visible") || false;
      document.getElementById("selectionStatus").textContent = `选区：${response.text || "无"} · 悬浮窗：${bubbleVisible ? "显示" : "关闭"}`;
    });
  }, 180);
});
