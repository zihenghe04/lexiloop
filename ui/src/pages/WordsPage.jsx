import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { Empty, Segmented, SpeakButton } from "../components/ui.jsx";
import { mutateWord, openWordSource } from "../lib/bridge.js";
import {
  dateValue,
  formatPhonetics,
  formatRelative,
  hostOf,
  meaningSummary,
  searchable
} from "../lib/format.js";

const MAX_LOOKUPS = 8;

function meaningsOf(word) {
  const list = Array.isArray(word?.meanings) ? word.meanings : [];
  return list.filter((item) => item && (item.partOfSpeech || (item.definitions || []).length));
}

function lookupsOf(word) {
  const list = Array.isArray(word?.lookups) ? word.lookups : [];
  return list.slice(-MAX_LOOKUPS).reverse();
}

function sourceTitle(source) {
  if (!source) return "手动输入";
  return String(source.title || hostOf(source.url) || "未知来源");
}

function sourceMeta(source) {
  const parts = [];
  if (source?.page) parts.push(`第 ${source.page} 页`);
  const host = hostOf(source?.url);
  const title = String(source?.title || "").trim();
  // 标题已经退化成域名时不再重复显示同一个域名
  if (host && title && host !== title) parts.push(host);
  return parts.join(" · ");
}

export default function WordsPage({ active = true, words, scope, onClearScope, onRefresh, onLookup, showToast }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [openIds, setOpenIds] = useState(() => new Set());
  const inputRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.target?.closest?.("select, [contenteditable=true], [role=dialog]")) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const list = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle ? words.filter((word) => searchable(word).includes(needle)) : [...words];
    if (sort === "count") {
      filtered.sort((a, b) => Number(b.translationCount || 0) - Number(a.translationCount || 0)
        || dateValue(b.updatedAt) - dateValue(a.updatedAt));
    } else if (sort === "alpha") {
      filtered.sort((a, b) => String(a.original).localeCompare(String(b.original)));
    } else {
      filtered.sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt)
        || Number(b.translationCount || 0) - Number(a.translationCount || 0));
    }
    return filtered;
  }, [words, query, sort]);

  const toggle = (id) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const remove = async (word) => {
    const index = words.findIndex((item) => item.id === word.id);
    try {
      await mutateWord({ action: "delete", id: word.id });
      await onRefresh();
      showToast(`已删除「${word.original}」`, {
        duration: 6000,
        actionLabel: "撤销",
        onAction: async () => {
          try {
            await mutateWord({ action: "restore", word, index });
            await onRefresh();
            showToast("已恢复");
          } catch (error) {
            showToast(error.message, { tone: "error" });
          }
        }
      });
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const jump = async (word, source) => {
    try {
      const response = await openWordSource(word, source);
      if (!response) showToast("这个词没有记录到来源位置", { tone: "error" });
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ format: "lexiloop-words", version: 1, words }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lexiloop-words-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${words.length} 个词条`);
  };

  return (
    <div className="page-content words-page">
      <div className="page-heading"><div><span className="eyebrow">WORDS WITH A STORY</span><h1>你的词汇轨迹</h1></div><span className="count-badge">{words.length} 个词</span></div>
      {scope ? <div className="scope-banner"><Icon name="library" size={14} /><span><small>来自这篇文献</small><strong>{scope.title}</strong></span><button type="button" onClick={onClearScope} aria-label="显示全部词条"><Icon name="close" size={13} /></button></div> : null}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-primary">
          <Icon name="search" size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索单词、释义或来源"
            className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="搜索词库"
          />
          {query ? (
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setQuery("")} aria-label="清除">
              <Icon name="close" size={13} />
            </button>
          ) : null}
        </div>
        <button type="button" className="btn btn-icon shrink-0" onClick={exportJson} title="导出 JSON" aria-label="导出 JSON">
          <Icon name="external" size={15} />
        </button>
      </div>

      <div className="mb-2 mt-3 flex items-center justify-between">
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "recent", label: "最近" },
            { value: "count", label: "次数" },
            { value: "alpha", label: "字母" }
          ]}
        />
        <span className="text-[11px] text-muted-foreground">{list.length} / {words.length} 个</span>
      </div>

      {list.length ? (
        <ul className="word-list">
          {list.map((word) => {
            const key = word.id || word.original;
            const open = openIds.has(key);
            const phonetics = formatPhonetics(word.phonetics);
            const meanings = meaningsOf(word);
            const lookups = lookupsOf(word);
            return (
              <li
                key={key}
                className="word-row group"
                data-open={open ? "true" : "false"}
              >
                <button
                  type="button"
                  className="word-row__head"
                  onClick={() => toggle(key)}
                  aria-expanded={open}
                  aria-controls={`word-panel-${key}`}
                >
                  <Icon
                    name="chevron"
                    size={13}
                    className="word-row__chevron shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-ui font-medium text-foreground">{word.original}</span>
                      {phonetics ? (
                        <span className="shrink-0 truncate text-[11px] text-muted-foreground">{phonetics}</span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground row-swap">
                        {formatRelative(word.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="truncate text-ui-sm text-muted-foreground">{meaningSummary(word, 1)}</span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground row-swap">
                        {Number(word.translationCount || 1)} 次
                      </span>
                    </span>
                  </span>
                </button>

                <div className={`absolute right-1.5 top-1.5 flex gap-0.5 transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                  <SpeakButton
                    text={word.original}
                    language={word.detectedLanguage}
                    audio={word.audio}
                    className="h-7 w-7"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon h-7 w-7"
                    title="重新查词"
                    aria-label="重新查词"
                    onClick={() => onLookup(word)}
                  >
                    <Icon name="search" size={13} />
                  </button>
                </div>

                <div id={`word-panel-${key}`} className="word-row__panel" aria-hidden={!open} inert={!open ? "" : undefined}>
                  <div>
                    <div className="px-3 pb-3 pl-8">
                      {meanings.length ? (
                        <dl className="space-y-1">
                          {meanings.map((item, index) => (
                            <div key={`${item.partOfSpeech || "def"}-${index}`} className="flex gap-1.5">
                              <dt className="w-7 shrink-0 pt-px text-[11px] italic text-muted-foreground">{item.partOfSpeech || ""}</dt>
                              <dd className="min-w-0 flex-1 text-ui-sm leading-relaxed text-foreground">
                                {(item.definitions || []).join("；")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-ui-sm text-foreground">{word.translated || "—"}</p>
                      )}

                      <div className="mt-3 flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          查过 {Number(word.translationCount || lookups.length || 1)} 次
                        </span>
                        {lookups.length ? <span className="h-px flex-1 bg-border" /> : null}
                      </div>

                      {lookups.length ? (
                        <ol className="mt-1.5 space-y-1">
                          {lookups.map((entry, index) => (
                            <li key={`${entry.at || "t"}-${index}`}>
                              <button
                                type="button"
                                className="group/entry block w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent"
                                onClick={() => jump(word, entry.source)}
                                title="打开原文位置"
                              >
                                <span className="flex items-baseline gap-1.5">
                                  <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground">
                                    {sourceTitle(entry.source)}
                                  </span>
                                  <Icon
                                    name="external"
                                    size={11}
                                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/entry:opacity-100"
                                  />
                                </span>
                                <span className="mt-0.5 flex items-baseline gap-1.5 text-[10px] text-muted-foreground">
                                  <span className="min-w-0 truncate">{sourceMeta(entry.source)}</span>
                                  <span className="ml-auto shrink-0 tabular-nums">{formatRelative(entry.at)}</span>
                                </span>
                                {entry.context ? (
                                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">
                                    {entry.context}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">没有记录到查词位置。</p>
                      )}

                      <div className="mt-2.5 flex items-center gap-1.5">
                        <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => onLookup(word)}>
                          <Icon name="refresh" size={12} />
                          重新查词
                        </button>
                        {word.review?.dueAt ? (
                          <span className="text-[10px] text-muted-foreground">
                            下次复习 {formatRelative(word.review.dueAt)}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost ml-auto px-2 py-1 text-[11px] text-destructive"
                          onClick={() => remove(word)}
                        >
                          <Icon name="trash" size={12} />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-background">
          <Empty
            icon={query ? "search" : "book"}
            title={query ? "没有匹配的词" : "词库还是空的"}
            hint={query ? "换个关键词试试，或者清空搜索。" : "在网页或 PDF 里划词翻译后，词条会自动收进这里。"}
          />
        </div>
      )}
    </div>
  );
}