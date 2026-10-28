(() => {
  const KEYS = ['lexiloopWords', 'lexiloopSettings', 'lexiloopPdfLibrary', 'lexiloopPdfAnnotations', 'lexiloopPdfAiHistory', 'lexiloopPdfKnowledge'];
  const MAX_BYTES = 100 * 1024 * 1024;
  function validate(value) {
    if (!value || value.format !== 'lexiloop-backup' || value.version !== 1) throw new Error('不是受支持的 LexiLoop 备份');
    if (!value.local || typeof value.local !== 'object' || Array.isArray(value.local)) throw new Error('备份数据无效');
    for (const key of Object.keys(value.local)) if (!KEYS.includes(key)) throw new Error('备份包含不允许导入的字段');
    for (const key of ['lexiloopWords', 'lexiloopPdfLibrary']) {
      if (value.local[key] !== undefined && !Array.isArray(value.local[key])) throw new Error('备份列表无效');
    }
    for (const key of ['lexiloopSettings', 'lexiloopPdfAnnotations', 'lexiloopPdfAiHistory', 'lexiloopPdfKnowledge']) {
      const item = value.local[key];
      if (item !== undefined && (!item || typeof item !== 'object' || Array.isArray(item))) throw new Error('备份记录无效');
    }
    if (!Array.isArray(value.files) || !Array.isArray(value.indexes)) throw new Error('备份缺少 PDF 数据');
    const seen = new Set();
    for (const file of value.files) {
      if (!file || typeof file.id !== 'string' || !file.id || seen.has(file.id) || typeof file.base64 !== 'string'
        || !isBase64(file.base64)) throw new Error('PDF 备份记录无效');
      seen.add(file.id);
    }
    for (const item of value.indexes) if (!item || typeof item.id !== 'string') throw new Error('索引记录无效');
    return value;
  }
  // 线性检查（大 PDF 的 base64 有几十 MB，带重复分组的正则会栈溢出）
  function isBase64(value) {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
  }
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lexiloopPdfFiles', 2);
      request.onupgradeneeded = () => {
        for (const name of ['files', 'indexes']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function readStores() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['files', 'indexes'], 'readonly');
      const files = tx.objectStore('files').getAll(), indexes = tx.objectStore('indexes').getAll();
      tx.oncomplete = () => { db.close(); resolve({ files: files.result, indexes: indexes.result }); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function replaceStores(data) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['files', 'indexes'], 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('恢复 PDF 数据失败')); };
      try {
        for (const name of ['files', 'indexes']) {
          const store = tx.objectStore(name); store.clear();
          for (const item of data[name]) store.put(item);
        }
      } catch (error) { tx.abort(); }
    });
  }
  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
    });
  }
  async function exportData() {
    const stores = await readStores();
    const size = stores.files.reduce((sum, item) => sum + item.blob.size, 0);
    if (size > MAX_BYTES * 0.7) throw new Error('PDF 总量超过当前单文件备份上限，请先单独保存大文件');
    const result = { format: 'lexiloop-backup', version: 1, createdAt: new Date().toISOString(),
      local: await chrome.storage.local.get(KEYS), files: [], indexes: stores.indexes };
    for (const item of stores.files) result.files.push({ id: item.id, base64: await base64(item.blob) });
    const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
    if (blob.size > MAX_BYTES) throw new Error('备份超过 100 MB，请先清理可重建的索引');
    return blob;
  }
  async function importData(file) {
    if (file.size > MAX_BYTES) throw new Error('备份文件超过 100 MB');
    const parsed = validate(JSON.parse(await file.text()));
    const files = parsed.files.map(item => {
      const binary = atob(item.base64);
      return { id: item.id, blob: new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'application/pdf' }), updatedAt: Date.now() };
    });
    // Rollback journal survives a page close between IndexedDB and chrome.storage writes.
    if ((await chrome.storage.local.get('lexiloopRestorePending')).lexiloopRestorePending) throw new Error('上次恢复未结束，请点击恢复上次数据');
    const before = { local: await chrome.storage.local.get(KEYS), ...(await readStores()) };
    const db = await database(); db.close();
    // Journal blobs use structured clone in a separate database.
    await journal(before);
    await chrome.storage.local.set({ lexiloopRestorePending: true });
    try {
      await replaceStores({ files, indexes: parsed.indexes });
      await chrome.storage.local.remove(KEYS);
      await chrome.storage.local.set(parsed.local);
      await chrome.storage.local.remove('lexiloopRestorePending');
    } catch (error) { await recover(); throw error; }
  }
  async function journal(value) {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('lexiloopRestoreJournal', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('snapshot');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshot', value ? 'readwrite' : 'readonly');
      const r = value ? tx.objectStore('snapshot').put(value, 'before') : tx.objectStore('snapshot').get('before');
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function recover() {
    const before = await journal();
    if (!before) throw new Error('没有恢复前的数据快照');
    await replaceStores(before);
    await chrome.storage.local.remove(KEYS);
    await chrome.storage.local.set(before.local);
    await chrome.storage.local.remove('lexiloopRestorePending');
  }
  const api = { validate, exportData, importData, recover, KEYS };
  globalThis.LexiLoopBackup = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
