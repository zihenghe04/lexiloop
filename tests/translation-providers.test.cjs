const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadProviders(options = {}) {
  const state = {
    local: structuredClone(options.state?.local || {}),
    sync: structuredClone(options.state?.sync || {})
  };
  const calls = [];
  const chrome = {
    storage: {
      local: storageArea(state.local),
      sync: storageArea(state.sync)
    }
  };
  const context = vm.createContext({
    AbortController,
    URL,
    URLSearchParams,
    chrome,
    clearTimeout,
    console,
    fetch: async (url, request) => {
      calls.push({ url, request: structuredClone({ ...request, signal: undefined }) });
      return options.fetch ? options.fetch(url, request) : jsonResponse({});
    },
    setTimeout: options.setTimeout || setTimeout,
    TextDecoder
    , LexiLoopOAuth: options.oauth
  });
  const filename = path.join(__dirname, "..", "translation-providers.js");
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { api: context.LexiLoopTranslationProviders, calls, state };
}

function storageArea(state) {
  return {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, structuredClone(state[key])]).filter(([, value]) => value !== undefined));
    },
    async set(value) { Object.assign(state, structuredClone(value)); },
    async remove(key) { delete state[key]; }
  };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(value); }
  };
}

function streamResponse(chunks, status = 200) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: Buffer.from(chunks[index++]) };
          }
        };
      }
    },
    async text() { return chunks.join(""); }
  };
}

function customConfig(overrides = {}) {
  return {
    textProvider: "openai-compatible",
    fallbackEnabled: true,
    requestTimeoutMs: 5000,
    openaiEndpoint: "https://api.example.com/v1/chat/completions",
    openaiModel: "example-model",
    openaiResponsePath: "choices.0.message.content",
    ...overrides
  };
}

function anthropicConfig(overrides = {}) {
  return customConfig({ apiProtocol: 'anthropic', openaiEndpoint: 'https://api.example.com/v1/messages',
    openaiModel: 'claude-sonnet-5-5', anthropicMaxTokens: 64000, ...overrides });
}

test('Messages translation sends top-level system and reads all text blocks', async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ type: 'message', content: [
    { type: 'thinking', thinking: 'hidden' }, { type: 'text', text: '你好' }, { type: 'text', text: '世界' }
  ] }) });
  const result = await api.translateWithOpenAI('Hello world', 'zh-CN', anthropicConfig(), { openaiApiKey: 'test' });
  assert.equal(result.translated, '你好世界');
  const body = JSON.parse(calls[0].request.body);
  assert.match(body.system, /Translate/);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.max_tokens, 64000);
  assert.equal(body.model, 'claude-sonnet-5-5');
});

test('Messages PDF request converts screenshots, preserves history and redacts image payloads', async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ type: 'message', content: [{ type: 'text', text: '[p. 1] Answer' }] }) });
  const result = await api.askPdfQuestion({ question: 'Explain', context: '[p. 1] Evidence',
    imageDataUrl: 'data:image/png;base64,aGVsbG8=', history: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Earlier answer' }]
  }, { diagnostics: true, settings: { config: anthropicConfig({ openaiResponsePath: 'content.0.text' }), secrets: { openaiApiKey: 'test-secret' } } });
  const body = JSON.parse(calls[0].request.body);
  assert.match(body.system, /untrusted/);
  assert.equal(body.messages.length, 3);
  assert.equal(body.temperature, undefined);
  assert.deepEqual(body.messages.at(-1).content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } });
  assert.match(result.answer, /Answer/);
  assert.ok(!JSON.stringify(result.requestPreview).includes('aGVsbG8='));
  assert.ok(!JSON.stringify(result.requestPreview).includes('test-secret'));
});

test('Messages streams text deltas across split packets and omits thinking and tool events', async () => {
  const { api } = loadProviders({ fetch: async () => streamResponse([
    'event: message_start\r\ndata: {"type":"message_start","message":{"content":[]}}\r\n\r\n',
    'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}\n\n',
    'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"First ',
    'answer"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"tool"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n'
  ]) });
  const chunks = [];
  const result = await api.askPdfQuestionStream({ question: 'Explain' }, { settings: { config: anthropicConfig(), secrets: { openaiApiKey: 'test' } } }, text => chunks.push(text));
  assert.equal(result.answer, 'First answer');
  assert.deepEqual(chunks, ['First answer']);
});

test('Messages streaming errors propagate after partial output without retry', async () => {
  const { api, calls } = loadProviders({ fetch: async () => streamResponse([
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Partial"}}\n\n',
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Busy"}}\n\n'
  ]) });
  await assert.rejects(api.askPdfQuestionStream({ question: 'Explain' }, { settings: { config: anthropicConfig(), secrets: { openaiApiKey: 'test' } } }), /Busy/);
  assert.equal(calls.length, 1);
});

test('Messages validates output limits and migrates existing messages endpoints', () => {
  const { api } = loadProviders();
  assert.equal(api.normalizeConfig(customConfig({ openaiEndpoint: 'https://api.example.com/v1/messages' })).apiProtocol, 'anthropic');
  for (const anthropicMaxTokens of [0, -1, 1.5, 'bad']) assert.throws(() => api.validateConfig(anthropicConfig({ anthropicMaxTokens })), /正整数/);
  assert.equal(api.validateConfig(anthropicConfig({ anthropicMaxTokens: 2048 })).anthropicMaxTokens, 2048);
});

