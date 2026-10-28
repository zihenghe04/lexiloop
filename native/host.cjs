#!/usr/bin/env node
// Chrome Native Messaging host. Only the registered LexiLoop extension can connect.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const readline = require('node:readline');
const xai = require('./xai-oauth.cjs');
const home = path.join(os.homedir(), 'Library', 'Application Support', 'LexiLoop', 'codex');
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
const codex = process.env.LEXILOOP_CODEX || '/opt/homebrew/bin/codex';
const childEnv = { ...process.env, CODEX_HOME: home };
// GUI-launched Chrome does not inherit the user's shell PATH. Codex's npm
// launcher uses /usr/bin/env node, so include this host's working Node runtime.
childEnv.PATH = [...new Set([path.dirname(process.execPath), path.dirname(codex),
  '/opt/homebrew/bin', '/usr/local/bin', ...String(process.env.PATH || '/usr/bin:/bin').split(path.delimiter)
])].join(path.delimiter);
delete childEnv.OPENAI_API_KEY;
delete childEnv.OPENAI_BASE_URL;
const child = spawn(codex, ['app-server', '-c', 'cli_auth_credentials_store="file"'], {
  env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], cwd: home
});
let seq = 0, ready, buffer = Buffer.alloc(0), pendingLogin = null, stoppedError = null;
const pending = new Map();
const requests = new Map();
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (stoppedError) { reject(stoppedError); return; }
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex 授权服务响应超时')); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
function stop(error) {
  stoppedError = error;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
child.on('error', () => stop(new Error('无法启动 Codex CLI，请重新安装辅助程序')));
child.on('exit', (code, signal) => stop(new Error(`Codex 授权服务已退出（${signal || code}），请重新加载扩展后重试`)));
child.stdin.on('error', () => stop(new Error('Codex 授权连接已断开，请重新加载扩展后重试')));
child.stderr.on('data', () => {}); // Never forward credentials or CLI logs to Chrome.
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const item = pending.get(msg.id);
  if (item) {
    pending.delete(msg.id); clearTimeout(item.timer);
    if (msg.error) item.reject(new Error('Codex 授权请求失败：' + String(msg.error.message || '').slice(0, 200)));
    else item.resolve(msg.result);
  }
  if (msg.method === 'account/login/completed') pendingLogin = null;
});
ready = rpc('initialize', { clientInfo: { name: 'lexiloop', version: '0.15.0' } }).then(() => {
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
});
ready.catch(() => {});
function send(value) {
  const data = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(data.length); process.stdout.write(Buffer.concat([header, data]));
}
async function ask(input, emit, signal) {
  const account = await rpc('account/read', { refreshToken: true });
  if (account.account?.type !== 'chatgpt') throw new Error('请先在设置中登录 ChatGPT');
  // This file belongs only to this app; never import the user's Codex or NewMax login.
  const tokens = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).tokens;
  if (!tokens?.access_token) throw new Error('登录凭据不可用，请重新登录');
  const model = String(input.model || '').trim();
  if (!model) throw new Error('请填写支持 ChatGPT/Codex 的 PDF AI 模型');
  const timeoutMs = Number(input.timeoutMs);
  const requestSignal = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(timeoutMs, 2_147_483_647))]) : signal;
  const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST', signal: requestSignal,
    headers: { Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json', Accept: 'text/event-stream',
      ...(tokens.account_id ? { 'ChatGPT-Account-Id': tokens.account_id } : {}) },
    body: JSON.stringify({ ...xai.buildResponsesBody({ ...input, model, provider: 'chatgpt' }), store: false })
  });
  if (!response.ok) throw new Error('ChatGPT/Codex 请求失败（HTTP ' + response.status + '），请检查登录、模型权限或额度');
  let answer = '', rest = '';
  const decoder = new TextDecoder();
  function consume(line) {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event; try { event = JSON.parse(payload); } catch { return; }
    if (event.type === 'response.failed' || event.type === 'error') throw new Error('ChatGPT/Codex 未完成回答，请检查模型权限和额度');
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { answer += event.delta; emit(event.delta); }
  }
  for await (const part of response.body) {
    rest += decoder.decode(part, { stream: true });
    const lines = rest.split(/\r?\n/); rest = lines.pop(); lines.forEach(consume);
  }
  rest += decoder.decode(); if (rest) consume(rest);
  if (!answer.trim()) throw new Error('ChatGPT/Codex 没有返回最终答案');
  return { answer, model, service: 'ChatGPT OAuth · ' + model, streamed: true };
}
const xaiDir = path.join(os.homedir(), 'Library', 'Application Support', 'LexiLoop', 'xai');
const xaiAuthFile = path.join(xaiDir, 'auth.json');
let xaiEndpoints = null;
let grokPending = null;
function readGrokAuth() {
  try {
    const data = JSON.parse(fs.readFileSync(xaiAuthFile, 'utf8'));
    if (!data || typeof data.accountId !== 'string' || typeof data.refreshToken !== 'string') return null;
    if (!data.accountId || data.accountId.length > 200 || !data.refreshToken || data.refreshToken.length > 20000) return null;
    return data;
  } catch { return null; }
}
function writeGrokAuth(data) {
  fs.mkdirSync(xaiDir, { recursive: true, mode: 0o700 });
  const temp = xaiAuthFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({
    accountId: data.accountId, login: String(data.login || '').slice(0, 200),
    refreshToken: data.refreshToken, accessToken: data.accessToken,
    expiresAtMs: data.expiresAtMs
  }), { mode: 0o600 });
  fs.renameSync(temp, xaiAuthFile);
  fs.chmodSync(xaiAuthFile, 0o600);
}
function clearGrokAuth() {
  grokPending = null;
  try { fs.rmSync(xaiAuthFile, { force: true }); } catch { /* already gone */ }
}
function grokAccount(saved) {
  return saved ? { type: 'grok', email: saved.login || 'Grok' } : null;
}
async function grokEndpoints() {
  if (!xaiEndpoints) xaiEndpoints = await xai.discover(fetch);
  return xaiEndpoints;
}
async function grokAccessToken() {
  const saved = readGrokAuth();
  if (!saved) throw new Error('请先在设置中登录 Grok');
  if (saved.accessToken && Number(saved.expiresAtMs) > Date.now() + 60_000) return saved.accessToken;
  const endpoints = await grokEndpoints();
  let tokens;
  try { tokens = await xai.refreshAccessToken(fetch, endpoints.tokenEndpoint, saved.refreshToken); }
  catch (error) {
    if (error.code === 'reauth') clearGrokAuth();
    throw error;
  }
  const identity = xai.identityFromTokens(tokens) || { accountId: saved.accountId, login: saved.login };
  const next = {
    accountId: identity.accountId, login: identity.login || saved.login,
    refreshToken: tokens.refresh_token || saved.refreshToken, accessToken: tokens.access_token,
    expiresAtMs: Date.now() + tokens.expires_in * 1000
  };
  writeGrokAuth(next);
  return next.accessToken;
}
async function consumeSse(response, emit, label) {
  if (!response.ok) throw new Error(label + ' 请求失败（HTTP ' + response.status + '），请检查登录、模型权限或额度');
  let answer = '', rest = '';
  const decoder = new TextDecoder();
  function consume(line) {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event; try { event = JSON.parse(payload); } catch { return; }
    if (event.type === 'response.failed' || event.type === 'error') throw new Error(label + ' 未完成回答，请检查模型权限和额度');
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { answer += event.delta; emit(event.delta); }
  }
  for await (const part of response.body) {
    rest += decoder.decode(part, { stream: true });
    const lines = rest.split(/\r?\n/); rest = lines.pop(); lines.forEach(consume);
  }
  rest += decoder.decode(); if (rest) consume(rest);
  if (!answer.trim()) throw new Error(label + ' 没有返回最终答案');
  return answer;
}
async function askGrok(input, emit, signal) {
  const model = String(input.model || '').trim();
  if (!model) throw new Error('请填写 Grok PDF AI 模型');
  const token = await grokAccessToken();
  const timeoutMs = Number(input.timeoutMs);
  const requestSignal = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(timeoutMs, 2_147_483_647))]) : signal;
  const response = await fetch(xai.assertApiUrl(xai.API_BASE + '/responses'), {
    method: 'POST', signal: requestSignal, redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(xai.buildResponsesBody({ ...input, model }))
  });
  const answer = await consumeSse(response, emit, 'Grok');
  return { answer, model, service: 'Grok OAuth · ' + model, streamed: true };
}
async function grokLogin() {
  const endpoints = await grokEndpoints();
  const device = await xai.startDeviceFlow(fetch, endpoints.deviceAuthorizationEndpoint);
  grokPending = { ...device, tokenEndpoint: endpoints.tokenEndpoint, nextPollAt: 0, expiresAt: Date.now() + device.expiresIn * 1000 };
  return { userCode: device.userCode, verificationUri: device.verificationUri, interval: device.interval, pending: true };
}
async function grokPoll() {
  if (!grokPending) return { account: grokAccount(readGrokAuth()) };
  if (Date.now() > grokPending.expiresAt) { grokPending = null; throw new Error('Grok 登录已过期，请重新开始'); }
  if (Date.now() < grokPending.nextPollAt) return { pending: true, userCode: grokPending.userCode, interval: grokPending.interval };
  grokPending.nextPollAt = Date.now() + grokPending.interval * 1000;
  const result = await xai.pollDeviceFlow(fetch, grokPending.tokenEndpoint, grokPending.deviceCode);
  if (result.kind === 'slow_down') grokPending.interval = Math.min(60, grokPending.interval + 5);
  if (result.kind === 'pending' || result.kind === 'slow_down') return { pending: true, userCode: grokPending.userCode, interval: grokPending.interval };
  if (result.kind === 'denied' || result.kind === 'expired') {
    grokPending = null;
    throw new Error(result.kind === 'denied' ? 'Grok 登录被拒绝' : 'Grok 登录已过期，请重新开始');
  }
  const identity = xai.identityFromTokens(result.tokens);
  if (!identity) { grokPending = null; throw new Error('Grok 登录成功但没有账号标识，未保存'); }
  writeGrokAuth({
    accountId: identity.accountId, login: identity.login,
    refreshToken: result.tokens.refresh_token, accessToken: result.tokens.access_token,
    expiresAtMs: Date.now() + result.tokens.expires_in * 1000
  });
  grokPending = null;
  return { account: grokAccount(readGrokAuth()) };
}
async function grokModels() {
  try {
    const token = await grokAccessToken();
    const response = await fetch(xai.assertApiUrl(xai.API_BASE + '/models'), {
      redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Grok 模型列表失败（HTTP ' + response.status + '）');
    const models = xai.parseModelList(await response.json());
    if (!models.length) throw new Error('Grok 没有返回可用的文本模型');
    return { models };
  } catch (error) {
    return { models: xai.GROK_TEXT_FALLBACK.map((item) => ({ ...item, efforts: [...item.efforts] })), warning: String(error.message || '模型列表失败').slice(0, 200) };
  }
}
async function handleGrok(msg, emit, signal) {
  if (msg.action === 'grok-status') {
    const saved = readGrokAuth();
    return { account: grokAccount(saved), pending: Boolean(grokPending), userCode: grokPending?.userCode || '', interval: grokPending?.interval };
  }
  if (msg.action === 'grok-login') return grokLogin();
  if (msg.action === 'grok-poll') return grokPoll();
  if (msg.action === 'grok-logout') { clearGrokAuth(); return { account: null }; }
  if (msg.action === 'grok-models') return grokModels();
  if (msg.action === 'ask') return askGrok(msg.input || {}, emit, signal);
  throw new Error('未知请求');
}
function listCcSwitch() {
  const db = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(db)) { resolve({ providers: [], missing: true }); return; }
    execFile('/usr/bin/sqlite3', ['-readonly', '-json', db,
      "SELECT id, app_type, name, IFNULL(provider_type,'') AS provider_type, IFNULL(category,'') AS category, settings_config FROM providers"],
      { maxBuffer: 12 * 1024 * 1024, timeout: 8000 }, (error, stdout) => {
        if (error) { reject(new Error('无法读取 CC Switch 数据库')); return; }
        try { resolve({ providers: JSON.parse(stdout || '[]') }); }
        catch { reject(new Error('CC Switch 数据库格式无法识别')); }
      });
  });
}
async function handle(msg) {
  try {
    if (msg.action === 'cc-switch-preview') {
      send({ id: msg.id, type: 'done', ok: true, ...(await listCcSwitch()) });
      return;
    }
    if (msg.action === 'cancel') {
      requests.get(msg.input?.id)?.abort();
      send({ id: msg.id, type: 'done', ok: true });
      return;
    }
    const grok = String(msg.action || '').startsWith('grok-') || (msg.action === 'ask' && msg.input?.provider === 'grok');
    if (grok) {
      const controller = new AbortController();
      if (msg.action === 'ask') requests.set(msg.id, controller);
      try {
        const result = await handleGrok(msg, text => send({ id: msg.id, type: 'chunk', text }), controller.signal);
        send({ id: msg.id, type: 'done', ok: true, ...result });
      } finally { requests.delete(msg.id); }
      return;
    }
    await ready;
    let result;
    if (msg.action === 'status') {
      const data = await rpc('account/read', { refreshToken: false });
      result = { account: data.account?.type === 'chatgpt' ? data.account : null, pending: Boolean(pendingLogin) };
    } else if (msg.action === 'models') {
      try {
        const data = await rpc('model/list', { includeHidden: false });
        const models = xai.parseCodexModels(data);
        if (!models.length) throw new Error('ChatGPT 没有返回可选模型');
        result = { models };
      } catch (error) {
        result = { models: [], warning: String(error.message || '模型列表失败').slice(0, 200) };
      }
    } else if (msg.action === 'login') {
      if (pendingLogin) await rpc('account/login/cancel', { loginId: pendingLogin });
      result = await rpc('account/login/start', { type: 'chatgpt' }); pendingLogin = result.loginId;
      const url = new URL(result.authUrl);
      if (url.origin !== 'https://auth.openai.com') throw new Error('授权地址异常');
      result = { authUrl: url.href };
    } else if (msg.action === 'logout') {
      if (pendingLogin) await rpc('account/login/cancel', { loginId: pendingLogin });
      pendingLogin = null; await rpc('account/logout'); result = { account: null };
    } else if (msg.action === 'ask') {
      const controller = new AbortController(); requests.set(msg.id, controller);
      try { result = await ask(msg.input || {}, text => send({ id: msg.id, type: 'chunk', text }), controller.signal); }
      finally { requests.delete(msg.id); }
    }
    else throw new Error('未知请求');
    send({ id: msg.id, type: 'done', ok: true, ...result });
  } catch (error) {
    const grok = String(msg.action || '').startsWith('grok-') || msg.input?.provider === 'grok';
    send({ id: msg.id, type: 'done', ok: false, error: error.name === 'TimeoutError' ? (grok ? 'Grok 请求超时' : 'ChatGPT 请求超时') : String(error.message || '请求失败').slice(0, 300) });
  }
}
process.stdin.on('data', data => {
  buffer = Buffer.concat([buffer, data]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (size > 20000000) process.exit(1);
    if (buffer.length < size + 4) return;
    const body = buffer.subarray(4, size + 4); buffer = buffer.subarray(size + 4);
    try { void handle(JSON.parse(body)); } catch { process.exit(1); }
  }
});
process.stdin.on('end', () => { child.kill(); process.exit(0); });
