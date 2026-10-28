import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LookupPage from "../pages/LookupPage.jsx";
import WordsPage from "../pages/WordsPage.jsx";
import LibraryPage from "../pages/LibraryPage.jsx";
import ReviewPage from "../pages/ReviewPage.jsx";
import { Segmented, Toasts } from "../components/ui.jsx";
import { translate, mutateWord, patchPaper, removePaper, openReader } from "../lib/bridge.js";

vi.mock("../lib/bridge.js", () => ({
  translate: vi.fn(async text => ({ original: text, translated: "释义", phonetics: { us: "test" }, recorded: true })),
  mutateWord: vi.fn(async () => []),
  openWordSource: vi.fn(async () => ({ ok: true })),
  importLocalPdf: vi.fn(async file => ({ id: file.name, title: file.name })),
  openReader: vi.fn(async () => ({ ok: true })),
  patchPaper: vi.fn(async () => []),
  removePaper: vi.fn(async () => [])
}));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
const props = { showToast: vi.fn(), onRefresh: vi.fn(async () => []) };
const papers = [
  { id: "a", title: "Attention Is All You Need", authors: "Vaswani", tags: ["transformer"], status: "reading", currentPage: 3, progress: .2 },
  { id: "b", title: "Residual Learning", authors: "He", tags: [], status: "unread" }
];

describe("贯通后的工作区", () => {
  it("划词意图携带 PDF 来源和上下文，且下一次意图不被旧请求覆盖", async () => {
    let resolveFirst;
    translate.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const intent = { id: 1, text: "alpha", context: "from PDF", source: { paperId: "p", page: 4 } };
    const { rerender } = render(<LookupPage active recent={[]} intent={intent} targetLanguage="auto" onWordsChanged={vi.fn()} showToast={vi.fn()} />);
    await waitFor(() => expect(translate).toHaveBeenCalledWith("alpha", expect.objectContaining({ source: intent.source, context: intent.context })));
    rerender(<LookupPage active recent={[]} intent={{ ...intent, id: 2, text: "beta" }} targetLanguage="auto" onWordsChanged={vi.fn()} showToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "beta" })).toBeInTheDocument());
    await act(async () => resolveFirst({ original: "alpha", translated: "旧结果" }));
    expect(screen.queryByText("旧结果")).not.toBeInTheDocument();
  });
  it("隐藏页不争抢斜杠和复习快捷键", () => {
    render(<><LookupPage active={false} recent={[]} showToast={vi.fn()} /><WordsPage active words={[]} {...props} /><ReviewPage active={false} words={[{ id: "a", original: "alpha" }]} {...props} /></>);
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByRole("textbox", { name: "搜索词库" })).toHaveFocus();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.queryByRole("button", { name: /^记得/ })).not.toBeInTheDocument();
  });
  it("收起的词条内容不可聚焦，展开不触发重查", async () => {
    const onLookup = vi.fn();
    render(<WordsPage active words={[{ id: "a", original: "alpha", translated: "阿尔法", lookups: [] }]} {...props} onLookup={onLookup} />);
    const trigger = screen.getByRole("button", { expanded: false });
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    expect(panel).toHaveAttribute("inert");
    fireEvent.click(trigger);
    expect(panel).not.toHaveAttribute("inert");
    expect(onLookup).not.toHaveBeenCalled();
  });
  it("文献可搜索标签，编辑元数据并查看关联生词", async () => {
    const onRelatedWords = vi.fn();
    render(<LibraryPage active papers={papers} words={[{ id: "w", lookups: [{ source: { paperId: "a" } }] }]} {...props} onRelatedWords={onRelatedWords} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索文献" }), { target: { value: "transformer" } });
    expect(screen.queryByText("Residual Learning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多操作：Attention Is All You Need" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "查看 1 个关联生词" }));
    expect(onRelatedWords).toHaveBeenCalledWith(papers[0]);
    fireEvent.click(screen.getByRole("button", { name: "更多操作：Attention Is All You Need" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑信息" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(patchPaper).toHaveBeenCalledWith("a", expect.objectContaining({ title: "New title" })));
  });
  it("删除文献必须确认，不会误点直接删除", async () => {
    render(<LibraryPage active papers={papers} words={[]} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作：Residual Learning" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除文献" }));
    expect(removePaper).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(removePaper).toHaveBeenCalledWith("b"));
  });
  it("标签支持方向键和 Home / End，保持选择与焦点一致", async () => {
    const user = userEvent.setup();
    function Tabs() { const [value, setValue] = React.useState("a"); return <Segmented label="测试导航" value={value} onChange={setValue} options={[{ value: "a", label: "甲" }, { value: "b", label: "乙", icon: "book" }]} />; }
    render(<Tabs />);
    screen.getByRole("tab", { name: "甲" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "乙" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "乙" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "甲" })).toHaveFocus();
  });
  it("提示条可自动消失，点击撤销只执行一次", async () => {
    const dismiss = vi.fn(), action = vi.fn();
    const { rerender } = render(<Toasts items={[{ id: 1, text: "已删除", actionLabel: "撤销", onAction: action, duration: 6000 }]} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith(1);
    rerender(<Toasts items={[{ id: 2, text: "完成", duration: 20 }]} onDismiss={dismiss} />);
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(2));
  });
});