test('Anthropic application restrictions are reported without retrying as an outage', async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ error: { message: "Backend model deployer(s) ['CODING_TATU'] for this model do not support the current application (app_id=0)." } }, 503) });
  await assert.rejects(api.askPdfQuestionStream({ question: 'Test' }, { settings: { config: anthropicConfig(), secrets: { openaiApiKey: 'test' } } }), error => error.category === 'application' && /管理员/.test(error.message));
  assert.equal(calls.length, 1);
});

test('Messages JSON fallback joins all text blocks even with a legacy response path', async () => {
  const { api } = loadProviders({ fetch: async () => jsonResponse({ type: 'message', content: [
    { type: 'text', text: 'First' }, { type: 'thinking', thinking: 'Hidden' }, { type: 'text', text: 'Second' }
  ] }) });
  const result = await api.askPdfQuestionStream({ question: 'Test' }, { settings: { config: anthropicConfig({ openaiResponsePath: 'content.0.text' }), secrets: { openaiApiKey: 'test' } } });
  assert.equal(result.answer, 'FirstSecond');
  assert.equal(result.streamed, false);
});

test("keeps API keys out of synchronized provider configuration", async () => {
  const { api, state } = loadProviders();
  const saved = await api.saveSettings({ ...customConfig(), openaiApiKey: "leaked" }, { apiKey: "local-secret" });

  assert.equal(saved.hasApiKey, true);
  assert.equal(state.sync.lexiloopTranslationConfig.openaiApiKey, undefined);
  assert.equal(state.local.lexiloopTranslationSecrets.openaiApiKey, "local-secret");
});

test('switching schemes restores the full original configuration and its independent key', async () => {
  const { api, state } = loadProviders();
  const original = await api.saveSettings(customConfig({ pdfAiAuth: 'chatgpt', pdfAiOAuthModel: 'original-oauth',
    pdfAiModel: 'original-pdf', pdfAiTimeoutMs: 130000, requestTimeoutMs: 0, pdfAiStreaming: false }), { apiKey: 'original-key' });
  const anthropic = await api.saveSettings(anthropicConfig({ providerProfile: 'c_anthropic1', pdfAiModel: 'claude-sonnet-5-5' }), { apiKey: 'anthropic-key' });
  assert.equal(anthropic.config.providerProfile, 'c_anthropic1');
  assert.deepEqual(JSON.parse(JSON.stringify(anthropic.profiles.original.config)), JSON.parse(JSON.stringify(original.config)));
  const restored = await api.saveSettings(anthropic.profiles.original.config);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.config)), JSON.parse(JSON.stringify(original.config)));
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'original-key');
  await api.saveSettings(restored.profiles.c_anthropic1.config);
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'anthropic-key');
  for (const output of [state.sync, await api.getPublicSettings(), state.local.lexiloopProviderProfiles]) {
    assert.ok(!JSON.stringify(output).includes('original-key'));
    assert.ok(!JSON.stringify(output).includes('anthropic-key'));
  }
});

test('legacy original configuration is captured before first switching to Anthropic', async () => {
  const legacy = customConfig({ pdfAiAuth: 'chatgpt', pdfAiOAuthModel: 'legacy-oauth', pdfAiModel: 'legacy-pdf' });
  const { api } = loadProviders({ state: { sync: { lexiloopTranslationConfig: legacy },
    local: { lexiloopTranslationSecrets: { openaiApiKey: 'legacy-key' } } } });
  const saved = await api.saveSettings(anthropicConfig({ providerProfile: 'c_anthropic1' }));
  assert.equal(saved.profiles.original.hasApiKey, true);
  assert.equal(saved.profiles.c_anthropic1.hasApiKey, false);
  assert.equal(saved.profiles.original.config.pdfAiOAuthModel, 'legacy-oauth');
  assert.equal((await api.getSettings()).secrets.openaiApiKey, undefined);
  await api.saveSettings(saved.profiles.original.config);
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'legacy-key');
});

test('testing an unsaved scheme never borrows the active scheme key', async () => {
  const { api, calls } = loadProviders();
  await api.saveSettings(customConfig(), { apiKey: 'original-key' });
  for (const run of [api.testOpenAIProvider, api.testPdfAiProvider]) {
    await assert.rejects(run(anthropicConfig({ providerProfile: 'c_anthropic1' })), error => error.category === 'auth');
  }
  assert.equal(calls.length, 0);
});

test('connection tests use the selected saved scheme key even while another scheme is active', async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ content: [{ type: 'text', text: 'Hello' }] }) });
  const original = await api.saveSettings(customConfig(), { apiKey: 'original-key' });
  const anthropic = await api.saveSettings(anthropicConfig({ providerProfile: 'c_anthropic1', pdfAiStreaming: false }), { apiKey: 'anthropic-key' });
  await api.saveSettings(original.config);
  await api.testOpenAIProvider(anthropic.config);
  await api.testPdfAiProvider(anthropic.config);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.request.headers.Authorization, 'Bearer anthropic-key');
});

