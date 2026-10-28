// 预览用的演示数据：只在内置浏览器的普通页面里生效（没有 chrome.runtime 时）。
// 结构严格按 0.25.0 的真实形状，方便对照截图与真实数据。

export const demoConnections = [
  {
    id: "original",
    name: "原方案",
    kind: "api",
    source: "",
    config: {
      providerProfile: "original",
      apiProtocol: "openai",
      openaiEndpoint: "https://api.example.com/v1",
      openaiModel: "deepseek-v4.1-flash",
      textProvider: "openai-compatible"
    },
    hasApiKey: true
  },
  {
    id: "anthropic-compat",
    name: "Anthropic 兼容服务（示例）",
    kind: "api",
    source: "",
    config: {
      providerProfile: "anthropic-compat",
      apiProtocol: "anthropic",
      openaiEndpoint: "https://api.example.com/v1",
      openaiModel: "deepseek-v4.1-flash-1017",
      textProvider: "openai-compatible"
    },
    hasApiKey: true
  },
  {
    id: "grok",
    name: "Grok 订阅",
    kind: "subscription",
    source: "oauth",
    config: {
      providerProfile: "grok",
      apiProtocol: "responses",
      openaiEndpoint: "https://api.x.ai/v1",
      openaiModel: "grok-4.7",
      textProvider: "openai-compatible"
    },
    hasApiKey: false
  }
];

export const demoWords = [
  {
    id: "w-embedding",
    original: "embedding",
    translated: "嵌入",
    phonetics: { us: "ɪmˈbedɪŋ" },
    meanings: [
      { partOfSpeech: "n.", definitions: ["嵌入", "嵌入向量"] },
      { partOfSpeech: "v.", definitions: ["嵌入", "使插入"] }
    ],
    translationCount: 12,
    lookups: [
      {
        at: "2026-10-24T09:12:00.000Z",
        source: {
          kind: "pdf",
          paperId: "p-showharness",
          title: "Show-Harness: Towards Generalizable Robotic Manipulation",
          page: 4
        },
        context: "we use learned embeddings to convert the input tokens"
      },
      {
        at: "2026-10-23T14:02:00.000Z",
        source: {
          title: "Deep Residual Learning for Image Recognition",
          url: "https://arxiv.org/abs/1512.03385",
          page: 7
        },
        context: "the embedding of the residual branch is projected back to the same dimension"
      },
      {
        at: "2026-10-21T20:30:00.000Z",
        source: { title: "", url: "https://arxiv.org/abs/1706.03762" },
        context: "positional embeddings are added to the input at the bottom of the encoder stack"
      }
    ],
    review: { dueAt: "2026-10-26T09:00:00.000Z", interval: 3, ease: 2.5 },
    updatedAt: "2026-10-24T09:12:00.000Z"
  },
  {
    id: "w-residual",
    original: "residual",
    translated: "残差",
    phonetics: { us: "rɪˈzɪdjuəl" },
    meanings: [{ partOfSpeech: "adj.", definitions: ["剩余的", "残差的"] }],
    translationCount: 8,
    lookups: [{
      at: "2026-10-23T15:40:00.000Z",
      source: { title: "Deep Residual Learning for Image Recognition", url: "" },
      context: "The degradation problem suggests that the solvers might have difficulties"
    }],
    review: { dueAt: "2026-10-25T15:40:00.000Z", interval: 2, ease: 2.4 },
    updatedAt: "2026-10-23T15:40:00.000Z"
  },
  {
    id: "w-adapter",
    original: "adapter",
    translated: "适配器",
    phonetics: { us: "əˈdæptə" },
    meanings: [{ partOfSpeech: "n.", definitions: ["适配器", "适配层"] }],
    translationCount: 6,
    lookups: [{
      at: "2026-10-22T11:05:00.000Z",
      source: { title: "Show-Harness", url: "" },
      context: "freeze the base model and insert a lightweight adapter"
    }],
    review: { dueAt: "2026-10-27T11:05:00.000Z", interval: 4, ease: 2.6 },
    updatedAt: "2026-10-22T11:05:00.000Z"
  },
  {
    id: "w-attention",
    original: "attention",
    translated: "注意力",
    phonetics: { us: "əˈtenʃn" },
    meanings: [{ partOfSpeech: "n.", definitions: ["注意力", "关注"] }],
    translationCount: 21,
    lookups: [{
      at: "2026-10-21T08:20:00.000Z",
      source: { title: "Attention Is All You Need", url: "" },
      context: "self-attention layers"
    }],
    review: { dueAt: "2026-10-25T08:20:00.000Z", interval: 5, ease: 2.7 },
    updatedAt: "2026-10-21T08:20:00.000Z"
  },
  {
    id: "w-finetune",
    original: "fine-tune",
    translated: "微调",
    phonetics: { us: "ˌfaɪnˈtjuːn" },
    meanings: [{ partOfSpeech: "v.", definitions: ["微调", "精细调节"] }],
    translationCount: 9,
    lookups: [{
      at: "2026-10-20T19:02:00.000Z",
      source: { title: "ResNet", url: "" },
      context: "fine-tune on the target dataset"
    }],
    review: null,
    updatedAt: "2026-10-20T19:02:00.000Z"
  }
];

