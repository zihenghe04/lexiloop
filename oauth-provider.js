(() => {
  let port, seq = 0;
  const pending = new Map();
  function request(action, input = {}, onChunk = () => {}, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('已停止生成')); return; }
      if (!port) {
        port = chrome.runtime.connectNative('com.lexiloop.oauth');
        port.onMessage.addListener(msg => {
          const task = pending.get(msg.id); if (!task) return;
          if (msg.type === 'chunk') { task.onChunk(msg.text); return; }
          pending.delete(msg.id); clearTimeout(task.timer); task.cleanup();
          msg.ok ? task.resolve(msg) : task.reject(new Error(msg.error));
        });
        port.onDisconnect.addListener(() => {
          const reason = chrome.runtime.lastError?.message || '';
          port = null;
          const message = reason
            ? `OAuth 辅助程序未连接（${reason}）。请在扩展目录运行 node native/install.cjs 后重启 Chrome`
            : 'OAuth 辅助程序未连接，请先运行 native/install.cjs 后重启 Chrome';
          for (const task of pending.values()) { clearTimeout(task.timer); task.cleanup(); task.reject(new Error(message)); }
          pending.clear();
        });
      }
      const id = ++seq;
      const cancel = (reason = '已停止生成') => {
        try { port?.postMessage({ id: ++seq, action: 'cancel', input: { id } }); } catch {}
        pending.delete(id); clearTimeout(timer); cleanup(); reject(new Error(reason));
      };
      const onAbort = () => cancel();
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const duration = action === 'ask' ? Number(input.timeoutMs) : 30000;
      const timer = Number.isFinite(duration) && duration > 0
        ? setTimeout(() => cancel('OAuth 辅助程序请求超时'), Math.min(duration + 15000, 2_147_483_647)) : null;
      pending.set(id, { resolve, reject, onChunk, timer, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      port.postMessage({ id, action, input });
    });
  }
  globalThis.LexiLoopOAuth = { request };
})();