test('clearing one scheme key preserves the other scheme key', async () => {
  const { api } = loadProviders();
  const original = await api.saveSettings(customConfig(), { apiKey: 'original-key' });
  const anthropic = await api.saveSettings(anthropicConfig({ providerProfile: 'c_anthropic1' }), { apiKey: 'anthropic-key' });
  const cleared = await api.saveSettings(anthropic.config, { clearApiKey: true });
  assert.equal(cleared.hasApiKey, false);
  assert.equal(cleared.profiles.original.hasApiKey, true);
  await api.saveSettings(original.config);
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'original-key');
});

test('a synced active scheme change does not use the other local scheme key', async () => {
  const { api, state } = loadProviders();
  const original = await api.saveSettings(customConfig(), { apiKey: 'original-key' });
  const anthropic = await api.saveSettings(anthropicConfig({ providerProfile: 'c_anthropic1' }), { apiKey: 'anthropic-key' });
  state.sync.lexiloopTranslationConfig = original.config;
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'original-key');
  state.sync.lexiloopTranslationConfig = anthropic.config;
  assert.equal((await api.getSettings()).secrets.openaiApiKey, 'anthropic-key');
});

test('subscription translation does not require an API key and keeps reasoning effort', async () => {
  let captured;
  const { api } = loadProviders({ oauth: { async request(action, input) {
    captured = { action, input };
    return { answer: input.purpose === 'translate' && input.question.startsWith('[') ? '["你好 {v1}"]' : '你好' };
  } } });
  const config = customConfig({ providerProfile: 'grok', pdfAiAuth: 'grok', pdfAiOAuthModel: 'grok-4.7', reasoningEffort: 'xhigh', openaiModel: '' });
  const saved = await api.saveSettings(config, { connection: { name: 'Grok 订阅', kind: 'subscription' } });
  assert.equal(saved.config.reasoningEffort, 'xhigh');
  const result = await api.textTranslate('Hello {v1}', 'zh-CN', { settings: { config: saved.config, secrets: {} } });
  assert.equal(result.translated, '你好');
  assert.equal(result.service.startsWith('Grok 订阅'), true);
  assert.equal(captured.input.provider, 'grok');
  assert.equal(captured.input.reasoningEffort, 'xhigh');
  assert.equal(captured.input.model, 'grok-4.7');
  const batch = await api.translateSubscriptionBatch(['Hello {v1}'], 'zh-CN', { settings: { config: saved.config, secrets: {} } });
  assert.equal(batch[0].ok, true);
  assert.equal(batch[0].translated, '你好 {v1}');
  const tested = await api.testOpenAIProvider(saved.config, '');
  assert.equal(tested.result.translated, '你好');
});

test('translation and AI can use different saved connections', async () => {
  let captured;
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({ choices: [{ message: { content: 'API 译文' } }] }),
    oauth: { async request(action, input) {
      captured = { action, input };
      return { answer: '订阅回答', model: input.model };
    } }
  });
  await api.saveSettings(customConfig({ openaiModel: 'deepseek-chat', textProvider: 'openai-compatible' }), { apiKey: 'sk-translate' });
  await api.saveSettings(customConfig({
    providerProfile: 'grok', pdfAiAuth: 'grok', pdfAiOAuthModel: 'grok-4.7', openaiModel: 'grok-4.7', textProvider: 'openai-compatible'
  }), { activate: false, connection: { name: 'Grok 订阅', kind: 'subscription' } });
  const assigned = await api.assignRoles({ translation: 'original', ai: 'grok' });
  assert.equal(assigned.roles.translation, 'original');
  assert.equal(assigned.roles.ai, 'grok');
  assert.equal(assigned.config.providerProfile, 'original');
  const translated = await api.textTranslate('Hello', 'zh-CN');
  assert.equal(translated.translated, 'API 译文');
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/chat/completions');
  const answer = await api.askPdfQuestionStream({ question: 'Explain' });
  assert.equal(answer.answer, '订阅回答');
  assert.equal(captured.input.provider, 'grok');
  assert.equal(captured.input.model, 'grok-4.7');
  assert.equal(calls.filter((call) => String(call.url).includes('api.x.ai')).length, 0);
});

test('Grok subscription is stored separately and routes PDF AI with provider grok', async () => {
  let captured;
  const { api } = loadProviders({ oauth: { async request(action, input) {
    captured = { action, input };
    return { answer: 'Grok answer', model: input.model };
  } } });
  const saved = await api.saveSettings(customConfig({
    providerProfile: 'grok', pdfAiAuth: 'grok', pdfAiOAuthModel: 'grok-4.7', openaiModel: 'grok-4.7'
  }), { connection: { name: 'Grok 订阅', kind: 'subscription' } });
  assert.equal(saved.config.pdfAiAuth, 'grok');
  assert.equal(saved.profiles.grok.kind, 'subscription');
  assert.equal(saved.profiles.grok.name, 'Grok 订阅');
  const result = await api.askPdfQuestionStream({ question: 'Explain' }, {
    settings: { config: saved.config, secrets: {} }
  });
  assert.equal(result.answer, 'Grok answer');
  assert.equal(captured.action, 'ask');
  assert.equal(captured.input.provider, 'grok');
  assert.equal(captured.input.model, 'grok-4.7');
});

