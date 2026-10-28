window.chrome = {
  storage: {
    local: {
      async get() { return { lexiloopSettings: { selectionBubbleEnabled: true, enhancedPdfEnabled: true } }; }
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    onMessage: { addListener() {} },
    async sendMessage(message) {
      if (message.type === "TRANSLATE") {
        return {
          ok: true,
          result: {
            original: message.text,
            translated: "有韧性的；能迅速恢复的",
            detectedLanguage: "en",
            targetLanguage: "zh-CN",
            phonetics: { uk: "rɪˈzɪliənt", us: "rɪˈzɪliənt" },
            meanings: [{ partOfSpeech: "adj.", definitions: ["有韧性的；有复原力的；能迅速恢复的"] }],
            translationCount: 4,
            service: "有道词典"
          }
        };
      }
      return { ok: true };
    }
  }
};

window.addEventListener("load", () => {
  const target = document.querySelector("mark").firstChild;
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  if (new URLSearchParams(location.search).has("card")) {
    setTimeout(() => document.querySelector(".lexiloop-bubble")?.click(), 120);
  }
});
