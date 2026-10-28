import { dateValue, isDue, searchable } from "./format.js";

export function filterPapers(papers, { query = "", filter = "all", sort = "recent" } = {}) {
  const needle = String(query).trim().toLocaleLowerCase();
  const result = (Array.isArray(papers) ? papers : []).filter((paper) => {
    if (filter === "favorite" && !paper.favorite) return false;
    if (["unread", "reading", "read"].includes(filter) && paper.status !== filter) return false;
    if (!needle) return true;
    return [paper.title, paper.authors, paper.year, ...(paper.tags || []), paper.sourceUrl]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  });
  return result.sort((a, b) => {
    if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh");
    if (sort === "progress") return Number(b.progress || 0) - Number(a.progress || 0) || dateValue(b.updatedAt) - dateValue(a.updatedAt);
    return dateValue(b.lastOpenedAt || b.updatedAt) - dateValue(a.lastOpenedAt || a.updatedAt);
  });
}

export function latestLookup(word) {
  const lookups = Array.isArray(word?.lookups) ? word.lookups : [];
  return lookups.reduce((latest, item) => dateValue(item?.at) > dateValue(latest?.at) ? item : latest, null);
}

function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch { return ""; }
}

export function relatedWords(words, paper) {
  if (!paper) return [];
  const paperUrl = cleanUrl(paper.sourceUrl || paper.url);
  return (Array.isArray(words) ? words : []).filter((word) => (word.lookups || []).some(({ source }) => {
    if (!source) return false;
    if (source.paperId && source.paperId === paper.id) return true;
    const lookupUrl = cleanUrl(source.url);
    return Boolean(paperUrl && lookupUrl && paperUrl === lookupUrl);
  }));
}

export function sourceKind(source) {
  if (source?.kind === "pdf" || source?.documentKey || source?.paperId) return "pdf";
  const url = cleanUrl(source?.url);
  if (url && /\.pdf(?:$|[?#])/i.test(url)) return "pdf";
  if (url) return "web";
  return "none";
}

export function reviewQueue(words, completed = new Set()) {
  return (Array.isArray(words) ? words : []).filter((word) => !completed.has(word.id) && isDue(word)).sort((a, b) => dateValue(a.review?.dueAt) - dateValue(b.review?.dueAt));
}

export function lookupSearchable(word) { return searchable(word); }
