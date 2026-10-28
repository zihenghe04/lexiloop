import { describe, expect, it } from "vitest";
import { filterPapers, latestLookup, relatedWords, sourceKind, reviewQueue } from "../lib/workspace.js";

describe("阅读与词库的共享逻辑", () => {
  const papers = [
    { id: "a", title: "Attention Is All You Need", authors: "Vaswani", tags: ["transformer"], status: "read", updatedAt: "2026-10-20" },
    { id: "b", title: "Residual Learning", authors: "He", year: 2016, status: "reading", favorite: true, updatedAt: "2026-10-21" },
    { id: "c", title: "Local notes", status: "unread", updatedAt: "bad" }
  ];
  it("按作者、标题、标签、年份搜索并与状态取交集", () => {
    expect(filterPapers(papers, { query: "vaswani" }).map(p => p.id)).toEqual(["a"]);
    expect(filterPapers(papers, { query: "transformer", filter: "read" })).toHaveLength(1);
    expect(filterPapers(papers, { query: "2016", filter: "favorite" })).toHaveLength(1);
    expect(filterPapers(papers, { query: "2016", filter: "unread" })).toHaveLength(0);
    expect(filterPapers(papers, { sort: "title" }).map(p => p.id)).toEqual(["a", "c", "b"]);
    expect(filterPapers(papers).map(p => p.id)).toEqual(["b", "a", "c"]);
    expect(filterPapers([], { query: "x" })).toEqual([]);
  });
  it("查询历史按时间取最近一条，而非假定数组顺序", () => {
    expect(latestLookup({ lookups: [{ at: "2026-10-22" }, { at: "2026-10-20" }] }).at).toBe("2026-10-22");
    expect(latestLookup({ lookups: [{ at: "bad" }, { at: "2026-10-23" }] }).at).toBe("2026-10-23");
    expect(latestLookup({})).toBeNull();
  });
  it("用文献 id 或精确文档 URL 关联生词，不误关联普通网页", () => {
    const paper = { id: "a", sourceUrl: "https://example.org/a.pdf" };
    const words = [
      { id: "1", lookups: [{ source: { paperId: "a" } }] },
      { id: "2", lookups: [{ source: { url: "https://example.org/a.pdf#page=2" } }] },
      { id: "3", lookups: [{ source: { url: "https://example.org/other.pdf" } }] },
      { id: "4", lookups: [] }
    ];
    expect(relatedWords(words, paper).map(w => w.id)).toEqual(["1", "2"]);
    expect(relatedWords(words, null)).toEqual([]);
    expect(sourceKind({ kind: "pdf", url: "https://example.org/a.pdf" })).toBe("pdf");
    expect(sourceKind({ documentKey: "doc" })).toBe("pdf");
    expect(sourceKind({ url: "https://example.org/article" })).toBe("web");
    expect(sourceKind({ url: "javascript:alert(1)" })).toBe("none");
    expect(sourceKind()).toBe("none");
  });
  it("评分后从动态队列头部继续，不递增游标而跳词", () => {
    const now = Date.now();
    const words = [{ id: "1", review: { dueAt: new Date(now - 5000).toISOString() } }, { id: "2" }, { id: "3", review: { dueAt: new Date(now + 86400000).toISOString() } }];
    expect(reviewQueue(words, new Set()).map(w => w.id)).toEqual(["2", "1"]);
    expect(reviewQueue(words, new Set(["2"])).map(w => w.id)).toEqual(["1"]);
  });
});
