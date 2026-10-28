import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { Empty, Field, Modal, Meter, Segmented } from "../components/ui.jsx";
import { importLocalPdf, openReader, patchPaper, removePaper } from "../lib/bridge.js";
import { formatRelative, hostOf, paperStatusLabel, percent } from "../lib/format.js";
import { filterPapers, relatedWords } from "../lib/workspace.js";

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "read", label: "已读" },
  { value: "favorite", label: "收藏" }
];

function dotClass(paper) {
  if (paper.status === "reading") return "bg-primary";
  if (paper.status === "read") return "bg-foreground/40";
  return "bg-foreground/22";
}

export default function LibraryPage({ papers = [], words = [], onRefresh, showToast, continuePaper, onRelatedWords }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [menuId, setMenuId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = event => { if (!event.target.closest?.("[data-paper-menu]")) setMenuId(null); };
    const onKey = event => { if (event.key === "Escape") setMenuId(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [menuId]);

  const counts = useMemo(() => ({
    all: papers.length,
    unread: papers.filter(paper => paper.status === "unread").length,
    reading: papers.filter(paper => paper.status === "reading").length,
    read: papers.filter(paper => paper.status === "read").length,
    favorite: papers.filter(paper => paper.favorite).length
  }), [papers]);
  const list = useMemo(() => filterPapers(papers, { query, filter, sort }), [papers, query, filter, sort]);

  const open = async paper => {
    try { await openReader(paper.id, { page: paper.currentPage }); }
    catch (error) { showToast(error.message, { tone: "error" }); }
  };
  const handleFiles = async files => {
    const pdf = [...(files || [])].find(file => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    if (!pdf) { showToast("只能导入 PDF 文件", { tone: "error" }); return; }
    if (importing) return;
    setImporting(true);
    try {
      const paper = await importLocalPdf(pdf);
      await onRefresh();
      showToast(`已加入文献库：${paper.title}`);
      if (paper?.id) await openReader(paper.id);
    } catch (error) { showToast(error.message, { tone: "error" }); }
    finally { setImporting(false); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    try {
      await patchPaper(editing.id, { title: editing.title.trim() || "未命名文献", authors: editing.authors.trim(), year: editing.year ? Number(editing.year) : undefined, tags: editing.tags.split(",").map(tag => tag.trim()).filter(Boolean) });
      await onRefresh(); setEditing(null); showToast("文献信息已更新");
    } catch (error) { showToast(error.message, { tone: "error" }); }
  };
  const confirmRemove = async () => {
    if (!deleting) return;
    try { await removePaper(deleting.id); await onRefresh(); setDeleting(null); showToast(`已删除「${deleting.title}」`); }
    catch (error) { showToast(error.message, { tone: "error" }); }
  };
  const toggleFavorite = async paper => {
    try { await patchPaper(paper.id, { favorite: !paper.favorite }); await onRefresh(); }
    catch (error) { showToast(error.message, { tone: "error" }); }
  };
  const current = continuePaper;
  const currentProgress = Math.max(0, Math.min(100, Math.round(Number(current?.progress || 0) * 100)));
  const relatedCount = paper => relatedWords(words, paper).length;

  return <div className="page-content library-page" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer?.files); }}>
    <div className="page-heading"><div><span className="eyebrow">YOUR READING SHELF</span><h1>文献，慢慢读。</h1></div><button type="button" className="btn btn-primary rounded-full px-3" disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="plus" size={13} />{importing ? "导入中" : "导入 PDF"}</button><input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => { const files = event.target.files; event.target.value = ""; handleFiles(files); }} /></div>
    <div className="library-toolbar"><div className="library-search"><Icon name="search" size={14} /><input type="search" role="searchbox" aria-label="搜索文献" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、作者或标签…" />{query ? <button aria-label="清除文献搜索" onClick={() => setQuery("")}><Icon name="close" size={12} /></button> : null}</div><select className="field library-sort" aria-label="文献排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近打开</option><option value="title">标题</option><option value="progress">阅读进度</option></select></div>
    <div className="mt-2.5 overflow-x-auto"><Segmented value={filter} onChange={setFilter} label="文献筛选" options={FILTERS.map(item => ({ ...item, count: counts[item.value] }))} /></div>
    {current ? <button type="button" onClick={() => open(current)} className="continue-card mt-3 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left"><span className="continue-card__cover"><Icon name="library" size={14} /></span><span className="min-w-0 flex-1"><span className="continue-card__eyebrow">继续阅读</span><span className="block line-clamp-1 text-ui font-medium text-foreground">{current.title}</span><span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="shrink-0 tabular-nums">第 {current.currentPage || 1} / {current.pageCount || "?"} 页</span><span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, currentProgress)}%` }} /></span><span className="shrink-0 tabular-nums">{currentProgress}%</span></span></span><Icon name="chevron" size={13} className="shrink-0 text-muted-foreground" /></button> : null}
    {list.length ? <ul className="library-list mt-3">{list.map(paper => { const count = relatedCount(paper); return <li key={paper.id} className="library-row group"><button type="button" className="library-row__main" onClick={() => open(paper)}><span className={`library-status ${dotClass(paper)}`} /><span className="min-w-0 flex-1"><span className="block line-clamp-2 pr-16 text-ui font-medium leading-snug text-foreground">{paper.title}</span><span className="mt-1 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">{paper.favorite ? <Icon name="star" size={9} filled className="shrink-0 text-[#c99a2e]" /> : null}<span className="shrink-0">{paperStatusLabel(paper.status)}</span>{paper.authors ? <span className="min-w-0 truncate">· {paper.authors}</span> : null}{paper.year ? <span className="shrink-0">· {paper.year}</span> : null}{hostOf(paper.sourceUrl) ? <span className="shrink-0">· {hostOf(paper.sourceUrl)}</span> : null}</span>{paper.progress > 0 && paper.progress < 1 ? <span className="mt-1.5 block pr-16"><Meter value={paper.progress} /></span> : null}</span><span className="library-row__progress">{paper.progress > 0 ? percent(paper.progress) : ""}</span></button><div className="library-row__actions" data-paper-menu><button type="button" className={`btn btn-ghost btn-icon h-7 w-7 ${paper.favorite ? "text-[#c99a2e]" : ""}`} onClick={() => toggleFavorite(paper)} title={paper.favorite ? "取消收藏" : "收藏"} aria-label={paper.favorite ? `取消收藏：${paper.title}` : `收藏：${paper.title}`}><Icon name="star" size={12} filled={Boolean(paper.favorite)} /></button><button type="button" className="btn btn-ghost btn-icon h-7 w-7" onClick={() => setMenuId(menuId === paper.id ? null : paper.id)} aria-label={`更多操作：${paper.title}`} aria-expanded={menuId === paper.id}><Icon name="more" size={13} /></button>{menuId === paper.id ? <div className="menu library-menu" role="menu"><button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuId(null); open(paper); }}>打开阅读</button>{count ? <button type="button" role="menuitem" className="menu-item" aria-label={`查看 ${count} 个关联生词`} onClick={() => { setMenuId(null); onRelatedWords?.(paper); }}>查看 {count} 个关联生词</button> : null}<button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuId(null); setEditing({ ...paper, tags: (paper.tags || []).join(", ") }); }}>编辑信息</button><div className="menu-sep" /><button type="button" role="menuitem" className="menu-item text-destructive" onClick={() => { setMenuId(null); setDeleting(paper); }}>删除文献</button></div> : null}</div></li>; })}</ul> : <div className="empty-frame mt-3"><Empty icon="library" title={filter === "all" && !query ? "文献库还是空的" : "没有匹配的文献"} hint={query ? "换个标题、作者或标签试试。" : "把 PDF 拖进侧边栏，或者在网页里保存一篇文献。"} /></div>}
    <p className="mt-3 flex items-center gap-1 px-1 text-[11px] text-muted-foreground"><Icon name="clock" size={11} />最近打开：{papers.length ? formatRelative(papers.map(paper => paper.lastOpenedAt).filter(Boolean).sort().at(-1)) : "—"}</p>
    {dragging ? <div className="drop-overlay"><Icon name="paperclip" size={24} /><strong>松开以导入 PDF</strong><span>文件会保存到本地文献库</span></div> : null}
    <Modal open={Boolean(editing)} title="编辑文献" subtitle="让你的阅读线索保持清晰" onClose={() => setEditing(null)} footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>取消</button><button type="button" className="btn btn-primary" aria-label="保存修改" onClick={saveEdit}>保存修改</button></>}>
      {editing ? <div className="space-y-3"><Field label="标题"><input className="field" aria-label="标题" value={editing.title || ""} onChange={event => setEditing(current => ({ ...current, title: event.target.value }))} /></Field><Field label="作者"><input className="field" aria-label="作者" value={editing.authors || ""} onChange={event => setEditing(current => ({ ...current, authors: event.target.value }))} /></Field><div className="grid grid-cols-2 gap-2"><Field label="年份"><input className="field" aria-label="年份" inputMode="numeric" value={editing.year || ""} onChange={event => setEditing(current => ({ ...current, year: event.target.value }))} /></Field><Field label="标签"><input className="field" aria-label="标签" value={editing.tags || ""} onChange={event => setEditing(current => ({ ...current, tags: event.target.value }))} /></Field></div></div> : null}
    </Modal>
    <Modal open={Boolean(deleting)} title="删除文献" subtitle="这不会删除本地 PDF 原件" onClose={() => setDeleting(null)} footer={<><button type="button" className="btn" onClick={() => setDeleting(null)}>取消</button><button type="button" className="btn btn-danger" aria-label="确认删除" onClick={confirmRemove}>确认删除</button></>}><p className="text-ui leading-relaxed text-foreground">确定要从文献库移除「{deleting?.title}」吗？你仍可以重新导入原 PDF。</p></Modal>
  </div>;
}
