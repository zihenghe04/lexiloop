import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../components/ui.jsx";
import ReviewPage from "../pages/ReviewPage.jsx";
import { subscribeExtension, consumePanelIntent } from "../lib/extension-events.js";
import { mutateWord } from "../lib/bridge.js";
vi.mock("../lib/bridge.js", () => ({ mutateWord: vi.fn(async () => []) }));

describe("生产型交互", () => {
  it("弹窗有名称、约束 Tab 焦点并在关闭后返回触发器", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const { rerender } = render(<><button>触发器</button><Modal open={false} title="编辑文献" onClose={close}><input aria-label="标题" /></Modal></>);
    const trigger = screen.getByRole("button", { name: "触发器" });
    trigger.focus();
    rerender(<><button>触发器</button><Modal open title="编辑文献" onClose={close}><input aria-label="标题" /></Modal></>);
    expect(screen.getByRole("dialog", { name: "编辑文献" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement));
    screen.getByLabelText("标题").focus();
    await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement);
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<><button>触发器</button><Modal open={false} title="编辑文献" onClose={close}><input aria-label="标题" /></Modal></>);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("复习不跳词，三条应全部评分并显示真实音标", async () => {
    const words = ["alpha", "beta", "gamma"].map(id => ({ id, original: id, translated: id + "释义", phonetics: { us: "test" } }));
    const refresh = vi.fn();
    render(<ReviewPage words={words} onRefresh={refresh} showToast={vi.fn()} onPractice={vi.fn()} />);
    expect(screen.getByText(/美 \/test\//)).toBeInTheDocument();
    for (const word of words) {
      await waitFor(() => expect(screen.getByRole("heading", { name: word.original })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
      fireEvent.click(screen.getByRole("button", { name: /记得/ }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(words.indexOf(word) + 1));
    }
    expect(screen.getByText("完成 3 个词条")).toBeInTheDocument();
    expect(mutateWord.mock.calls.map(([arg]) => arg.id)).toEqual(["alpha", "beta", "gamma"]);
  });
  it("实时订阅按键分发，取消订阅后释放监听器", () => {
    let storageListener, messageListener;
    const storageRemove = vi.fn(), messageRemove = vi.fn();
    const api = { storage: { onChanged: { addListener: fn => { storageListener = fn; }, removeListener: storageRemove } }, runtime: { onMessage: { addListener: fn => { messageListener = fn; }, removeListener: messageRemove } } };
    const onWords = vi.fn(), onPapers = vi.fn(), onSelection = vi.fn(), onTab = vi.fn(), onSettings = vi.fn();
    const stop = subscribeExtension(api, { onWords, onPapers, onSelection, onTab, onSettings });
    storageListener({ lexiloopWords: { newValue: [{ id: "x" }] } }, "local");
    storageListener({ lexiloopPdfLibrary: { newValue: [] } }, "local");
    storageListener({ lexiloopSettings: { newValue: { targetLanguage: "ja" } } }, "local");
    messageListener({ type: "PANEL_SELECTION", payload: { text: "word" } });
    messageListener({ type: "SHOW_PANEL_TAB", tab: "library" });
    expect(onWords).toHaveBeenCalledWith([{ id: "x" }]);
    expect(onPapers).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith({ text: "word" });
    expect(onTab).toHaveBeenCalledWith("library");
    expect(onSettings).toHaveBeenCalledWith({ targetLanguage: "ja" });
    stop();
    expect(storageRemove).toHaveBeenCalledWith(storageListener);
    expect(messageRemove).toHaveBeenCalledWith(messageListener);
  });
  it("侧边栏关闭期间的待处理划词只消费一次", async () => {
    const api = { storage: { session: { get: vi.fn(async () => ({ lexiloopPending: { text: "embedding" }, lexiloopPanelTab: "words" })), remove: vi.fn(async () => {}) } } };
    expect(await consumePanelIntent(api)).toMatchObject({ selection: { text: "embedding" }, tab: "words" });
    expect(api.storage.session.remove).toHaveBeenCalledWith(["lexiloopPending", "lexiloopPanelTab", "lexiloopSettingsPending"]);
  });
});
