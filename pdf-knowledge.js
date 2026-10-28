(() => {
  const KEY = 'lexiloopPdfKnowledge';
  function patch(entry = {}, action, value) {
    const next = { generated: '', edited: '', notes: [], ...entry };
    if (action === 'generate') next.generated = String(value || '');
    else if (action === 'edit') next.edited = String(value || '');
    else if (action === 'note') next.notes = [...next.notes, { id: crypto.randomUUID(), text: String(value || ''), createdAt: Date.now() }];
    else if (action === 'remove-note') next.notes = next.notes.filter(note => note.id !== value);
    else if (action === 'clear-generated') next.generated = '';
    else throw new Error('未知知识页操作');
    next.updatedAt = Date.now(); return next;
  }
  const api = { KEY, patch };
  globalThis.LexiLoopKnowledge = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