test("OAuth PDF AI bypasses API keys and routes normalized context through the native bridge", async () => {
  let captured;
  const { api, calls } = loadProviders({ oauth: { async request(action, input, emit) {
    captured = { action, input }; emit('OAuth answer');
    return { answer: 'OAuth answer', model: input.model };
  } } });
  const chunks = [];
  const result = await api.askPdfQuestionStream({ question: 'Explain PDF', context: '[p. 1] Evidence' }, {
    settings: { config: customConfig({ pdfAiAuth: 'chatgpt', pdfAiModel: 'codex-test' }), secrets: {} }
  }, text => chunks.push(text));
  assert.equal(result.answer, 'OAuth answer');
  assert.equal(captured.action, 'ask');
  assert.equal(captured.input.model, 'codex-test');
  assert.match(captured.input.context, /Evidence/);
  assert.deepEqual(chunks, ['OAuth answer']);
  assert.equal(calls.length, 0);
});

test("migrates a legacy synchronized API key into local secret storage", async () => {
  const { api, state } = loadProviders({
    state: {
      local: {
        lexiloopTranslationConfig: { ...customConfig(), openaiApiKey: "legacy-secret" }
      }
    }
  });
  await api.initializeStorage();

  assert.equal(state.local.lexiloopTranslationConfig, undefined);
  assert.equal(state.local.lexiloopTranslationSecrets.openaiApiKey, "legacy-secret");
  assert.equal(state.sync.lexiloopTranslationConfig.openaiApiKey, undefined);
});

test("allows HTTPS and local development endpoints but rejects insecure remote URLs", () => {
  const { api } = loadProviders();
  assert.equal(api.validateConfig(customConfig()).openaiEndpoint, "https://api.example.com/v1/chat/completions");
  assert.equal(
    api.validateConfig(customConfig({ openaiEndpoint: "http://localhost:11434/v1/chat/completions" })).openaiEndpoint,
    "http://localhost:11434/v1/chat/completions"
  );
  assert.throws(
    () => api.validateConfig(customConfig({ openaiEndpoint: "http://api.example.com/v1/chat/completions" })),
    /必须使用 HTTPS/
  );
});

test("builds a compatible chat request and redacts authorization diagnostics", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({ choices: [{ message: { content: "你好，世界。" } }] })
  });
  const diagnostics = await api.translateWithOpenAI(
    "Hello, world.",
    "zh-CN",
    customConfig(),
    { openaiApiKey: "sk-private" },
    true
  );

  assert.equal(diagnostics.result.translated, "你好，世界。");
  assert.equal(diagnostics.requestPreview.headers.Authorization, "Bearer ••••••••");
  assert.equal(calls[0].request.headers.Authorization, "Bearer sk-private");
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.model, "example-model");
  assert.equal(body.response_format, undefined);
});

test("uses only the configured response path", async () => {
  const { api } = loadProviders({
    fetch: async () => jsonResponse({ text: "不应被误判为译文", choices: [] })
  });

  await assert.rejects(
    api.translateWithOpenAI("Hello", "zh-CN", customConfig(), { openaiApiKey: "sk-test" }),
    (error) => error.category === "parse" && /响应.*路径/.test(error.message)
  );
});

test("builds a grounded multimodal PDF question request", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({ choices: [{ message: { content: "该公式表示线性映射。" } }] })
  });
  const imageDataUrl = "data:image/png;base64,aGVsbG8=";
  const result = await api.askPdfQuestion({
    question: "解释截图中的公式",
    title: "Linear Algebra",
    context: "[p. 6]\nA linear map preserves addition.",
    history: [{ role: "user", content: "先总结这一页" }, { role: "assistant", content: "这一页介绍线性映射。" }],
    imageDataUrl
  }, {
    settings: { config: customConfig({ pdfAiModel: "vision-model" }), secrets: { openaiApiKey: "sk-test" } }
  });

  assert.equal(result.answer, "该公式表示线性映射。");
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.model, "vision-model");
  assert.equal(result.model, "vision-model");
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages.at(-1).content[1].image_url.url, imageDataUrl);
  assert.match(body.messages.at(-1).content[0].text, /\[p\. 6\]/);
  const preview = api.redactRequest({ url: calls[0].url, options: calls[0].request });
  assert.match(preview.options?.body || JSON.stringify(preview.body), /image omitted/);
});

test("tests PDF AI with its dedicated model and parses Responses API text", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({
      output_text: "PDF AI OK",
      output: [{ content: [{ type: "output_text", text: { value: "PDF AI OK" } }] }]
    })
  });
  const result = await api.testPdfAiProvider(
    customConfig({ pdfAiModel: "vision-model" }),
    "sk-test"
  );
  assert.equal(result.answer, "PDF AI OK");
  assert.equal(result.model, "vision-model");
  assert.equal(JSON.parse(calls[0].request.body).model, "vision-model");
  assert.match(result.rawResponse, /PDF AI OK/);
});

