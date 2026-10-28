(() => {
  for (const [id, format] of [['exportBibtex', 'bibtex'], ['exportCsl', 'csl']]) {
    const button = document.getElementById(id);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const data = await chrome.storage.local.get('lexiloopPdfLibrary');
        const papers = LexiLoopPdfLibrary.normalizeLibrary(data.lexiloopPdfLibrary);
        if (!papers.length) { alert('文献库为空，请先添加文献。'); return; }
        const text = format === 'bibtex' ? LexiLoopPaperExport.bibtex(papers) : JSON.stringify(LexiLoopPaperExport.csl(papers), null, 2);
        const url = URL.createObjectURL(new Blob([text], { type: format === 'bibtex' ? 'application/x-bibtex' : 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `lexiloop-library.${format === 'bibtex' ? 'bib' : 'json'}`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { alert(`导出失败：${error.message}`); }
      finally { button.disabled = false; }
    });
  }
})();
