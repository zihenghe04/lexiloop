(() => {
  function records(papers) {
    const used = new Set();
    return papers.map((paper, index) => {
      const base = String(paper.citationKey || `paper${index + 1}`).replace(/[^a-zA-Z0-9_:-]/g, '_') || `paper${index + 1}`;
      let key = base, suffix = 2;
      while (used.has(key)) key = `${base}_${suffix++}`;
      used.add(key);
      return { paper, key };
    });
  }
  function escape(value) {
    const symbols = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$' };
    return String(value).replace(/[\\{}%&#_$]/g, char => symbols[char]).replace(/[\r\n]+/g, ' ');
  }
  function bibtex(papers) {
    return records(papers).map(({ paper: p, key }) => {
      const type = ['article', 'book', 'inproceedings', 'phdthesis', 'mastersthesis', 'techreport', 'misc'].includes(p.entryType) ? p.entryType : 'misc';
      const fields = { title: p.title, author: (p.authors || []).map(name => `{${escape(name)}}`).join(' and '), year: p.year,
        [type === 'inproceedings' ? 'booktitle' : 'journal']: p.venue, doi: p.doi, url: p.landingUrl || p.sourceUrl, publisher: p.publisher };
      const lines = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([name, value]) => `  ${name} = {${name === 'author' ? value : escape(value)}}`);
      return `@${type}{${key},\n${lines.join(',\n')}\n}`;
    }).join('\n\n');
  }
  function csl(papers) {
    const types = { article: 'article-journal', book: 'book', inproceedings: 'paper-conference', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report' };
    return records(papers).map(({ paper: p, key }) => {
      const item = { id: key, type: types[p.entryType] || 'document', title: p.title || '' };
      // Keep literal names: imported metadata does not reliably distinguish family/given names.
      if (p.authors?.length) item.author = p.authors.map(name => ({ literal: name }));
      if (p.year) item.issued = { 'date-parts': [[Number(p.year)]] };
      for (const [name, value] of Object.entries({ DOI: p.doi, URL: p.landingUrl || p.sourceUrl, 'container-title': p.venue, publisher: p.publisher })) if (value) item[name] = value;
      return item;
    });
  }
  const api = { records, bibtex, csl };
  if (typeof module !== 'undefined') module.exports = api;
  globalThis.LexiLoopPaperExport = api;
})();
