const test = require("node:test");
const assert = require("node:assert/strict");
const cc = require("../cc-switch-import.js");

test("API 供应商可导入，官方空配置和订阅账号会被跳过", () => {
  const items = cc.fromRows([
    { id: "c_anthropic1", app_type: "claude", name: "c_anthropic1", settings_config: JSON.stringify({ env: {
      ANTHROPIC_AUTH_TOKEN: "sk-test-token-1234", ANTHROPIC_BASE_URL: "https://api.example.com", ANTHROPIC_MODEL: "claude-sonnet-5-5"
    } }) },
    { id: "official", app_type: "claude", name: "Claude Official", category: "official", settings_config: JSON.stringify({ env: {} }) },
    { id: "grok", app_type: "codex", name: "xAI OAuth", settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: "" }, config: 'model = "grok-4.7"' }) }
  ]);
  assert.equal(items.filter((item) => !item.skip).length, 1);
  assert.equal(items[0].endpoint, "https://api.example.com/v1/messages");
  assert.equal(items[0].protocol, "anthropic");
  assert.equal(items[0].model, "claude-sonnet-5-5");
  assert.equal(items[0].maskedKey, "sk-…34");
  assert.ok(!items[0].maskedKey.includes("token"));
  assert.match(items[1].skip, /不能作为 API Key/);
  assert.match(items[2].skip, /不能作为 API Key/);
});

test("Codex 和 Responses 配置会带上请求地址与协议", () => {
  const [codex, responses] = cc.fromRows([
    { id: "bailian", app_type: "codex", name: "bailian", settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: "sk-test-key-9999" },
      config: 'model = "deepseek-v4"\nbase_url = "https://proxy.example.com/v1"'
    }) },
    { id: "pi", app_type: "pi", name: "pi", settings_config: JSON.stringify({
      name: "example-claude", baseUrl: "https://api.example.com/v1", api: "openai-responses", apiKey: "sk-test-key-8888",
      models: [{ id: "gpt-5.6-luna" }]
    }) }
  ]);
  assert.equal(codex.protocol, "responses");
  assert.equal(codex.endpoint, "https://proxy.example.com/v1/responses");
  assert.equal(codex.model, "deepseek-v4");
  assert.equal(responses.protocol, "responses");
  assert.equal(responses.endpoint, "https://api.example.com/v1/responses");
  assert.equal(responses.model, "gpt-5.6-luna");
});

test("从数据库文件文本里能抽出配置，且不会把密钥放进名称", () => {
  const text = 'noise {"env":{"ANTHROPIC_AUTH_TOKEN":"sk-test-token-abcd","ANTHROPIC_BASE_URL":"https://example.test","ANTHROPIC_MODEL":"claude-opus"}} tail';
  const [item] = cc.scanFile(text);
  assert.equal(item.endpoint, "https://example.test/v1/messages");
  assert.equal(item.apiKey, "sk-test-token-abcd");
  assert.ok(!item.name.includes("sk-test"));
});
