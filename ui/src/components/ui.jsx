import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Icon from "./Icon.jsx";
import { speak } from "../lib/pronounce.js";

// 参考 beUI Tabs 的共享选中面与 roving tabindex；每个控件使用独立 layoutId。
export function Segmented({ value, onChange, options, label = "选项", className = "" }) {
  const uid = useId();
  const buttons = useRef([]);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const move = (event, index) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };
  return <div className={`seg ${className}`} role="tablist" aria-label={label}>
    {options.map((option, index) => <button key={option.value} ref={node => { buttons.current[index] = node; }} type="button" role="tab" aria-selected={value === option.value} tabIndex={selected === index ? 0 : -1} data-active={value === option.value} className="seg-item" onKeyDown={event => move(event, index)} onClick={() => onChange(option.value)}>
      {value === option.value ? <motion.span layoutId={`tabs-${uid}`} className="seg-indicator" transition={{ type: "spring", stiffness: 440, damping: 33, mass: 0.7 }} aria-hidden="true" /> : null}
      <span className="seg-label">{option.icon ? <Icon name={option.icon} size={14} /> : null}{option.label}{option.count > 0 ? <span className="seg-count">{option.count > 99 ? "99+" : option.count}</span> : null}</span>
    </button>)}
  </div>;
}

export function SpeakButton({ text, language, audio, label = "播放发音", className = "" }) {
  if (!String(text || "").trim()) return null;
  return <button type="button" className={`btn btn-ghost btn-icon shrink-0 ${className}`} title={label} aria-label={label} onClick={event => { event.stopPropagation(); speak({ text, language, audio }); }}><Icon name="play" size={13} /></button>;
}

export function Modal({ open, title, subtitle, onClose, children, footer, width = 420 }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const closeRef = useRef(onClose);
  const reduced = useReducedMotion();
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current?.(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex=\"-1\"])")].filter(node => !node.closest("[hidden], [inert]"));
      if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector("[autofocus], input, textarea, select, button")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      const target = restoreRef.current;
      requestAnimationFrame(() => { if (target?.isConnected) target.focus?.(); });
    };
  }, [open]);
  return <AnimatePresence>{open ? <motion.div className="modal-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
    <div className="modal-backdrop" aria-hidden="true" onClick={() => closeRef.current?.()} />
    <motion.div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="modal-panel" style={{ maxWidth: width }} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88, y: 16, clipPath: "inset(12% 12% round 32px)" }} animate={{ opacity: 1, scale: 1, y: 0, clipPath: "inset(0% 0% round 18px)" }} exit={{ opacity: 0, scale: reduced ? 1 : 0.95, y: reduced ? 0 : 8 }} transition={{ type: "spring", stiffness: 420, damping: 31, mass: 0.8 }}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="btn btn-ghost btn-icon" onClick={() => closeRef.current?.()} aria-label="关闭"><Icon name="close" size={14} /></button></div>
      <div className="modal-content">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </motion.div>
  </motion.div> : null}</AnimatePresence>;
}

export function Empty({ icon = "book", title, hint, action }) {
  return <div className="empty-state"><div className="empty-art" aria-hidden="true"><span /><span /><Icon name={icon} size={25} /></div><div><p className="text-ui font-medium text-foreground">{title}</p>{hint ? <p className="mt-1 max-w-[280px] text-ui-sm text-muted-foreground">{hint}</p> : null}</div>{action}</div>;
}
export function Spinner({ label = "加载中" }) {
  return <div className="flex items-center justify-center gap-2 py-8 text-ui-sm text-muted-foreground" role="status"><span className="composer__spinner" />{label}</div>;
}

function ToastItem({ item, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const actionUsed = useRef(false);
  const remaining = useRef(item.duration ?? (item.tone === "error" ? 6000 : 3500));
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (paused) return undefined;
    const start = Date.now();
    const timer = setTimeout(() => dismissRef.current?.(item.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - start)); };
  }, [item.id, paused]);
  return <motion.div layout className={`toast-item ${item.tone === "error" ? "toast-item--error" : ""}`} role={item.tone === "error" ? "alert" : "status"} initial={{ opacity: 0, y: 16, scale: .94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: .96 }} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <span className="toast-icon"><Icon name={item.tone === "error" ? "close" : "check"} size={13} /></span><span className="min-w-0 flex-1 break-words">{item.text}</span>
    {item.actionLabel ? <button type="button" className="toast-action" onClick={() => { if (actionUsed.current) return; actionUsed.current = true; item.onAction?.(); onDismiss?.(item.id); }}>{item.actionLabel}</button> : null}
    <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => onDismiss?.(item.id)}><Icon name="close" size={11} /></button>
  </motion.div>;
}
export function Toasts({ items, onDismiss }) {
  return <div className="toast-stack"><AnimatePresence initial={false}>{items.map(item => <ToastItem key={item.id} item={item} onDismiss={onDismiss} />)}</AnimatePresence></div>;
}
export function Meter({ value }) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized * 100)}><motion.div initial={false} animate={{ width: `${Math.round(normalized * 100)}%` }} transition={{ type: "spring", stiffness: 180, damping: 24 }} /></div>;
}
export function Field({ label, hint, children }) {
  return <label className="block">{label ? <span className="mb-1 block text-ui-sm font-medium text-ink-soft">{label}</span> : null}{children}{hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}</label>;
}
