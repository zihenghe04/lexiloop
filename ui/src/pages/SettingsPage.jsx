import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { Field, Segmented } from "../components/ui.jsx";
import {
  assignRoles,
  backupModule,
  listModels,
  oauthAccount,
  removeConnection,
  saveConnection,
  testProvider
} from "../lib/bridge.js";

const PROTOCOLS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "responses", label: "Responses" }
];

// 预览环境（普通页面）没有 chrome API，读设置时直接跳过
const extStorage = () => (typeof chrome !== "undefined" ? chrome.storage?.local : null);

const EFFORTS = [
  { value: "", label: "默认" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "max", label: "极高" }
];

const PRESETS = [
  { id: "openai", name: "OpenAI", protocol: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
  { id: "responses", name: "OpenAI Responses", protocol: "responses", endpoint: "https://api.openai.com/v1", model: "gpt-5" },
  { id: "deepseek", name: "DeepSeek", protocol: "openai", endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "anthropic-compat", name: "Anthropic 兼容服务（示例）", protocol: "anthropic", endpoint: "https://api.example.com/v1", model: "claude-sonnet-5-5" },
  { id: "chatgpt", name: "ChatGPT 订阅", kind: "subscription", auth: "chatgpt", protocol: "responses", endpoint: "https://chatgpt.com/backend-api/codex", model: "gpt-5" },
  { id: "grok", name: "Grok 订阅", kind: "subscription", auth: "grok", protocol: "responses", endpoint: "https://api.x.ai/v1", model: "grok-4.7" },
  { id: "blank", name: "自定义连接", protocol: "openai", endpoint: "", model: "" }
];

const LANGUAGES = [
  { value: "auto", label: "自动（英 ⇄ 中）" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
  { value: "pt", label: "葡萄牙语" },
  { value: "it", label: "意大利语" },
  { value: "ar", label: "阿拉伯语" }
];

function newConnectionId() {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

export default function SettingsPage({
  translation,
  uiSettings,
  words,
  papers,
  onClose,
  onRefreshTranslation,
  onUiSettings,
  showToast
}) {
  const [section, setSection] = useState("model");
  const [view, setSectionView] = useState("list");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState([]);
  const [oauthStatus, setOauthStatus] = useState(null);
  const [revealKey, setRevealKey] = useState(false);
  const [stats, setStats] = useState(null);
  const restoreRef = useRef(null);

  const connections = translation?.connections || [];
  const roles = translation?.roles || { translation: "", ai: "" };
  const profiles = translation?.profiles || {};

  useEffect(() => {
    if (section !== "data" || stats) return;
    (async () => {
      try {
        const area = extStorage();
        const stored = (area ? await area.get(['lexiloopPdfAnnotations', 'lexiloopPdfAiHistory']) : {}) || {};
        setStats({
          words: words.length,
          papers: papers.length,
          annotations: Object.keys(stored.lexiloopPdfAnnotations || {}).length,
          conversations: Object.keys(stored.lexiloopPdfAiHistory || {}).length
        });
      } catch {
        setStats({ words: words.length, papers: papers.length, annotations: 0, conversations: 0 });
      }
    })();
  }, [section, stats, words.length, papers.length]);

  const startAdd = (preset) => {
    const chosen = preset || PRESETS[PRESETS.length - 1];
    const id = newConnectionId();
    const subscription = chosen.kind === "subscription";
    setDraft({
      mode: "new",
      id,
      kind: chosen.kind || "api",
      name: chosen.name,
      apiKey: "",
      config: {
        version: 3,
        providerProfile: id,
        textProvider: subscription ? "automatic" : "openai-compatible",
        fallbackEnabled: !subscription && chosen.protocol === "openai",
        requestTimeoutMs: 8000,
        pdfAiTimeoutMs: 60000,
        pdfAiStreaming: true,
        apiProtocol: chosen.protocol,
        anthropicMaxTokens: 64000,
        openaiEndpoint: chosen.endpoint,
        openaiModel: chosen.model,
        pdfAiModel: subscription ? chosen.model : "",
        pdfAiAuth: chosen.auth || "api-key",
        pdfAiOAuthModel: subscription ? chosen.model : "",
        translationOAuthModel: subscription ? chosen.model : "",
        openaiResponsePath: chosen.protocol === "anthropic" ? "content.0.text"
          : chosen.protocol === "responses" ? "output_text" : "choices.0.message.content",
        reasoningEffort: "",
        translationReasoningEffort: ""
      }
    });
    setModels([]);
    setRevealKey(false);
    setSectionView("detail");
  };

  const startEdit = (id) => {
    const record = profiles[id];
    if (!record) return;
    setDraft({
      mode: "edit",
      id,
      kind: record.kind === "subscription" ? "subscription" : "api",
      source: record.source || "",
      name: record.name,
      apiKey: "",
      hasApiKey: record.hasApiKey,
      config: { ...record.config }
    });
    setModels([]);
    setOauthStatus(null);
    setRevealKey(false);
    setSectionView("detail");
  };

  const patchDraft = (patch) => setDraft((current) => current ? { ...current, ...patch } : current);
  const patchConfig = (patch) => setDraft((current) => current
    ? { ...current, config: { ...current.config, ...patch } }
    : current);

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await saveConnection(draft.config, {
        apiKey: draft.apiKey || undefined,
        activate: draft.mode === "new",
        connection: { name: draft.name, kind: draft.kind || "api", source: draft.source || "" }
      });
      await onRefreshTranslation();
      setSectionView("list");
      showToast(draft.mode === "new" ? "已添加连接" : "已保存");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const result = await testProvider(draft.config, draft.apiKey || undefined);
      showToast(result.message || "连接正常");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const loadModels = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const result = isSubscriptionDraft
        ? await oauthAccount(draft.config.pdfAiAuth === "grok" ? "grok" : "chatgpt", "models")
        : await listModels(draft.config, draft.apiKey || undefined);
      setModels(Array.isArray(result.models) ? result.models : []);
      if (!result.models?.length) showToast("没有取到模型列表，可直接手填模型名");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const checkOauth = async () => {
    if (!isSubscriptionDraft || busy) return;
    setBusy(true);
    try {
      const provider = draft.config.pdfAiAuth === "grok" ? "grok" : "chatgpt";
      const result = await oauthAccount(provider, "status");
      setOauthStatus(result);
      if (result.pending && result.userCode) showToast(`请在授权页面输入代码：${result.userCode}`);
      else showToast(result.account ? "订阅已登录" : "尚未登录，请点击登录");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const loginOauth = async () => {
    if (!isSubscriptionDraft || busy) return;
    setBusy(true);
    try {
      const provider = draft.config.pdfAiAuth === "grok" ? "grok" : "chatgpt";
      const result = await oauthAccount(provider, "login");
      setOauthStatus(result);
      showToast(result.userCode ? `授权代码：${result.userCode}` : "已打开登录页面");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await removeConnection(id);
      await onRefreshTranslation();
      setSectionView("list");
      showToast("已删除连接，密钥保留在本机");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const updateRole = async (role, id) => {
    try {
      await assignRoles({ ...roles, [role]: id });
      await onRefreshTranslation();
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const startBackup = async () => {
    try {
      const backup = backupModule();
      if (!backup?.exportData) { showToast("备份模块未加载，请重新加载扩展"); return; }
      const blob = await backup.exportData();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lexiloop-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast("已生成完整备份");
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const handleRestore = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const backup = backupModule();
    if (!backup?.importData) { showToast("备份模块未加载，请重新加载扩展", { tone: "error" }); return; }
    try {
      showToast("正在恢复，期间请勿关闭页面");
      await backup.importData(file);
      showToast("已恢复备份，正在刷新");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const recoverLast = async () => {
    const backup = backupModule();
    if (!backup?.recover) { showToast("备份模块未加载，请重新加载扩展", { tone: "error" }); return; }
    try {
      await backup.recover();
      showToast("已回到恢复前的数据");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const roleOptions = useMemo(() => {
    const options = [{ value: "", label: "未选择" }];
    for (const item of connections) options.push({ value: item.id, label: item.name });
    return options;
  }, [connections]);
  const isSubscriptionDraft = Boolean(draft && (draft.kind === "subscription"
    || draft.config.pdfAiAuth === "chatgpt" || draft.config.pdfAiAuth === "grok"));
  const draftModel = isSubscriptionDraft
    ? draft.config.pdfAiOAuthModel || draft.config.translationOAuthModel || draft.config.pdfAiModel || draft.config.openaiModel || ""
    : draft?.config?.openaiModel || "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="返回">
          <Icon name="chevron" size={15} className="rotate-180" />
        </button>
        <h1 className="flex-1 text-ui font-semibold text-foreground">设置</h1>
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: "model", label: "模型" },
            { value: "prefs", label: "偏好" },
            { value: "data", label: "数据" }
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {section === "model" && view === "list" ? (
          <div className="animate-fade">
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="section-title">连接用途</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="翻译使用">
                  <select className="field" value={roles.translation || ""} onChange={(event) => updateRole("translation", event.target.value)}>
                    {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label="AI 使用">
                  <select className="field" value={roles.ai || ""} onChange={(event) => updateRole("ai", event.target.value)}>
                    {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
              </div>
              {!connections.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">没有连接时，划词与句子翻译仍走内置免费翻译；PDF AI 需要先添加一条连接。</p>
              ) : null}
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="section-title">已添加的连接</p>
                <span className="text-[11px] text-muted-foreground">{connections.length} 条</span>
              </div>
              {connections.length ? connections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="row-hover flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left last:border-b-0"
                  onClick={() => startEdit(item.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-ui font-medium text-foreground">{item.name}</span>
                      {item.kind === "subscription" ? <span className="chip">订阅</span> : null}
                      {roles.translation === item.id || roles.ai === item.id ? (
                        <span className="chip border-primary/30 bg-primary-soft text-primary">
                          {roles.translation === item.id && roles.ai === item.id ? "翻译 · AI" : roles.translation === item.id ? "翻译" : "AI"}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {profiles[item.id]?.config?.pdfAiOAuthModel || profiles[item.id]?.config?.translationOAuthModel || profiles[item.id]?.config?.pdfAiModel || profiles[item.id]?.config?.openaiModel || "未设置模型"}
                      {" · "}
                      {profiles[item.id]?.config?.apiProtocol === "anthropic" ? "Anthropic" : profiles[item.id]?.config?.apiProtocol === "responses" ? "Responses" : "OpenAI"}
                    </span>
                  </span>
                  <Icon name="chevron" size={14} className="shrink-0 text-muted-foreground" />
                </button>
              )) : (
                <div className="px-3 py-6 text-center">
                  <p className="text-ui-sm text-muted-foreground">还没有连接</p>
                </div>
              )}
            </div>

            <div className="mt-3">
              <p className="section-title mb-2 px-1">添加连接</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="btn justify-start px-2.5"
                    onClick={() => startAdd(preset)}
                  >
                    <Icon name={preset.id === "blank" ? "plus" : "key"} size={13} className="text-muted-foreground" />
                    <span className="truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                订阅登录（ChatGPT / Grok）沿用已有账号，添加时会自动读取本机凭据。
              </p>
            </div>
          </div>
        ) : null}

        {section === "model" && view === "detail" && draft ? (
          <div className="animate-fade">
            <button type="button" className="btn btn-ghost mb-2 px-1 text-[11px]" onClick={() => setSectionView("list")}>
              <Icon name="chevron" size={12} className="rotate-180" />
              连接列表
            </button>

            <div className="rounded-lg border border-border bg-background p-3">
              <Field label="名称">
                <input className="field" value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} placeholder="例如：DeepSeek 翻译" />
              </Field>
              {!isSubscriptionDraft ? (
                <>
                  <div className="mt-3">
                    <Field label="API 地址" hint="填到 /v1 即可，接口路径会按协议自动补全">
                      <input className="field" value={draft.config.openaiEndpoint} onChange={(event) => patchConfig({ openaiEndpoint: event.target.value })} placeholder="https://api.example.com/v1" />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="接口协议">
                      <select
                        className="field"
                        value={draft.config.apiProtocol}
                        onChange={(event) => {
                          const protocol = event.target.value;
                          patchConfig({
                            apiProtocol: protocol,
                            openaiResponsePath: protocol === "anthropic" ? "content.0.text" : protocol === "responses" ? "output_text" : "choices.0.message.content"
                          });
                        }}
                      >
                        {PROTOCOLS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="API Key" hint={draft.mode === "edit" && draft.hasApiKey ? "已保存在本机，留空则不变" : "只保存在本机，不会同步到云端"}>
                      <div className="flex gap-1.5">
                        <input
                          className="field"
                          type={revealKey ? "text" : "password"}
                          value={draft.apiKey}
                          onChange={(event) => patchDraft({ apiKey: event.target.value })}
                          placeholder={draft.mode === "edit" && draft.hasApiKey ? "••••••••" : "粘贴密钥"}
                          autoComplete="off"
                        />
                        <button type="button" className="btn btn-icon shrink-0" onClick={() => setRevealKey((value) => !value)} title="显示或隐藏">
                          <Icon name="key" size={14} />
                        </button>
                      </div>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="模型" hint="可手动输入模型 ID，或从接口读取">
                      <div className="flex gap-1.5">
                        <input className="field" aria-label="模型" value={draft.config.openaiModel} onChange={(event) => patchConfig({ openaiModel: event.target.value })} placeholder="模型名称 / ID" />
                        <button type="button" className="btn shrink-0" onClick={loadModels} disabled={busy}>取列表</button>
                      </div>
                    </Field>
                    {models.length ? (
                      <select
                        className="field mt-1.5"
                        aria-label="从模型列表选择"
                        value=""
                        onChange={(event) => { if (event.target.value) patchConfig({ openaiModel: event.target.value }); }}
                      >
                        <option value="">从列表选择（{models.length}）</option>
                        {models.map((model) => <option key={model} value={model}>{model}</option>)}
                      </select>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="mt-3 rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="section-title">订阅模型</p>
                    <span className={`chip ${oauthStatus?.account ? "chip-brand" : ""}`}>{oauthStatus?.account ? "已登录" : "登录状态未知"}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">翻译和 PDF AI 可以分别选模型。修改后保存，按上方“翻译使用 / AI 使用”的连接角色生效。</p>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" className="btn btn-primary flex-1" onClick={loginOauth} disabled={busy}>登录 {draft.config.pdfAiAuth === "grok" ? "Grok" : "ChatGPT"}</button>
                    <button type="button" className="btn" onClick={checkOauth} disabled={busy}>刷新状态</button>
                  </div>
                  {oauthStatus?.userCode ? <p className="mt-2 rounded-md bg-accent px-2 py-1.5 text-[11px] text-foreground">授权代码：<strong className="font-mono">{oauthStatus.userCode}</strong></p> : null}
                  <div className="mt-3">
                    <Field label="翻译模型">
                      <input className="field" aria-label="翻译模型" value={draft.config.translationOAuthModel || draft.config.pdfAiOAuthModel || draft.config.pdfAiModel || ""} onChange={(event) => patchConfig({ translationOAuthModel: event.target.value })} placeholder={draft.config.pdfAiAuth === "grok" ? "grok-4.7" : "模型名称 / ID"} />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="AI 模型">
                      <input className="field" aria-label="AI 模型" value={draft.config.pdfAiOAuthModel || draft.config.pdfAiModel || draft.config.openaiModel || ""} onChange={(event) => patchConfig({ pdfAiOAuthModel: event.target.value, pdfAiModel: event.target.value })} placeholder={draft.config.pdfAiAuth === "grok" ? "grok-4.7" : "模型名称 / ID"} />
                    </Field>
                  </div>
                </div>
              )}
              <div className="mt-3">
                <Field label="推理强度" hint="订阅模型和推理模型才需要；普通翻译模型保持默认">
                  <select className="field" value={draft.config.reasoningEffort || ""} onChange={(event) => patchConfig({ reasoningEffort: event.target.value })}>
                    {EFFORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <button type="button" className="btn" onClick={test} disabled={busy}>测试</button>
                <button type="button" className="btn btn-primary ml-auto" onClick={save} disabled={busy}>
                  {busy ? "处理中" : draft.mode === "new" ? "添加并启用" : "保存"}
                </button>
              </div>
              {draft.mode === "edit" ? (
                <button type="button" className="mt-2 w-full text-left text-[11px] text-destructive" onClick={() => remove(draft.id)}>
                  删除这条连接（密钥保留在本机）
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {section === "prefs" ? (
          <div className="space-y-3 animate-fade">
            <div className="rounded-lg border border-border bg-background p-3">
              <Field label="翻译成" hint="划词、快捷键和 PDF 对照翻译都按这个设置">
                <select
                  className="field"
                  value={uiSettings.targetLanguage || "auto"}
                  onChange={async (event) => {
                    const value = event.target.value;
                    const next = { ...uiSettings, targetLanguage: value };
                    onUiSettings(next);
                    const area = extStorage();
                    if (!area) return;
                    try {
                      const stored = await area.get('lexiloopSettings') || {};
                      await area.set({ lexiloopSettings: { ...(stored.lexiloopSettings || {}), targetLanguage: value } });
                    } catch (error) {
                      showToast(error.message, { tone: "error" });
                    }
                  }}
                >
                  {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-background">
              {[
                { key: "selectionBubbleEnabled", title: "划词气泡", hint: "选中文字后显示翻译气泡" },
                { key: "enhancedPdfEnabled", title: "增强 PDF", hint: "在 PDF 页面上启用划词与批注" }
              ].map((item) => (
                <label key={item.key} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui text-foreground">{item.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--brand)]"
                    checked={uiSettings[item.key] !== false}
                    onChange={async (event) => {
                      const value = event.target.checked;
                      const next = { ...uiSettings, [item.key]: value };
                      onUiSettings(next);
                      const area = extStorage();
                      if (!area) return;
                      try {
                        const stored = await area.get('lexiloopSettings') || {};
                        await area.set({ lexiloopSettings: { ...(stored.lexiloopSettings || {}), [item.key]: value } });
                      } catch (error) {
                        showToast(error.message, { tone: "error" });
                      }
                    }}
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              className="btn w-full justify-between"
              onClick={async () => {
                try {
                  await chrome.runtime?.sendMessage?.({ type: "OPEN_SHORTCUT_SETTINGS" });
                } catch (error) {
                  showToast(error.message, { tone: "error" });
                }
              }}
            >
              <span>快捷键设置</span>
              <Icon name="external" size={13} className="text-muted-foreground" />
            </button>
          </div>
        ) : null}

        {section === "data" ? (
          <div className="space-y-3 animate-fade">
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="section-title">本地数据</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  { label: "词条", value: stats?.words ?? words.length },
                  { label: "文献", value: stats?.papers ?? papers.length },
                  { label: "批注", value: stats?.annotations ?? "—" },
                  { label: "AI 会话", value: stats?.conversations ?? "—" }
                ].map((item) => (
                  <div key={item.label} className="rounded-[9px] bg-accent px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">{item.label}</p>
                    <p className="text-ui-lg font-semibold tabular-nums text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background p-3">
              <p className="section-title">备份与恢复</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                备份包含词库、文献、PDF 原件、索引、批注和会话，不包含 API Key 与登录凭据。
              </p>
              <button type="button" className="btn btn-primary mt-3 w-full" onClick={startBackup}>
                生成完整备份
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="btn" onClick={() => restoreRef.current?.click()}>
                  恢复备份
                </button>
                <button type="button" className="btn" onClick={recoverLast}>
                  恢复上次数据
                </button>
              </div>
              <input
                ref={restoreRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={handleRestore}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                恢复前请关闭其它 LexiLoop 页面，避免同时写入。
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}