test("streams OpenAI-compatible PDF AI deltas as they arrive", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"第一段\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"第二段\"}}]}\n\n",
      "data: [DONE]\n\n"
    ])
  });
  const chunks = [];
  const result = await api.askPdfQuestionStream({ question: "总结这一页" }, {
    settings: { config: customConfig(), secrets: { openaiApiKey: "sk-test" } }
  }, (chunk) => chunks.push(chunk));

  assert.deepEqual(chunks, ["第一段", "第二段"]);
  assert.equal(result.answer, "第一段第二段");
  assert.equal(result.streamed, true);
  assert.equal(JSON.parse(calls[0].request.body).stream, true);
  assert.equal(JSON.parse(calls[0].request.body).max_tokens, undefined);
});

test("PDF AI connection test follows streaming setting and does not duplicate completion text", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => streamResponse([
      'data: {"type":"response.reasoning_text.delta","delta":"private reasoning"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
      'data: {"type":"response.completed","response":{"output_text":"OK"}}\n\n'
    ])
  });
  const result = await api.testPdfAiProvider(customConfig({ pdfAiModel: "pdf-model" }), "test-key");
  assert.equal(result.answer, "OK");
  assert.equal(result.streamed, true);
  assert.equal(JSON.parse(calls[0].request.body).stream, true);
  assert.equal(result.requestPreview.body.model, "pdf-model");
  assert.equal(result.requestPreview.body.max_tokens, undefined);
  assert.ok(!JSON.stringify(result.requestPreview).includes("test-key"));
});

test("reports server-side length stop without attributing it to a plugin quota", async () => {
  const { api } = loadProviders({
    fetch: async () => streamResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
    ])
  });
  await assert.rejects(api.testPdfAiProvider(customConfig(), "test-key"),
    (error) => error.category === "parse" && /finish_reason: length/.test(error.message));
});

test("falls back to a complete JSON answer when a compatible endpoint ignores streaming", async () => {
  const { api } = loadProviders({
    fetch: async () => jsonResponse({ choices: [{ message: { content: "完整答案" } }] })
  });
  const chunks = [];
  const result = await api.askPdfQuestionStream({ question: "总结" }, {
    settings: { config: customConfig(), secrets: { openaiApiKey: "sk-test" } }
  }, (chunk) => chunks.push(chunk));

  assert.equal(result.answer, "完整答案");
  assert.equal(result.streamed, false);
  assert.deepEqual(chunks, ["完整答案"]);
});

test("uses the configured response path for a streamed request that falls back to JSON", async () => {
  const { api } = loadProviders({
    fetch: async () => jsonResponse({ result: { answer: "自定义路径答案" } })
  });
  const result = await api.askPdfQuestionStream({ question: "总结" }, {
    settings: {
      config: customConfig({ openaiResponsePath: "result.answer" }),
      secrets: { openaiApiKey: "sk-test" }
    }
  });

  assert.equal(result.answer, "自定义路径答案");
});

test("does not retry a stream after partial output", async () => {
  let requests = 0;
  const { api } = loadProviders({
    fetch: async () => {
      requests += 1;
      let step = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (step++ === 0) return { done: false, value: Buffer.from(`data: {"choices":[{"delta":{"content":"已输出"}}]}\n\n`) };
                throw Object.assign(new Error("aborted"), { name: "AbortError" });
              }
            };
          }
        }
      };
    }
  });
  const chunks = [];

  await assert.rejects(
    api.askPdfQuestionStream({ question: "解释" }, {
      settings: { config: customConfig(), secrets: { openaiApiKey: "sk-test" } }
    }, (chunk) => chunks.push(chunk)),
    (error) => error.category === "timeout"
  );
  assert.deepEqual(chunks, ["已输出"]);
  assert.equal(requests, 1);
});

test('user cancellation aborts the upstream request without retrying', async () => {
  const controller = new AbortController();
  const { api, calls } = loadProviders({ fetch: async (_url, request) => {
    controller.abort();
    assert.equal(request.signal.aborted, true);
    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  } });
  await assert.rejects(api.askPdfQuestionStream({ question: 'test' }, {
    signal: controller.signal, settings: { config: customConfig(), secrets: { openaiApiKey: 'test' } }
  }), error => error.category === 'cancelled');
  assert.equal(calls.length, 1);
});

test("inherits the translation model when the PDF AI model is blank", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({ choices: [{ message: { content: "回答" } }] })
  });
  const result = await api.askPdfQuestion({ question: "总结" }, {
    settings: { config: customConfig({ pdfAiModel: "" }), secrets: { openaiApiKey: "sk-test" } }
  });

  assert.equal(JSON.parse(calls[0].request.body).model, "example-model");
  assert.equal(result.model, "example-model");
});

test("keeps translation and PDF AI timeout settings independent", () => {
  const { api } = loadProviders();
  const config = api.normalizeConfig({ requestTimeoutMs: 4000, pdfAiTimeoutMs: 90000 });

  assert.equal(config.requestTimeoutMs, 4000);
  assert.equal(config.pdfAiTimeoutMs, 90000);
  assert.equal(api.normalizeConfig({ pdfAiTimeoutMs: 999000 }).pdfAiTimeoutMs, 999000);
  assert.equal(api.normalizeConfig({ requestTimeoutMs: 0, pdfAiTimeoutMs: 0 }).pdfAiTimeoutMs, 0);
});

