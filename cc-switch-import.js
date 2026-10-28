// 从 CC Switch 的供应商配置里提取可导入的 API 连接。
// 只识别 API Key。官方空配置和由 CC Switch 管理登录态的订阅账号会被标为不可导入，不读取它们的 OAuth 凭据。
(function (root, factory) {
  const api = factory();
  root.LexiLoopCcSwitch = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROTOCOL_SUFFIX = {
    anthropic: ["/v1/messages", "/messages"],
    responses: ["/v1/responses", "/responses"],
    openai: ["/v1/chat/completions", "/chat/completions"]
  };

  function maskKey(value) {
    const key = String(value || "");
    if (key.length < 8) return key ? "••••" : "";
    return `${key.slice(0, 3)}…${key.slice(-2)}`;
  }

  function joinEndpoint(base, protocol) {
    const url = String(base || "").trim().replace(/\/+$/, "");
    if (!url || !/^https?:\/\//i.test(url)) return "";
    if (/\/(messages|chat\/completions|responses)\/?$/.test(url)) return url;
    const suffix = PROTOCOL_SUFFIX[protocol] || PROTOCOL_SUFFIX.openai;
    if (/\/v1$/i.test(url)) return url + suffix[1];
    return url + suffix[0];
  }

  function tomlValue(text, key) {
    const match = String(text || "").match(new RegExp("^\\s*" + key + "\\s*=\\s*\"([^\"]*)\"", "m"));
    return match ? match[1] : "";
  }

  function hostLabel(endpoint) {
    try { return new URL(endpoint).hostname.replace(/^www\./, ""); } catch { return ""; }
  }

  function describe(raw, context = {}) {
    const data = raw && typeof raw === "object" ? raw : {};
    const appType = String(context.appType || "");
    const name = String(context.name || data.name || "").trim().slice(0, 40);
    const source = context.source ? String(context.source).slice(0, 80) : "";
    let protocol = "openai";
    let base = "";
    let model = "";
    let apiKey = "";

    if (data.env && typeof data.env === "object") {
      const env = data.env;
      apiKey = String(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY || env.OPENAI_API_KEY || "").trim();
      if (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) protocol = "anthropic";
      base = String(env.ANTHROPIC_BASE_URL || env.GOOGLE_GEMINI_BASE_URL || env.OPENAI_BASE_URL || "").trim();
      model = String(env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.GEMINI_MODEL || env.OPENAI_MODEL || "").replace(/\[.*?\]$/, "").trim();
    } else if (data.auth && typeof data.auth === "object") {
      apiKey = String(data.auth.OPENAI_API_KEY || "").trim();
      const config = String(data.config || "");
      base = tomlValue(config, "base_url");
      model = tomlValue(config, "model");
      protocol = /responses/i.test(base) || appType === "codex" ? "responses" : "openai";
    } else if (data.apiKey || data.api_key || data.baseUrl || data.base_url) {
      apiKey = String(data.apiKey || data.api_key || "").trim();
      base = String(data.baseUrl || data.base_url || "").trim();
      const mode = String(data.api || data.api_mode || "");
      protocol = /responses/i.test(mode) ? "responses" : /anthropic|messages/i.test(mode) ? "anthropic" : "openai";
      model = String(data.model || data.models?.[0]?.id || "").trim();
    } else {
      return skipped(name || "未识别的配置", "无法识别的配置格式", source, appType);
    }

    if (!apiKey) {
      return skipped(name || "订阅或官方账号", "订阅登录或官方账号不能作为 API Key 导入", source, appType);
    }
    const endpoint = joinEndpoint(base, protocol);
    if (!endpoint) return skipped(name || "缺少地址", "没有可用的请求地址", source, appType);
    const label = name || hostLabel(endpoint) || "导入的连接";
    return {
      name: label,
      appType,
      protocol,
      endpoint,
      model: model.slice(0, 160),
      apiKey: apiKey.slice(0, 1000),
      maskedKey: maskKey(apiKey),
      source,
      skip: ""
    };
  }

  function skipped(name, reason, source, appType) {
    return { name, appType, protocol: "", endpoint: "", model: "", apiKey: "", maskedKey: "", source, skip: reason };
  }

  function fromRows(rows) {
    const described = (Array.isArray(rows) ? rows : []).map((row) => describe(parseJson(row?.settings_config), {
      appType: row?.app_type,
      name: row?.name,
      source: row?.id ? `cc-switch:${row.app_type || ""}:${row.id}` : ""
    }));
    return dedupe(described);
  }

  function scanFile(text) {
    const found = [];
    const source = String(text || "");
    const needles = ['{"env":', '{"auth":', '{"name":', '{"base_url":', '{"baseUrl":', '{"apiKey":', '{"api_key":'];
    for (const needle of needles) {
      let from = 0;
      while (from < source.length) {
        const start = source.indexOf(needle, from);
        if (start < 0) break;
        const json = extractJsonObject(source, start);
        from = start + needle.length;
        if (!json) continue;
        const parsed = parseJson(json);
        if (parsed) found.push(describe(parsed, { source: `file:${start}` }));
      }
    }
    return dedupe(found);
  }

  function dedupe(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const key = item.skip ? `skip:${item.source || item.name}` : `${item.protocol}|${item.endpoint}|${item.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function parseJson(value) {
    if (value && typeof value === "object") return value;
    try { return JSON.parse(String(value || "")); } catch { return null; }
  }

  function extractJsonObject(text, start) {
    let depth = 0;
    let quote = false;
    let escaped = false;
    for (let index = start; index < text.length && index < start + 20000; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quote = false;
        continue;
      }
      if (char === '"') quote = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return "";
  }

  return { fromRows, scanFile, maskKey, joinEndpoint, describe };
});
