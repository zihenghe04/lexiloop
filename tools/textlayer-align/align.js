// Per-character alignment error of the text layer against PyMuPDF ground truth.
// args: {pdf:"1512.03385", pages:[1,2]}
const truth = await (await fetch(`http://127.0.0.1:8765/chars-${args.pdf}.json`)).json();
const result = {};
for (const pageNum of args.pages) {
  const view = document.querySelector(`.pdf-page.original-page[data-page-number="${pageNum}"]`);
  const gt = truth[pageNum];
  if (!view || !gt) continue;
  view.scrollIntoView({ block: "center" });
  for (let i = 0; i < 60 && !view.querySelector(".textLayer span"); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  const pr = view.getBoundingClientRect();
  const k = pr.width / gt.w; // css px per pt
  // bucket truth chars by char
  const byChar = new Map();
  gt.chars.forEach(([c, x, y, w]) => { if (!byChar.has(c)) byChar.set(c, []); byChar.get(c).push({ x, y, w }); });
  const errs = [];
  const perSpan = [];
  const range = document.createRange();
  for (const span of view.querySelectorAll(".textLayer span:not(.markedContent)")) {
    const node = span.firstChild;
    if (!node || node.nodeType !== 3 || node.textContent.trim().length < 4) continue;
    const t = node.textContent;
    let spanMax = 0;
    for (let i = 0; i < t.length; i++) {
      if (!t[i].trim()) continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const cx = (r.left + r.width / 2 - pr.left) / k, cy = (r.top + r.height / 2 - pr.top) / k;
      const cands = byChar.get(t[i]);
      if (!cands) continue;
      let best = null, bd = Infinity;
      for (const c of cands) {
        if (Math.abs(c.y - cy) > 6) continue;
        const d = Math.abs(c.x - cx);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best || bd > 40) continue;
      const px = bd * k;
      errs.push(px); spanMax = Math.max(spanMax, px);
    }
    perSpan.push({ t: t.slice(0, 40), max: +spanMax.toFixed(2), font: span.style.fontFamily });
  }
  errs.sort((a, b) => a - b);
  const q = (p) => +(errs[Math.floor(errs.length * p)] || 0).toFixed(2);
  perSpan.sort((a, b) => b.max - a.max);
  result[pageNum] = { chars: errs.length, cssPerPt: +k.toFixed(3), med: q(.5), p90: q(.9), p99: q(.99), max: q(.999), over3px: errs.filter((e) => e > 3).length, worst: perSpan.slice(0, args.worst ?? 3) };
}
return result;
