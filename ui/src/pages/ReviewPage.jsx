import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon from "../components/Icon.jsx";
import { Empty, Meter, SpeakButton } from "../components/ui.jsx";
import { mutateWord, openWordSource } from "../lib/bridge.js";
import { formatPhonetics } from "../lib/format.js";
import { latestLookup, reviewQueue, sourceKind } from "../lib/workspace.js";

const GRADES = [
  { grade: "again", key: "1", label: "忘记", hint: "稍后再复习" },
  { grade: "hard", key: "2", label: "模糊", hint: "缩短复习间隔" },
  { grade: "good", key: "3", label: "记得", hint: "正常推进间隔" }
];

export default function ReviewPage({ active = true, words, onRefresh, onPractice, showToast }) {
  const [completed, setCompleted] = useState(() => new Set());
  const queue = useMemo(() => reviewQueue(words, completed), [words, completed]);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const current = queue[0] || null;
  const done = completed.size;
  const lookup = latestLookup(current);

  useEffect(() => { setRevealed(false); }, [current?.id]);

  const rate = useCallback(async (grade) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await mutateWord({ action: "review", id: current.id, grade, expectedDueAt: current.review?.dueAt });
      // 后台会把已评分词移出到期队列，再递增游标会跳过下一条。
      // 用已完成 id 去重，同时允许 storage.onChanged 更新到期队列。
      setCompleted((ids) => new Set([...ids, current.id]));
      setRevealed(false);
      await onRefresh();
      // 评分后让新卡片立刻挂载，不等待退出动画；否则队列已更新但旧卡仍占据 DOM，
      // 键盘/自动化和用户都会误以为没有切换。
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } catch (error) {
      showToast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [current, onRefresh, showToast]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) return;
      if (event.target?.closest?.("input, textarea, select, button, [contenteditable=true]")) return;
      if (!current) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        return;
      }
      if (!revealed) return;
      const found = GRADES.find((item) => item.key === event.key);
      if (found) { event.preventDefault(); rate(found.grade); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, current, revealed, rate]);

  if (!current) {
    return (
      <div className="page-content">
        <div className="review-complete">
          <Empty icon="check" title={done > 0 ? `完成 ${done} 个词条` : "今天没有待复习的词"} hint={done > 0 ? "复习记录已保存。回到阅读，让词汇在上下文里生长。" : "在网页或 PDF 里查过的词，会按记忆曲线安排复习。"} action={<button type="button" className="btn btn-primary" onClick={onPractice}>回到词库<Icon name="chevron" size={13} /></button>} />
        </div>
      </div>
    );
  }

  const meanings = (current.meanings || []).map((group) => `${group.partOfSpeech ? `${group.partOfSpeech} ` : ""}${(group.definitions || []).join("；")}`).filter(Boolean);
  return (
    <div className="page-content review-page">
      <div className="page-heading"><div><span className="eyebrow">SPACED REPETITION</span><h1>温故，知新。</h1></div><span className="count-badge">还剩 {queue.length}</span></div>
      <div className="mb-4"><div className="mb-2 flex justify-between text-[11px] text-muted-foreground"><span>本轮进度</span><span className="tabular-nums">{done} / {done + queue.length}</span></div><Meter value={done / (done + queue.length)} /></div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={current.id} className="review-flashcard" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.14 }}>
          <span className="eyebrow mb-6">想一想，这个词是什么意思？</span>
          <h2 className="word-display">{current.original}</h2>
          {formatPhonetics(current.phonetics) ? <p className="mt-2 text-ui-sm text-muted-foreground">{formatPhonetics(current.phonetics)}</p> : null}
          <SpeakButton text={current.original} audio={current.audio} language={current.detectedLanguage} className="mt-2" />
          {lookup?.context ? <blockquote className="review-context">{lookup.context}</blockquote> : null}
          <div className="review-answer" data-revealed={revealed}>
            {revealed ? <div className="animate-rise">{meanings.length ? meanings.map((line) => <p key={line} className="mt-1 text-ui leading-relaxed text-foreground">{line}</p>) : <p>{current.translated || "（没有释义）"}</p>}
              {sourceKind(lookup?.source) !== "none" ? <button type="button" className="mt-3 inline-flex items-center gap-1 text-[11px] text-primary" onClick={() => openWordSource(current, lookup.source).catch(error => showToast(error.message, { tone: "error" }))}><Icon name="external" size={11} />回到原文上下文</button> : null}
            </div> : <span className="text-[11px] text-muted-foreground">先回想，再揭晓。</span>}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="mt-4">
        {revealed ? <div className="grid grid-cols-3 gap-2 animate-fade">{GRADES.map(item => <button key={item.grade} type="button" disabled={busy} onClick={() => rate(item.grade)} className={`review-grade ${item.grade === "good" ? "review-grade--good" : ""}`} title={item.hint}><span>{item.label}</span><kbd>{item.key}</kbd></button>)}</div> : <button type="button" className="btn btn-primary h-10 w-full" onClick={() => setRevealed(true)}>显示答案<kbd className="ml-auto">Space</kbd></button>}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">空格揭晓 · 1 忘记 · 2 模糊 · 3 记得</p>
    </div>
  );
}
