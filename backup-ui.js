(() => {
  const get = id => document.getElementById(id);
  let busy = false;
  async function run(task) {
    if (busy) return; busy = true;
    const controls = ['backupExport', 'backupImport', 'backupRecover'];
    controls.forEach(id => get(id).disabled = true);
    get('backupStatus').hidden = false; get('backupStatus').textContent = '正在处理，请保持此页面打开…';
    try { await task(); get('backupStatus').textContent = '操作完成。恢复数据后请重新打开插件页面。'; }
    catch (error) { get('backupStatus').textContent = '操作失败：' + error.message; }
    finally { busy = false; controls.forEach(id => get(id).disabled = false); }
  }
  get('backupExport').onclick = () => run(async () => {
    const blob = await LexiLoopBackup.exportData(), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = 'lexiloop-backup-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  get('backupImport').onclick = () => get('backupFile').click();
  get('backupFile').onchange = () => {
    const file = get('backupFile').files[0]; get('backupFile').value = '';
    if (file && confirm('用备份替换词库、文献、批注和会话？请先关闭其他 LexiLoop 页面。当前数据会保留一个恢复快照。')) run(() => LexiLoopBackup.importData(file));
  };
  get('backupRecover').onclick = () => {
    if (confirm('恢复为上次导入前的数据？导入后新增的数据将被替换。')) run(() => LexiLoopBackup.recover());
  };
})();
