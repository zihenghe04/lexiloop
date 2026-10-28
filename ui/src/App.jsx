import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import Icon from "./components/Icon.jsx";
import { Empty, Modal, Segmented, Toasts } from "./components/ui.jsx";
import { applyTheme, getLibrary, getSettings, isPreview, nextTheme, openPdfReaderBlank, openReader, readTheme, readUiSettings, readWords } from "./lib/bridge.js";
import { consumePanelIntent, subscribeExtension } from "./lib/extension-events.js";
import { dateValue, isDue, meaningSummary, searchable } from "./lib/format.js";
import { latestLookup, relatedWords } from "./lib/workspace.js";
import LookupPage from "./pages/LookupPage.jsx";
import WordsPage from "./pages/WordsPage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

const NAV = [
  { id: "lookup", label: "查词", icon: "search" },
  { id: "words", label: "词库", icon: "book" },
  { id: "review", label: "复习", icon: "review" },
  { id: "library", label: "文献", icon: "library" }
];
applyTheme(readTheme());
const START_TABS = ["lookup", "words", "review", "library", "settings"];
function startTab() {
  const value = new URLSearchParams(location.search).get("tab");
  return START_TABS.includes(value) ? value : "lookup";
}

export default function App() {
  const [tab, setTab] = useState(startTab);
  const [words, setWords] = useState([]);
  const [papers, setPapers] = useState([]);
  const [uiSettings, setUiSettings] = useState({ targetLanguage: "auto" });
  const [translation, setTranslation] = useState(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [theme, setTheme] = useState(readTheme);
  const [toasts, setToasts] = useState([]);
  const [lookupIntent, setLookupIntent] = useState(null);
  const [wordScope, setWordScope] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandInput = useRef(null);
  const toastId = useRef(0);
  const intentId = useRef(0);
  const lastIntent = useRef({ key: "", at: 0 });
  const previousTab = useRef("lookup");
  const reduced = useReducedMotion();
  const themeBusy = useRef(false);

  const showToast = useCallback((text, options = {}) => {
    const id = ++toastId.current;
    setToasts(list => [...list.slice(-2), { id, text, ...options }]);
  }, []);
  const dismissToast = useCallback(id => setToasts(list => list.filter(item => item.id !== id)), []);
  const refreshWords = useCallback(async () => { const next = await readWords(); setWords(next); return next; }, []);
  const refreshPapers = useCallback(async () => { const next = await getLibrary(); setPapers(next); return next; }, []);
  const refreshTranslation = useCallback(async () => {
    try { const next = await getSettings(); setTranslation(next); return next; }
    catch (error) { showToast(error.message, { tone: "error" }); return null; }
  }, [showToast]);

  const selectTab = useCallback(value => {
    if (!START_TABS.includes(value)) return;
    if (value === "settings") previousTab.current = tab === "settings" ? previousTab.current : tab;
    setTab(value);
  }, [tab]);
  const lookupWord = useCallback(word => {
    setLookupIntent({ id: ++intentId.current, text: word.original, trigger: "recent" });
    setTab("lookup");
  }, []);
  const receiveSelection = useCallback(payload => {
    if (!payload) return;
    const key = JSON.stringify([payload.text, payload.source, payload.context]);
    if (lastIntent.current.key === key && Date.now() - lastIntent.current.at < 1500) return;
    lastIntent.current = { key, at: Date.now() };
    if (payload.notice && !payload.text) showToast(payload.notice);
    else setLookupIntent({ ...payload, id: ++intentId.current });
    setTab("lookup");
    if (!isPreview()) chrome.storage.session.remove("lexiloopPending").catch(() => {});
  }, [showToast]);

  const initialize = useCallback(async () => {
    setInitError("");
    try {
      const [wordList, paperList, settings, ui] = await Promise.all([readWords(), getLibrary(), getSettings(), readUiSettings()]);
      setWords(wordList); setPapers(paperList); setTranslation(settings); setUiSettings(ui);
      setReady(true);
    } catch (error) { setInitError(error.message); }
  }, []);
  useEffect(() => { initialize(); }, [initialize]);
  useEffect(() => {
    if (isPreview()) return undefined;
    let alive = true;
    const stop = subscribeExtension(chrome, {
      onWords: setWords,
      onPapers: () => refreshPapers().catch(error => showToast(error.message, { tone: "error" })),
      onSettings: value => setUiSettings(current => ({ ...current, ...value })),
      onSelection: receiveSelection,
      onTab: value => setTab(value)
    });
    consumePanelIntent(chrome).then(intent => {
      if (!alive) return;
      if (intent.selection) receiveSelection(intent.selection);
      else if (intent.tab) setTab(intent.tab);
      if (intent.settings) setTab("settings");
    }).catch(error => showToast(error.message, { tone: "error" }));
    return () => { alive = false; stop(); };
  }, [receiveSelection, refreshPapers, showToast]);
  useEffect(() => {
    const onStorage = event => {
      if (event.key !== "lexiloopReaderTheme") return;
      const value = ["light", "sepia", "dark"].includes(event.newValue) ? event.newValue : "light";
      setTheme(applyTheme(value));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setCommandOpen(value => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const cycleTheme = async () => {
    if (themeBusy.current) return;
    const value = nextTheme(theme);
    const update = () => flushSync(() => { applyTheme(value); setTheme(value); });
    if (!document.startViewTransition || reduced) { update(); return; }
    themeBusy.current = true;
    const transition = document.startViewTransition(update);
    try {
      await transition.ready;
      const x = innerWidth / 2, y = innerHeight / 2;
      await document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${Math.hypot(x, y)}px at ${x}px ${y}px)`] }, { duration: 440, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" }).finished;
    } catch {} finally { themeBusy.current = false; }
  };

  const dueCount = useMemo(() => words.filter(isDue).length, [words]);
  const unreadCount = papers.filter(paper => paper.status === "unread").length;
  const recentWords = useMemo(() => [...words].sort((a, b) => dateValue(latestLookup(b)?.at || b.updatedAt) - dateValue(latestLookup(a)?.at || a.updatedAt)).slice(0, 8), [words]);
  const continuePaper = useMemo(() => [...papers].filter(paper => paper.status === "reading" || (paper.progress > 0 && paper.progress < 1)).sort((a, b) => dateValue(b.lastOpenedAt || b.updatedAt) - dateValue(a.lastOpenedAt || a.updatedAt))[0] || null, [papers]);
  const scopeWords = wordScope ? relatedWords(words, wordScope) : words;
  const commandItems = useMemo(() => {
    const needle = commandQuery.trim().toLocaleLowerCase();
    if (!needle) return NAV.map(item => ({ key: item.id, label: item.label, meta: "导航", icon: item.icon, run: () => selectTab(item.id) }));
    return [
      ...words.filter(word => searchable(word).includes(needle)).slice(0, 6).map(word => ({ key: word.id, label: word.original, meta: meaningSummary(word, 1), icon: "book", run: () => lookupWord(word) })),
      ...papers.filter(paper => `${paper.title} ${paper.authors || ""}`.toLocaleLowerCase().includes(needle)).slice(0, 5).map(paper => ({ key: paper.id, label: paper.title, meta: "打开文献", icon: "library", run: () => openReader(paper.id, { page: paper.currentPage }).catch(error => showToast(error.message, { tone: "error" })) }))
    ];
  }, [commandQuery, words, papers, selectTab, lookupWord, showToast]);
  useEffect(() => { setCommandIndex(0); }, [commandQuery]);
  const executeCommand = item => { if (!item) return; setCommandOpen(false); item.run(); };
  const frame = isPreview() ? Number(new URLSearchParams(location.search).get("frame")) || 0 : 0;
  const counts = { lookup: 0, words: words.length, review: dueCount, library: unreadCount };
  const themeLabel = { light: "浅色", sepia: "纸张", dark: "深色" }[theme];

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}>
      <div className="workspace-shell" style={frame ? { maxWidth: `${frame}px`, marginInline: "auto" } : undefined}>
        <header className="workspace-header">
          <span className="brand-mark" aria-hidden="true"><Icon name="book" size={16} /></span>
          <div className="brand-title">LexiLoop<span>READ. LEARN. REMEMBER.</span></div>
          <div className="ml-auto flex items-center gap-0.5">
            <button className="btn btn-ghost btn-icon" onClick={cycleTheme} title={`主题：${themeLabel}`} aria-label={`切换主题（当前${themeLabel}）`}><Icon name="sun" size={15} /></button>
            <button className={`btn btn-icon ${tab === "settings" ? "btn-secondary" : "btn-ghost"}`} onClick={() => tab === "settings" ? setTab(previousTab.current) : selectTab("settings")} aria-label="设置"><Icon name="settings" size={15} /></button>
          </div>
        </header>
        <div className="workspace-nav"><Segmented value={tab === "settings" ? "" : tab} onChange={selectTab} label="主导航" options={NAV.map(item => ({ value: item.id, label: item.label, icon: item.icon, count: counts[item.id] }))} className="main-tabs w-full" /></div>
        <button className="workspace-search" onClick={() => { setCommandQuery(""); setCommandOpen(true); }}><Icon name="search" size={13} /><span>搜索词条、文献，快速前往…</span><kbd>⌘ K</kbd></button>
        <main className="workspace-main">
          {!ready ? initError ? <Empty icon="refresh" title="暂时无法加载数据" hint={initError} action={<button className="btn" onClick={initialize}>重试</button>} /> : <div className="page-skeleton" role="status" aria-label="正在加载学习数据"><div /><div /><div /><div /></div> : <>
            {NAV.map(item => <section key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-label={item.label} hidden={tab !== item.id} inert={tab !== item.id ? "" : undefined} className="workspace-panel">
              {item.id === "lookup" ? <LookupPage active={tab === "lookup"} intent={lookupIntent} recent={recentWords} targetLanguage={uiSettings.targetLanguage} onWordsChanged={refreshWords} onOpenWords={() => setTab("words")} showToast={showToast} /> : null}
              {item.id === "words" ? <WordsPage active={tab === "words"} words={scopeWords} scope={wordScope} onClearScope={() => setWordScope(null)} onRefresh={refreshWords} onLookup={lookupWord} showToast={showToast} /> : null}
              {item.id === "review" ? <ReviewPage active={tab === "review"} words={words} onRefresh={refreshWords} onPractice={() => setTab("words")} showToast={showToast} /> : null}
              {item.id === "library" ? <LibraryPage active={tab === "library"} papers={papers} words={words} onRefresh={refreshPapers} showToast={showToast} continuePaper={continuePaper} onRelatedWords={paper => { setWordScope(paper); setTab("words"); }} /> : null}
            </section>)}
            {tab === "settings" ? <SettingsPage translation={translation} uiSettings={uiSettings} words={words} papers={papers} onClose={() => setTab(previousTab.current)} onRefreshTranslation={refreshTranslation} onUiSettings={setUiSettings} showToast={showToast} /> : null}
          </>}
        </main>
        <footer className="workspace-footer"><span className="status-dot" /><span>{isPreview() ? "演示数据 · 不影响真实词库" : "数据保存在此浏览器"}</span><button onClick={() => openPdfReaderBlank().catch(error => showToast(error.message, { tone: "error" }))}>打开阅读器<Icon name="external" size={10} /></button></footer>
        <Toasts items={toasts} onDismiss={dismissToast} />
        <Modal open={commandOpen} title="快速前往" subtitle="搜索你的词库与文献库" onClose={() => setCommandOpen(false)}>
          <input ref={commandInput} className="field command-input" role="combobox" aria-label="搜索词条和文献" aria-expanded="true" aria-controls="command-results" aria-activedescendant={commandItems[commandIndex] ? `command-${commandIndex}` : undefined} value={commandQuery} placeholder="输入单词、标题或作者…" onChange={event => setCommandQuery(event.target.value)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setCommandIndex(index => Math.max(0, Math.min(commandItems.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); } if (event.key === "Enter") { event.preventDefault(); executeCommand(commandItems[commandIndex]); } }} />
          <div className="command-results" role="listbox" id="command-results" aria-label="搜索结果">{commandItems.map((item, index) => <button key={item.key} id={`command-${index}`} role="option" aria-selected={commandIndex === index} onMouseMove={() => setCommandIndex(index)} onClick={() => executeCommand(item)} className="command-result"><Icon name={item.icon} size={16} /><span><strong>{item.label}</strong><small>{item.meta}</small></span><Icon name="chevron" size={12} /></button>)}{!commandItems.length ? <p className="py-6 text-center text-ui-sm text-muted-foreground">没有找到匹配结果</p> : null}</div>
          <p className="mt-3 text-[10px] text-muted-foreground">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>
        </Modal>
      </div>
    </MotionConfig>
  );
}