test("zero timeout leaves PDF AI streaming without a plugin timer", async () => {
  let timers = 0;
  const { api, calls } = loadProviders({
    setTimeout() { timers += 1; throw new Error('unexpected timeout'); },
    fetch: async () => streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'])
  });
  const question = 'Q'.repeat(5000);
  const result = await api.askPdfQuestionStream({ question }, {
    settings: { config: customConfig({ pdfAiTimeoutMs: 0 }), secrets: { openaiApiKey: 'sk-test' } }
  });
  assert.equal(result.answer, 'OK');
  assert.equal(timers, 0);
  assert.ok(JSON.parse(calls[0].request.body).messages.at(-1).content.includes(question));
});

test("reports the PDF AI timeout and performs one controlled retry", async () => {
  const { api, calls } = loadProviders({
    setTimeout(callback) {
      callback();
      return 1;
    },
    fetch: async (_url, request) => {
      if (request.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return jsonResponse({});
    }
  });

  await assert.rejects(
    api.askPdfQuestion({ question: "总结" }, {
      settings: {
        config: customConfig({ pdfAiTimeoutMs: 11000 }),
        secrets: { openaiApiKey: "sk-test" }
      }
    }),
    (error) => error.category === "timeout" && /11 秒/.test(error.message) && /重试 1 次/.test(error.message)
  );
  assert.equal(calls.length, 2);
});

test("distinguishes an upstream gateway timeout from the local PDF AI timer", async () => {
  const { api, calls } = loadProviders({
    fetch: async () => jsonResponse({ error: { message: "gateway timeout" } }, 504)
  });

  await assert.rejects(
    api.askPdfQuestion({ question: "总结" }, {
      settings: {
        config: customConfig({ pdfAiTimeoutMs: 90000 }),
        secrets: { openaiApiKey: "sk-test" }
      }
    }),
    (error) => error.category === "timeout" && /接口网关/.test(error.message) && /服务端/.test(error.message)
  );
  assert.equal(calls.length, 2);
});

test("bounds prior messages sent to the model without trimming saved history", () => {
  const { api } = loadProviders();
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: String(index).repeat(3000)
  }));
  const compacted = api.compactPdfHistory(history);

  assert.ok(compacted.reduce((total, message) => total + message.content.length, 0) <= 8000);
  assert.equal(compacted.at(-1).content, "7".repeat(3000));
  assert.ok(compacted.length < history.length);
});

test("requires an API key for PDF AI even when text translation uses built-in providers", async () => {
  const { api } = loadProviders();
  await assert.rejects(
    api.askPdfQuestion({ question: "总结文档" }, {
      settings: { config: { textProvider: "automatic" }, secrets: {} }
    }),
    (error) => error.category === "auth" && /API Key/.test(error.message)
  );
});

test("classifies authentication failures and retains redacted request diagnostics", async () => {
  const { api } = loadProviders({
    fetch: async () => jsonResponse({ error: { message: "invalid token" } }, 401)
  });

  await assert.rejects(
    api.translateWithOpenAI("Hello", "zh-CN", customConfig(), { openaiApiKey: "sk-test" }),
    (error) => error.category === "auth"
      && error.details.requestPreview.headers.Authorization === "Bearer ••••••••"
      && !JSON.stringify(error.details).includes("sk-test")
  );
});

test("falls back to a built-in provider when the custom provider is unavailable", async () => {
  const { api, calls } = loadProviders({
    fetch: async (url) => {
      if (String(url).startsWith("https://api.example.com")) {
        return jsonResponse({ error: { message: "temporarily unavailable" } }, 503);
      }
      return jsonResponse({ responseData: { translatedText: "备用译文" }, responseStatus: 200 });
    }
  });

  const result = await api.textTranslate("Fallback text", "zh-CN", {
    settings: { config: customConfig(), secrets: { openaiApiKey: "sk-test" } }
  });
  assert.equal(result.translated, "备用译文");
  assert.equal(result.service, "MyMemory");
  assert.equal(calls.filter((call) => call.url.startsWith("https://api.example.com")).length, 2);
});

test("without any saved connection translation still works and PDF AI asks for one", async () => {
  const { api } = loadProviders({
    fetch: async (url) => {
      if (String(url).includes("mymemory")) {
        return jsonResponse({ responseData: { translatedText: "内置译文" }, responseStatus: 200 });
      }
      return jsonResponse({});
    }
  });
  const settings = await api.getPublicSettings();
  assert.equal(settings.connections.length, 0, "首次使用没有任何连接");
  assert.equal(settings.roles.translation, "");
  assert.equal(settings.roles.ai, "");

  const result = await api.textTranslate("Hello", "zh-CN");
  assert.equal(result.translated, "内置译文");
  assert.equal(result.service, "MyMemory");

  await assert.rejects(
    api.askPdfQuestion({ question: "Explain this", context: "text" }),
    /还没有添加模型连接/
  );
});

test("a built-in connection only shows up after it is actually configured", async () => {
  const { api, state } = loadProviders();
  await api.saveSettings(customConfig(), { apiKey: "sk-original" });
  const configured = await api.getPublicSettings();
  assert.equal(JSON.stringify(configured.connections.map((item) => item.id)), JSON.stringify(["original"]));

  const removed = await api.removeConnection("original");
  assert.equal(removed.connections.length, 0);
  // 删除后密钥仍在本机，重新添加即可复用
  assert.equal(state.local.lexiloopTranslationSecrets.profiles.original.openaiApiKey, "sk-original");
});

