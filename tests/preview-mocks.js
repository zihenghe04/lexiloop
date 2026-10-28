const sampleWords = [
  {
    id: "loop",
    original: "loop",
    translated: "循环；环状物；使循环",
    detectedLanguage: "en",
    targetLanguage: "zh-CN",
    phonetics: { uk: "luːp", us: "luːp" },
    meanings: [
      { partOfSpeech: "n.", definitions: ["循环；环状结构；环形线路"] },
      { partOfSpeech: "v.", definitions: ["使成环；反复运行"] }
    ],
    service: "有道词典",
    context: "A feedback loop makes the system respond to its own output.",
    source: { title: "Understanding feedback loops in product systems", url: "https://example.com/feedback-loops" },
    createdAt: "2026-08-11T03:20:00.000Z",
    updatedAt: "2026-08-13T08:42:00.000Z",
    translationCount: 12,
    review: { stage: 1, dueAt: "2026-08-14T03:20:00.000Z" },
    lookups: [
      { id: "a", at: "2026-08-13T08:42:00.000Z", trigger: "selection", source: { title: "Understanding feedback loops in product systems", url: "https://example.com/feedback-loops" }, context: "A feedback loop makes the system respond to its own output." },
      { id: "b", at: "2026-08-12T06:15:00.000Z", trigger: "shortcut", source: { title: "Design systems glossary", url: "https://example.com/glossary" }, context: "Close the loop with clear user feedback." },
      { id: "c", at: "2026-08-11T03:20:00.000Z", trigger: "manual", source: { title: "手动输入", url: "" }, context: "" }
    ]
  },
  {
    id: "resilient",
    original: "resilient",
    translated: "有韧性的；能复原的",
    detectedLanguage: "en",
    targetLanguage: "zh-CN",
    phonetics: { uk: "rɪˈzɪliənt", us: "rɪˈzɪliənt" },
    meanings: [{ partOfSpeech: "adj.", definitions: ["有韧性的；有复原力的；能迅速恢复的"] }],
    service: "有道词典",
    context: "Build resilient systems that degrade gracefully.",
    source: { title: "Engineering notes", url: "https://example.com/notes" },
    createdAt: "2026-08-12T02:00:00.000Z",
    updatedAt: "2026-08-12T02:00:00.000Z",
    translationCount: 3,
    review: { stage: 0, dueAt: "2026-08-12T02:00:00.000Z" },
    lookups: [{ id: "d", at: "2026-08-12T02:00:00.000Z", trigger: "selection", source: { title: "Engineering notes", url: "https://example.com/notes" }, context: "Build resilient systems that degrade gracefully." }]
  }
];

