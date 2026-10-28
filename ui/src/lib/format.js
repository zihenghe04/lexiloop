export function dateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function formatRelative(value) {
  const time = dateValue(value);
  if (!time) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function percent(value) {
  const number = Math.max(0, Math.min(1, Number(value) || 0));
  return `${Math.round(number * 100)}%`;
}

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function paperStatusLabel(status) {
  return { unread: "未读", reading: "在读", read: "已读" }[status] || "未读";
}

export function isDue(word) {
  const due = dateValue(word?.review?.dueAt);
  return !due || due <= Date.now();
}

export function trimSlashes(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

// 有道返回 phonetics = { uk, us, generic }，字段本身不含斜杠
export function formatPhonetics(phonetics) {
  const values = [];
  if (phonetics?.uk) values.push(`英 /${trimSlashes(phonetics.uk)}/`);
  if (phonetics?.us) values.push(`美 /${trimSlashes(phonetics.us)}/`);
  if (!values.length && phonetics?.generic) values.push(`/${trimSlashes(phonetics.generic)}/`);
  return values.join("  ");
}

// 词条列表里的一行释义摘要：优先词典义项，没有再退回译文
export function meaningSummary(word, maxGroups = 2) {
  const groups = (word?.meanings || [])
    .map((group) => (group.definitions || []).filter(Boolean).join("；"))
    .filter(Boolean);
  if (groups.length) return groups.slice(0, maxGroups).join("；");
  return String(word?.translated || "");
}

export function searchable(word) {
  const meanings = (word.meanings || [])
    .flatMap((group) => [group.partOfSpeech, ...(group.definitions || [])])
    .join(" ");
  const sources = (word.lookups || [])
    .flatMap((lookup) => [lookup.source?.title, lookup.source?.url, lookup.context])
    .join(" ");
  return `${word.original} ${word.translated} ${meanings} ${sources}`.toLocaleLowerCase();
}