export const demoPapers = [
  {
    id: "p-showharness",
    title: "Show-Harness: Towards Generalizable Robotic Manipulation",
    authors: "Y. Li, K. Zhang, M. Chen",
    year: 2025,
    status: "reading",
    progress: 0.34,
    pageCount: 30,
    currentPage: 11,
    favorite: true,
    sourceType: "url",
    sourceUrl: "https://arxiv.org/abs/2506.01234",
    lastOpenedAt: "2026-10-25T20:11:00.000Z",
    updatedAt: "2026-10-25T20:11:00.000Z",
    indexes: { version: 2, chunks: 412 }
  },
  {
    id: "p-resnet",
    title: "Deep Residual Learning for Image Recognition",
    authors: "K. He, X. Zhang, S. Ren, J. Sun",
    year: 2016,
    status: "read",
    progress: 1,
    pageCount: 12,
    currentPage: 12,
    favorite: false,
    sourceType: "url",
    sourceUrl: "https://arxiv.org/abs/1512.03385",
    lastOpenedAt: "2026-10-23T15:30:00.000Z",
    updatedAt: "2026-10-23T15:30:00.000Z",
    indexes: { version: 2, chunks: 168 }
  },
  {
    id: "p-attention",
    title: "Attention Is All You Need",
    authors: "A. Vaswani, N. Shazeer, N. Parmar",
    year: 2017,
    status: "read",
    progress: 1,
    pageCount: 15,
    currentPage: 15,
    favorite: true,
    sourceType: "url",
    sourceUrl: "https://arxiv.org/abs/1706.03762",
    lastOpenedAt: "2026-10-21T08:10:00.000Z",
    updatedAt: "2026-10-21T08:10:00.000Z",
    indexes: null
  },
  {
    id: "p-wamnav",
    title: "WAM-Nav: Visual Memory for Navigation",
    authors: "L. Wang, R. Sun",
    year: 2026,
    status: "unread",
    progress: 0,
    pageCount: 21,
    currentPage: 1,
    favorite: false,
    sourceType: "url",
    sourceUrl: "https://arxiv.org/abs/2601.00001",
    lastOpenedAt: null,
    updatedAt: "2026-10-26T02:00:00.000Z",
    indexes: null
  }
];

export const demoSettings = {
  selectionBubbleEnabled: true,
  enhancedPdfEnabled: true,
  targetLanguage: "auto"
};

export const demoTranslation = {
  translated: "我们使用学习到的嵌入把输入词元转换为向量表示，从而让模型能够捕捉词与词之间的语义关系。",
  service: "演示数据"
};