const listeners = [];
const sampleSettings = { selectionBubbleEnabled: true, enhancedPdfEnabled: true };
let sampleProviderConfig = {
  version: 3,
  providerProfile: 'original',
  apiProtocol: 'openai',
  anthropicMaxTokens: 64000,
  pdfAiAuth: 'api-key',
  pdfAiOAuthModel: '',
  textProvider: new URLSearchParams(location.search).has("provider") ? "openai-compatible" : "automatic",
  fallbackEnabled: true,
  requestTimeoutMs: 8000,
  pdfAiTimeoutMs: 60000,
  pdfAiStreaming: true,
  openaiEndpoint: "https://api.example.com/v1/chat/completions",
  openaiModel: "example-model",
  pdfAiModel: "vision-model",
  openaiResponsePath: "choices.0.message.content"
};
let sampleHasApiKey = new URLSearchParams(location.search).has("key");
const sampleProviderProfiles = {
  original: { config: structuredClone(sampleProviderConfig), hasApiKey: sampleHasApiKey },
  c_anthropic1: { config: { ...sampleProviderConfig, providerProfile: 'c_anthropic1', textProvider: 'openai-compatible',
    apiProtocol: 'anthropic', openaiEndpoint: 'https://api.example.com/v1/messages',
    openaiModel: 'claude-sonnet-5-5', pdfAiModel: 'claude-sonnet-5-5', fallbackEnabled: false,
    requestTimeoutMs: 60000, pdfAiTimeoutMs: 0, openaiResponsePath: 'content.0.text' }, hasApiKey: false }
};
function samplePublicProviderSettings() {
  return { ok: true, config: structuredClone(sampleProviderConfig), hasApiKey: sampleHasApiKey,
    profiles: structuredClone(sampleProviderProfiles), originalAvailable: true };
}
const samplePapers = [
  { id: "paper-attention", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017, venue: "NeurIPS",
    arxivId: "1706.03762", tags: ["Transformer", "NLP"], favorite: true, status: "reading", sourceType: "remote",
    sourceUrl: "https://arxiv.org/pdf/1706.03762", pageCount: 15, currentPage: 6, indexStatus: "ready", indexedPageCount: 15,
    note: "多头注意力与位置编码的出发点；第 3 节公式值得重读。", addedAt: "2026-09-02T03:20:00.000Z", lastOpenedAt: "2026-10-21T08:42:00.000Z" },
  { id: "paper-math", title: "人工智能数学基础", authors: ["课程讲义"], year: 2026, sourceType: "local", fileName: "人工智能数学基础.pdf",
    pageCount: 73, currentPage: 8, status: "reading", tags: ["课程"], addedAt: "2026-09-10T03:20:00.000Z", lastOpenedAt: "2026-10-20T08:42:00.000Z" },
  { id: "paper-resnet", title: "Deep Residual Learning for Image Recognition", authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"], year: 2016,
    venue: "CVPR", doi: "10.1109/CVPR.2016.90", status: "finished", sourceType: "remote", sourceUrl: "https://arxiv.org/pdf/1512.03385",
    pageCount: 12, currentPage: 12, addedAt: "2026-08-20T03:20:00.000Z", lastOpenedAt: "2026-09-30T08:42:00.000Z" },
  { id: "paper-entry", title: "World Models", authors: ["David Ha", "Jürgen Schmidhuber"], year: 2018, landingUrl: "https://worldmodels.github.io",
    status: "unread", sourceType: "remote", addedAt: "2026-10-01T03:20:00.000Z" }
];
window.chrome = {
  commands: {
    async getAll() {
      return [{ name: "translate-selection", shortcut: "Alt+Shift+T" }];
    }
  },
  storage: {
    local: {
      async get() { return { lexiloopWords: structuredClone(sampleWords), lexiloopSettings: structuredClone(sampleSettings), lexiloopPdfLibrary: structuredClone(samplePapers) }; },
      async set(value) {
        if (value.lexiloopWords) {
          sampleWords.splice(0, sampleWords.length, ...structuredClone(value.lexiloopWords));
          listeners.forEach((listener) => listener({ lexiloopWords: { newValue: structuredClone(sampleWords) } }, "local"));
        }
        if (value.lexiloopSettings) Object.assign(sampleSettings, value.lexiloopSettings);
      }
    },
    session: {
      async get() {
        if (!new URLSearchParams(location.search).has("lookup")) return {};
        return {
          lexiloopPending: {
            text: "resilient",
            context: "Build resilient systems that degrade gracefully.",
            source: { title: "Engineering notes", url: "https://example.com/notes" },
            result: {
              original: "resilient",
              translated: "有韧性的；能复原的",
              detectedLanguage: "en",
              targetLanguage: "zh-CN",
              phonetics: { uk: "rɪˈzɪliənt", us: "rɪˈzɪliənt" },
              meanings: [{ partOfSpeech: "adj.", definitions: ["有韧性的；有复原力的；能迅速恢复的"] }],
              service: "有道词典",
              translationCount: 3
            }
          }
        };
      },
      async remove() {}
    },
    onChanged: { addListener(listener) { listeners.push(listener); } }
  },
  runtime: {
    onMessage: { addListener() {} },
    async sendMessage(message) {
      if (message.type === "OPEN_SHORTCUT_SETTINGS") return { ok: true };
      if (message.type === "WORD_MUTATE") {
        if (message.action === "delete") {
          const index = sampleWords.findIndex((word) => word.id === message.id);
          if (index >= 0) sampleWords.splice(index, 1);
        } else if (message.action === "restore") {
          sampleWords.splice(Math.min(message.index, sampleWords.length), 0, structuredClone(message.word));
        }
        return { ok: true };
      }
      if (message.type === "OPEN_PDF_READER") return { ok: true };
      if (message.type === "GET_TRANSLATION_SETTINGS") {
        return samplePublicProviderSettings();
      }
      if (message.type === "SAVE_TRANSLATION_SETTINGS") {
        sampleProviderConfig = structuredClone(message.config);
        sampleHasApiKey = sampleProviderProfiles[sampleProviderConfig.providerProfile].hasApiKey;
        if (message.apiKey) sampleHasApiKey = true;
        if (message.clearApiKey) sampleHasApiKey = false;
        sampleProviderProfiles[sampleProviderConfig.providerProfile] = { config: structuredClone(sampleProviderConfig), hasApiKey: sampleHasApiKey };
        return samplePublicProviderSettings();
      }
      if (message.type === "TEST_TRANSLATION_PROVIDER") {
        return {
          ok: true,
          elapsedMs: 428,
          result: { translated: "你好，世界。" },
          requestPreview: {
            url: message.config.openaiEndpoint,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer ••••••••" },
            body: { model: message.config.openaiModel, messages: [{ role: "user", content: "Hello, world." }] }
          },
          rawResponse: JSON.stringify({ choices: [{ message: { content: "你好，世界。" } }] }, null, 2)
        };
      }
      return { ok: false, error: "预览模式不发起网络请求" };
    }
  }
};
