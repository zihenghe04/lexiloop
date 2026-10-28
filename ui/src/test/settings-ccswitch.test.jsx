import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "../pages/SettingsPage.jsx";

const { preview, saveConnection } = vi.hoisted(() => ({
  preview: vi.fn(),
  saveConnection: vi.fn(async () => ({}))
}));

vi.mock("../lib/bridge.js", () => ({
  ccSwitchPreview: (...args) => preview(...args),
  saveConnection: (...args) => saveConnection(...args),
  assignRoles: vi.fn(async () => ({})),
  removeConnection: vi.fn(async () => ({})),
  listModels: vi.fn(async () => ({ models: [] })),
  testProvider: vi.fn(async () => ({})),
  oauthAccount: vi.fn(async () => ({})),
  backupModule: () => null
}));

const usable = {
  skip: "",
  name: "DeepSeek 直连",
  appType: "claude",
  protocol: "anthropic",
  endpoint: "https://api.deepseek.com/anthropic/v1/messages",
  model: "deepseek-chat",
  apiKey: "sk-abcdefgh12345678",
  maskedKey: "sk-…78",
  source: "cc-switch:claude:a1"
};

const skipped = {
  skip: "订阅登录或官方账号不能作为 API Key 导入",
  name: "官方账号",
  appType: "claude",
  protocol: "",
  endpoint: "",
  model: "",
  apiKey: "",
  maskedKey: "",
  source: "cc-switch:claude:a2"
};

function renderSettings(overrides = {}) {
  const props = {
    translation: { connections: [], roles: { translation: "", ai: "" }, profiles: {} },
    uiSettings: {},
    words: [],
    papers: [],
    onClose: () => {},
    onRefreshTranslation: async () => {},
    onUiSettings: () => {},
    showToast: () => {},
    ...overrides
  };
  return render(<SettingsPage {...props} />);
}

beforeEach(() => {
  preview.mockReset();
  saveConnection.mockClear();
  globalThis.LexiLoopCcSwitch = {
    fromRows: (rows) => rows.map((row) => row.candidate)
  };
});

afterEach(() => {
  delete globalThis.LexiLoopCcSwitch;
});

describe("从 CC Switch 导入连接", () => {
  it("列出可导入的供应商，订阅账号不可选并说明原因", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({
      ok: true,
      providers: [{ candidate: usable }, { candidate: skipped }]
    });
    renderSettings();

    await user.click(screen.getByRole("button", { name: "从 CC Switch 导入" }));

    const dialog = await screen.findByRole("dialog", { name: "从 CC Switch 导入" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText("DeepSeek 直连")).toBeInTheDocument();
    expect(screen.getByText("订阅登录或官方账号不能作为 API Key 导入")).toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeDisabled();
  });

  it("导入时按候选写入协议、地址和密钥，并且只激活第一条", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({ ok: true, providers: [{ candidate: usable }] });
    renderSettings();

    await user.click(screen.getByRole("button", { name: "从 CC Switch 导入" }));
    await screen.findByText("DeepSeek 直连");
    await user.click(screen.getByRole("button", { name: /导入 1 条/ }));

    await waitFor(() => expect(saveConnection).toHaveBeenCalledTimes(1));
    const [config, options] = saveConnection.mock.calls[0];
    expect(config.apiProtocol).toBe("anthropic");
    expect(config.openaiEndpoint).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(config.openaiModel).toBe("deepseek-chat");
    expect(options.apiKey).toBe("sk-abcdefgh12345678");
    expect(options.activate).toBe(true);
    expect(options.connection).toMatchObject({ name: "DeepSeek 直连", kind: "api", source: "cc-switch:claude:a1" });
  });

  it("已有连接时导入不会抢占当前角色", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({ ok: true, providers: [{ candidate: usable }] });
    renderSettings({
      translation: {
        connections: [{ id: "c_existing", name: "已有连接", kind: "api" }],
        roles: { translation: "c_existing", ai: "c_existing" },
        profiles: { c_existing: { name: "已有连接", kind: "api", config: { openaiModel: "gpt-4.1-mini" } } }
      }
    });

    await user.click(screen.getByRole("button", { name: "从 CC Switch 导入" }));
    await screen.findByText("DeepSeek 直连");
    await user.click(screen.getByRole("button", { name: /导入 1 条/ }));

    await waitFor(() => expect(saveConnection).toHaveBeenCalledTimes(1));
    expect(saveConnection.mock.calls[0][1].activate).toBe(false);
  });

  it("导入模块没有加载时给出重新加载提示，而不是空列表", async () => {
    const user = userEvent.setup();
    delete globalThis.LexiLoopCcSwitch;
    preview.mockResolvedValue({ ok: true, providers: [{ candidate: usable }] });
    renderSettings();

    await user.click(screen.getByRole("button", { name: "从 CC Switch 导入" }));
    expect(await screen.findByText("导入模块未加载，请重新加载扩展")).toBeInTheDocument();
  });

  it("没有 CC Switch 数据库时说明原因", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({ ok: true, providers: [], missing: true });
    renderSettings();

    await user.click(screen.getByRole("button", { name: "从 CC Switch 导入" }));
    expect(await screen.findByText(/没有找到 CC Switch 数据库/)).toBeInTheDocument();
  });
});
