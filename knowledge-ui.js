(() => {
  const dialog = document.createElement('dialog');
  dialog.className = 'knowledge-dialog';
  dialog.innerHTML = '<header><strong>论文知识页</strong><button type="button" data-close>关闭</button></header><p>AI 整理稿依据检索到的片段生成，需核对原文；重新生成不会覆盖个人笔记。</p><div class="knowledge-actions"><button type="button" data-generate>生成 / 更新整理稿</button><button type="button" data-clear>删除整理稿</button><button type="button" data-export>导出 Markdown</button></div><div data-status role="status"></div><section class="pdf-ai-message-content" data-draft></section><nav data-pages aria-label="知识页引用页码"></nav><label>个人知识笔记（可编辑）<textarea rows="8" data-edit></textarea></label><button type="button" data-save>保存个人笔记</button><section data-notes></section>';
  document.body.appendChild(dialog);
  let key = '', entry = {}, dirty = false;
  const q = selector => dialog.querySelector(selector);
  async function mutate(action, value, target = key) {
    const result = await chrome.runtime.sendMessage({ type: 'KNOWLEDGE_PATCH', key: target, action, value });
    if (!result?.ok) throw new Error(result?.error || '知识页保存失败');
    if (target === key) { entry = result.entry; render(); }
  }
  function render() {
    LexiLoopPdfAiRenderer.renderInto(q('[data-draft]'), entry.generated || '尚未生成整理稿。');
    if (!dirty) q('[data-edit]').value = entry.edited || '';
    const pages = [...new Set([...String(entry.generated || '').matchAll(/\[p\.\s*(\d+)\]/g)].map(match => Number(match[1])))];
    q('[data-pages]').replaceChildren(...pages.filter(page => page > 0 && page <= (pdfDocument?.numPages || 0)).map(page => {
      const button = document.createElement('button'); button.textContent = '原文 p.' + page;
      button.onclick = () => { close(); if (!dialog.open) scrollToPage(page); }; return button;
    }));
    q('[data-notes]').replaceChildren(...(entry.notes || []).map(note => {
      const article = document.createElement('article'), body = document.createElement('div'), remove = document.createElement('button');
      body.className = 'pdf-ai-message-content'; LexiLoopPdfAiRenderer.renderInto(body, note.text);
      remove.textContent = '删除这条会话笔记'; remove.onclick = async () => {
        if (confirm('删除此条笔记？')) try { await mutate('remove-note', note.id); } catch (error) { showToast(error.message); }
      };
      article.append(body, remove); return article;
    }));
  }
  function close() { if (!dirty || confirm('个人笔记尚未保存，放弃修改？')) { dirty = false; dialog.close(); } }
  q('[data-edit]').oninput = () => { dirty = true; };
  q('[data-close]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  q('[data-save]').onclick = async () => {
    try { await mutate('edit', q('[data-edit]').value); dirty = false; q('[data-status]').textContent = '个人笔记已保存'; }
    catch (error) { q('[data-status]').textContent = error.message; }
  };
  q('[data-clear]').onclick = async () => {
    if (confirm('删除 AI 整理稿？个人笔记会保留。')) try { await mutate('clear-generated'); } catch (error) { showToast(error.message); }
  };
  q('[data-generate]').onclick = () => {
    if (aiRequestPending) { showToast('请等待当前问答结束'); return; }
    close(); if (dialog.open) return;
    const targetKey = key;
    askPdfAi('总结整份文档并生成论文知识页，使用以下 Markdown 标题：TL;DR、研究问题、方法、数据与实验、主要结论、局限、可复用思路。每条关键结论必须附已有原文页码 [p. N]；未提供的内容写“未在片段中找到”，不要猜测。', {
      onAnswer: answer => mutate('generate', answer, targetKey)
    });
  };
  q('[data-export]').onclick = () => {
    if (dirty) { showToast('请先保存个人笔记再导出'); return; }
    const text = '# 论文知识页\n\n' + (entry.generated || '') + '\n\n## 个人笔记\n' + (entry.edited || '') + '\n\n' + (entry.notes || []).map(n => n.text).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = 'lexiloop-knowledge.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  document.getElementById('knowledgeButton').onclick = async () => {
    if (!documentKey || !pdfDocument) { showToast('请先打开 PDF'); return; }
    key = documentKey; dirty = false;
    const targetKey = key;
    try {
      const store = (await chrome.storage.local.get('lexiloopPdfKnowledge')).lexiloopPdfKnowledge || {};
      if (targetKey !== documentKey) return;
      entry = store[key] || {}; render(); q('[data-status]').textContent = ''; if (!dialog.open) dialog.showModal();
    } catch (error) { showToast(error.message || '知识页读取失败'); }
  };
  globalThis.saveKnowledgeNote = async text => {
    try { await mutate('note', text, documentKey); showToast('已保存到论文知识页'); }
    catch (error) { showToast(error.message); }
  };
})();