test("upgrading an old install keeps a configured built-in connection but drops the untouched one", async () => {
  const anthropicConfigValue = anthropicConfig({ providerProfile: "c_anthropic1", openaiModel: "claude-sonnet-5-5", pdfAiModel: "claude-sonnet-5-5" });
  const { api } = loadProviders({
    state: {
      sync: { lexiloopTranslationConfig: { ...anthropicConfigValue } },
      local: {
        // 旧版本的 profiles 存储：内置两项都在，只有 anthropic 配过密钥
        lexiloopProviderProfiles: {
          meta: { added: ["original", "c_anthropic1"], names: {}, kinds: {}, sources: {}, roles: { translation: "c_anthropic1", ai: "c_anthropic1" } },
          original: customConfig({ providerProfile: "original" }),
          anthropic: anthropicConfigValue
        },
        lexiloopTranslationSecrets: { profiles: { anthropic: { openaiApiKey: "anthropic-key" } } }
      }
    }
  });
  const settings = await api.getPublicSettings();
  assert.equal(JSON.stringify(settings.connections.map((item) => item.id)), JSON.stringify(["c_anthropic1"]));
  assert.equal(settings.roles.translation, "c_anthropic1");
  // 没有配过的「原方案」不再出现在列表里
  assert.equal(settings.connections.some((item) => item.id === "original"), false);
});

test("Responses requests keep placeholders in instructions and read output_text", async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ output_text: "你好 {v1}" }) });
  const config = customConfig({ apiProtocol: "responses", openaiEndpoint: "https://api.example.com/v1/responses", openaiResponsePath: "output_text" });
  const result = await api.translateWithOpenAI("Hello {v1}", "zh-CN", config, { openaiApiKey: "test" });
  const body = JSON.parse(calls[0].request.body);
  assert.equal(result.translated, "你好 {v1}");
  assert.equal(body.store, false);
  assert.match(body.instructions, /\{v1\}/);
  assert.equal(body.input[0].content[0].text, "Hello {v1}");
  assert.equal(body.messages, undefined);
});

test("a responses endpoint is inferred only when the protocol is not explicit", () => {
  const { api } = loadProviders();
  assert.equal(api.normalizeConfig(customConfig({ openaiEndpoint: "https://api.example.com/v1/responses", openaiResponsePath: "" })).apiProtocol, "responses");
  assert.equal(api.normalizeConfig(customConfig({ apiProtocol: "openai", openaiEndpoint: "https://api.example.com/v1/responses" })).apiProtocol, "openai");
});

test("custom connections keep an independent key and can be saved without becoming active", async () => {
  const { api, state } = loadProviders();
  await api.saveSettings(customConfig(), { apiKey: "original-key" });
  const id = "c_abc123def456";
  const saved = await api.saveSettings(customConfig({
    providerProfile: id, openaiModel: "imported-model", openaiEndpoint: "https://proxy.example.com/v1/chat/completions"
  }), { apiKey: "imported-key", activate: false, connection: { name: "导入", kind: "api", source: "cc-switch:claude:anthropic" } });
  assert.equal(saved.config.providerProfile, "original");
  assert.equal((await api.getSettings()).secrets.openaiApiKey, "original-key");
  assert.equal(saved.profiles[id].hasApiKey, true);
  assert.equal(saved.profiles[id].name, "导入");
  assert.ok(saved.connections.some((item) => item.id === id));
  assert.ok(!JSON.stringify(state.sync).includes("imported-key"));
  assert.ok(!JSON.stringify(state.local.lexiloopProviderProfiles).includes("imported-key"));
  const removed = await api.removeConnection(id);
  assert.equal(removed.profiles[id], undefined);
  assert.equal((await api.getSettings()).secrets.openaiApiKey, "original-key");
});

test('translation and AI keep separate reasoning effort and subscription model on one connection', async () => {
  const seen = [];
  const { api } = loadProviders({ oauth: { async request(action, input) {
    seen.push(input);
    return { answer: input.purpose === 'translate' ? '你好' : '回答', model: input.model };
  } } });
  const saved = await api.saveSettings(customConfig({
    providerProfile: 'chatgpt', pdfAiAuth: 'chatgpt', pdfAiOAuthModel: 'gpt-5.5', translationOAuthModel: 'gpt-5.5-mini',
    reasoningEffort: 'high', translationReasoningEffort: 'low', openaiModel: ''
  }), { connection: { name: 'ChatGPT 订阅', kind: 'subscription' } });
  await api.assignRoles({ translation: 'chatgpt', ai: 'chatgpt' });
  await api.textTranslate('Hello', 'zh-CN');
  await api.askPdfQuestionStream({ question: 'Explain' });
  assert.deepEqual(seen.map((input) => [input.purpose || 'ask', input.model, input.reasoningEffort]), [
    ['translate', 'gpt-5.5-mini', 'low'],
    ['ask', 'gpt-5.5', 'high']
  ]);
  assert.equal(saved.config.translationReasoningEffort, 'low');
});

