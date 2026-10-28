import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "../components/Icon.jsx";
import { Empty, SpeakButton } from "../components/ui.jsx";
import { openWordSource, translate } from "../lib/bridge.js";
import { formatPhonetics, formatRelative } from "../lib/format.js";
import { latestLookup, sourceKind } from "../lib/workspace.js";

const LANGUAGE_LABEL = { auto: "自动 · 英 ⇄ 中", "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", pt: "葡萄牙语", it: "意大利语", ar: "阿拉伯语" };

export default function LookupPage({ active = true, intent, recent = [], targetLanguage = "auto", onWordsChanged, onOpenWords, showToast }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState(null);
  const inputRef = useRef(null);
  const generation = useRef(0);
  const consumed = useRef(null);
  const lastRequest = useRef(null);

  const run = useCallback(async (value, options = {}) => {
    const query = String(value || "").trim();
    if (!query) { inputRef.current?.focus(); return; }
    const ticket = ++generation.current;
    lastRequest.current = { query, options };
    setPending(true); setError(""); setResult(null);
    try {
      const translated = await translate(query, { target: targetLanguage, trigger: options.trigger || "manual", source: options.source, context: options.context || "" });
      if (ticket !== generation.current) return;
      setResult({ ...translated, original: translated.original || query, source: options.source, context: options.context });
      // 预览与部分调用方只提供同步刷新回调；不要直接访问 undefined.catch。
      Promise.resolve(onWordsChanged?.()).catch(() => {});
    } catch (failure) {
      if (ticket === generation.current) setError(failure.message);
    } finally { if (ticket === generation.current) setPending(false); }
  }, [targetLanguage, onWordsChanged]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!intent || consumed.current === intent.id) return;
    consumed.current = intent.id;
    setText(intent.text || ""); setSelection(intent.source ? intent : null);
    if (intent.text) run(intent.text, intent);
  }, [intent, run]);
  useEffect(() => {
    if (!active) return undefined;
    const onKey = event => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.target?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      event.preventDefault(); inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  const phonetics = formatPhonetics(result?.phonetics);
  const meanings = (result?.meanings || []).filter(group => group.definitions?.length);
  const clear = () => { generation.current++; setText(""); setResult(null); setSelection(null); setPending(false); setError(""); inputRef.current?.focus(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.translated || meanings.map(group => `${group.partOfSpeech || ""} ${group.definitions.join("；")}`).join("\n")); showToast("已复制译文"); }
    catch { showToast("复制失败，请检查剪贴板权限", { tone: "error" }); }
  };
  return <div className="page-content lookup-page">
    <div className="page-heading lookup-heading"><div><span className="eyebrow">YOUR READING COMPANION</span><h1>读懂，也记住。</h1></div><span className="orbit-mark" aria-hidden="true"><Icon name="text" size={18} /></span></div>
    <section className={`composer ${pending ? "is-loading" : ""}`} aria-label="查词">
      <textarea ref={inputRef} rows={2} value={text} onChange={event => { setText(event.target.value); setSelection(null); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); run(text, selection || {}); } }} placeholder="一个生词，一句话，一个新发现…" className="composer__input" aria-label="查词" />
      <div className="composer__tools"><button type="button" className="composer__plus" onClick={clear} disabled={!text && !pending} title="清空" aria-label="清空输入"><Icon name="close" size={11} /></button><span className="chip" title="在设置中更改目标语言">{LANGUAGE_LABEL[targetLanguage] || targetLanguage}</span><kbd className="ml-auto">↵</kbd><button type="button" className="composer__send" disabled={pending || !text.trim()} onClick={() => run(text, selection || {})} title={pending ? "翻译中" : "翻译"} aria-label="翻译">{pending ? <span className="composer__spinner" /> : <Icon name="send" size={15} strokeWidth={2.4} />}</button></div>
    </section>
    {selection?.source?.title ? <div className="selection-source"><Icon name="library" size={12} /><span>{selection.source.title}</span>{selection.source.page ? <small>第 {selection.source.page} 页</small> : null}</div> : null}
    <AnimatePresence mode="wait" initial={false}>
      {pending ? <motion.div key="loading" className="lookup-loading" role="status" aria-label="正在翻译" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="loading-orb" /><span>正在理解这段文字…</span><div className="skeleton-line" /><div className="skeleton-line short" /></motion.div> : error ? <motion.div key="error" className="inline-error" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><strong>这次没有译出来</strong><p>{error}</p><button className="btn btn-xs" onClick={() => run(lastRequest.current.query, lastRequest.current.options)}><Icon name="refresh" size={12} />重试</button></motion.div> : result ? <motion.article key="result" className="lookup-result" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
        <div className="result-body"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="result-word">{result.original}</h2>{phonetics ? <p className="mt-1.5 text-ui-sm text-muted-foreground">{phonetics}</p> : null}</div><SpeakButton text={result.original} language={result.detectedLanguage} audio={result.audio} /></div>
          {meanings.length ? <ul className="result-meanings">{meanings.map((group, index) => <motion.li key={index} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .045 }}><span>{group.partOfSpeech || "释义"}</span><p>{group.definitions.join("；")}</p></motion.li>)}</ul> : <p className="mt-3 whitespace-pre-wrap text-ui leading-relaxed">{result.translated}</p>}
          {result.context ? <blockquote className="lookup-context">{result.context}</blockquote> : null}
          {sourceKind(result.source) !== "none" ? <button className="source-link" onClick={() => openWordSource(result, result.source).catch(failure => showToast(failure.message, { tone: "error" }))}><Icon name="external" size={12} />回到原文上下文</button> : null}
        </div>
        <div className="result-footer"><span className="result-engine">{result.service || "已翻译"}</span>{result.recorded === false || !result.entryId && !result.recorded ? <span>整句翻译不记入词库</span> : <button onClick={onOpenWords}><Icon name="check" size={11} />已收录 · {Number(result.translationCount || 1)} 次</button>}<button className="ml-auto" onClick={copy} aria-label="复制译文"><Icon name="copy" size={12} /></button></div>
      </motion.article> : null}
    </AnimatePresence>
    {recent.length ? <section className="recent-section"><div className="section-heading"><h2>最近遇见</h2><button onClick={onOpenWords}>全部词条<Icon name="chevron" size={11} /></button></div><ul className="recent-list">{recent.map((word, index) => <motion.li key={word.id || word.original} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * .025 }}><button onClick={() => { setText(word.original); setSelection(null); run(word.original, { trigger: "recent" }); }}><span className="recent-initial" aria-hidden="true">{word.original?.slice(0, 1)}</span><span className="min-w-0 flex-1"><strong>{word.original}</strong><small>{word.translated}</small></span><time>{formatRelative(latestLookup(word)?.at || word.updatedAt)}</time><Icon name="chevron" size={12} /></button></motion.li>)}</ul></section> : !pending && !result ? <Empty icon="search" title="让每一次查词，都留下来" hint="在网页或 PDF 中选中文字，词义、音标与原文位置会一起收进词库。" /> : null}
  </div>;
}