test('connections saved before 0.24 keep one effort for both roles', () => {
  const { api } = loadProviders();
  const legacy = api.normalizeConfig(customConfig({ reasoningEffort: 'medium' }));
  assert.equal(legacy.translationReasoningEffort, 'medium');
  assert.equal(legacy.translationOAuthModel, '');
  assert.equal(api.normalizeConfig(customConfig({ reasoningEffort: 'high', translationReasoningEffort: '' })).translationReasoningEffort, '');
});

test('Anthropic Messages sends effort in output_config and x-api-key, redacted in diagnostics', async () => {
  const { api, calls } = loadProviders({ fetch: async () => jsonResponse({ content: [{ type: 'text', text: '好' }] }) });
  const official = customConfig({ apiProtocol: 'anthropic', openaiEndpoint: 'https://api.anthropic.com/v1/messages',
    openaiModel: 'claude-sonnet-5-5', reasoningEffort: 'xhigh', translationReasoningEffort: 'low' });
  const tested = await api.testOpenAIProvider(official, 'test-dummy');
  const request = calls[0].request;
  assert.deepEqual(JSON.parse(request.body).output_config, { effort: 'low' });
  assert.equal(request.headers['x-api-key'], 'test-dummy');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(JSON.stringify(tested.requestPreview).includes('test-dummy'), false);
  await api.translateWithOpenAI('Hi', 'zh-CN', anthropicConfig(), { openaiApiKey: 'test-dummy' });
  assert.equal(calls[1].request.headers.Authorization, 'Bearer test-dummy');
  assert.equal(JSON.parse(calls[1].request.body).output_config, undefined);
});

test('lists models from the endpoint of each protocol without leaking the key', async () => {
  const { api, calls } = loadProviders({ fetch: async (url) => jsonResponse(String(url).includes('anthropic')
    ? { data: [{ id: 'claude-sonnet-5-5', type: 'model' }, { id: 'claude-haiku-5-5', type: 'model' }] }
    : { object: 'list', data: [{ id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'gpt-a' }] }) });
  assert.equal(api.modelsUrlFor('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/models');
  assert.equal(api.modelsUrlFor('https://api.example.com/v1/responses/'), 'https://api.example.com/v1/models');
  assert.equal(api.modelsUrlFor('https://api.example.com/deployer/coding_x/v1/messages?beta=1'), 'https://api.example.com/deployer/coding_x/v1/models');
  assert.deepEqual([...await api.listApiModels(customConfig(), 'test-dummy')], ['gpt-a', 'gpt-b']);
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(calls[0].request.headers.Authorization, 'Bearer test-dummy');
  const claude = await api.listApiModels(customConfig({ apiProtocol: 'anthropic', openaiEndpoint: 'https://api.anthropic.com/v1/messages' }), 'test-dummy');
  assert.deepEqual([...claude], ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.equal(calls[1].request.headers['x-api-key'], 'test-dummy');
  await assert.rejects(api.listApiModels(customConfig({ providerProfile: 'c_abcdef123456' }), ''), /API Key/);
});

// 回归：只填服务根地址时直接 POST 会拿到 405 Method Not Allowed，必须按协议补接口路径。
test("request URL appends the protocol path when only a base URL is configured", () => {
  const { api } = loadProviders();
  const cases = [
    ["https://api.example.com/v1", "anthropic", "https://api.example.com/v1/messages"],
    ["https://api.example.com/v1/", "anthropic", "https://api.example.com/v1/messages"],
    ["https://api.example.com", "anthropic", "https://api.example.com/v1/messages"],
    ["https://api.deepseek.com", "openai", "https://api.deepseek.com/v1/chat/completions"],
    ["https://api.deepseek.com/v1", "openai", "https://api.deepseek.com/v1/chat/completions"],
    ["https://api.example.com/v1", "responses", "https://api.example.com/v1/responses"]
  ];
  for (const [endpoint, protocol, expected] of cases) {
    assert.equal(api.requestUrlFor(endpoint, protocol), expected, `${endpoint} (${protocol})`);
  }
  // 已经写到具体接口的地址原样使用，只清掉多余尾斜杠
  assert.equal(api.requestUrlFor("https://api.example.com/v1/messages", "anthropic"), "https://api.example.com/v1/messages");
  assert.equal(api.requestUrlFor("https://api.example.com/v1/messages/", "anthropic"), "https://api.example.com/v1/messages");
  assert.equal(api.requestUrlFor("https://api.openai.com/v1/chat/completions", "openai"), "https://api.openai.com/v1/chat/completions");
  // 查询参数保留
  assert.equal(api.requestUrlFor("https://api.example.com/v1?key=1", "openai"), "https://api.example.com/v1/chat/completions?key=1");
});

test("translation and PDF AI requests use the resolved endpoint", async () => {
  const { api, calls } = loadProviders({
    fetch: (url) => jsonResponse({ choices: [{ message: { content: "译文" } }] })
  });
  const config = customConfig({ apiProtocol: "anthropic", openaiEndpoint: "https://api.example.com/v1", openaiModel: "claude-sonnet-5-5", anthropicMaxTokens: 8192 });
  const request = api.buildPdfAiRequest({ title: "", context: "", question: "hi", history: [] }, config, "test-dummy");
  assert.equal(request.url, "https://api.example.com/v1/messages");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-api-key"], "test-dummy");
  assert.equal(calls.length, 0);
});
