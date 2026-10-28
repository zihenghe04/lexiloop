const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const xai = require('../native/xai-oauth.cjs');

function jwt(claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `e30.${body}.sig`;
}

function fakeFetch(handler) {
  return async (url, options) => {
    const result = await handler(url, options);
    return {
      ok: result.status < 400,
      status: result.status,
      async text() { return JSON.stringify(result.json); },
      async json() { return result.json; }
    };
  };
}

test('discovery rejects an issuer or endpoint outside auth.x.ai', async () => {
  await assert.rejects(() => xai.discover(fakeFetch(async () => ({
    status: 200,
    json: { issuer: 'https://evil.example', token_endpoint: 'https://auth.x.ai/token', device_authorization_endpoint: 'https://auth.x.ai/device' }
  }))), /不受信任/);
  assert.throws(() => xai.assertAuthEndpoint('http://auth.x.ai/token'), /不受信任/);
  assert.throws(() => xai.assertAuthEndpoint('https://user:pass@auth.x.ai/token'), /不受信任/);
  assert.throws(() => xai.assertApiUrl('https://api.x.ai.evil/v1/responses'), /不受信任/);
});

test('the login page may be accounts.x.ai, but token endpoints may not', () => {
  assert.equal(xai.assertVerificationUri('https://accounts.x.ai/oauth2/device?user_code=ABCD-1234'), 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234');
  assert.throws(() => xai.assertVerificationUri('https://evil.example/device'), /不受信任/);
  assert.throws(() => xai.assertAuthEndpoint('https://accounts.x.ai/oauth2/token'), /不受信任/);
});

test('device flow keeps the user code and only returns an auth.x.ai page', async () => {
  const started = await xai.startDeviceFlow(fakeFetch(async (url, options) => {
    assert.equal(url, 'https://auth.x.ai/device');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_id'), xai.CLIENT_ID);
    assert.match(body.get('scope'), /offline_access/);
    return { status: 200, json: {
      device_code: 'device-secret', user_code: 'ABCD-1234', interval: 5, expires_in: 600,
      verification_uri: 'https://auth.x.ai/device',
      verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-1234'
    } };
  }), 'https://auth.x.ai/device');
  assert.equal(started.userCode, 'ABCD-1234');
  assert.equal(started.verificationUri, 'https://auth.x.ai/device?user_code=ABCD-1234');
  assert.equal(started.deviceCode, 'device-secret');
});

test('polling distinguishes pending, slow down, denial and a saved token pair', async () => {
  const pending = await xai.pollDeviceFlow(fakeFetch(async () => ({ status: 400, json: { error: 'authorization_pending' } })), 'https://auth.x.ai/token', 'device');
  assert.equal(pending.kind, 'pending');
  const slow = await xai.pollDeviceFlow(fakeFetch(async () => ({ status: 400, json: { error: 'slow_down' } })), 'https://auth.x.ai/token', 'device');
  assert.equal(slow.kind, 'slow_down');
  const denied = await xai.pollDeviceFlow(fakeFetch(async () => ({ status: 400, json: { error: 'access_denied' } })), 'https://auth.x.ai/token', 'device');
  assert.equal(denied.kind, 'denied');
  const ok = await xai.pollDeviceFlow(fakeFetch(async () => ({ status: 200, json: {
    access_token: jwt({ sub: 'acct-1', email: 'ada@example.com' }),
    refresh_token: 'refresh-1', expires_in: 3600, id_token: jwt({ sub: 'acct-1', email: 'ada@example.com' })
  } })), 'https://auth.x.ai/token', 'device');
  assert.equal(ok.kind, 'tokens');
  assert.equal(xai.identityFromTokens(ok.tokens).login, 'ada@example.com');
  assert.equal(xai.identityFromTokens(ok.tokens).accountId, 'acct-1');
});

test('a successful login without a refresh token is not stored', async () => {
  await assert.rejects(() => xai.pollDeviceFlow(fakeFetch(async () => ({
    status: 200, json: { access_token: 'access-only', expires_in: 60 }
  })), 'https://auth.x.ai/token', 'device'), /未保存/);
});

test('refresh maps invalid_grant to reauth and does not echo the token', async () => {
  await assert.rejects(() => xai.refreshAccessToken(fakeFetch(async (url, options) => {
    assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'old-refresh');
    return { status: 400, json: { error: 'invalid_grant', error_description: 'old-refresh leaked' } };
  }), 'https://auth.x.ai/token', 'old-refresh'), (error) => {
    assert.equal(error.code, 'reauth');
    assert.doesNotMatch(error.message, /old-refresh/);
    return true;
  });
});

test('reasoning effort is only attached for a known level, and Grok has no xhigh', () => {
  assert.deepEqual(xai.reasoningBody('high', 'grok'), { reasoning: { effort: 'high' } });
  assert.equal(xai.normalizeEffort('xhigh', 'grok'), 'high');
  assert.deepEqual(xai.reasoningBody('nope', 'chatgpt'), {});
  const body = xai.buildResponsesBody({ purpose: 'translate', provider: 'grok', model: 'grok-4.7', question: 'Hello {v1}', reasoningEffort: 'xhigh', instructions: 'Translate only' });
  assert.equal(body.reasoning.effort, 'high');
  assert.equal(body.instructions, 'Translate only');
  assert.equal(body.input[0].content[0].text, 'Hello {v1}');
  assert.equal(JSON.stringify(body).includes('Question:'), false);
});

test('model list keeps text models and drops image or video models', () => {
  const models = xai.parseModelList({ data: [
    { id: 'grok-4.7' }, { id: 'grok-imagine-image' }, { id: 'grok-4.20-0309-non-reasoning' }
  ] });
  assert.deepEqual(models.map((item) => item.id), ['grok-4.20-0309-non-reasoning', 'grok-4.7']);
  assert.deepEqual(models[0].efforts, []);
  assert.deepEqual(models[1].efforts, ['low', 'medium', 'high']);
});

test('Responses body omits store and does not carry refresh credentials', () => {
  const body = xai.buildResponsesBody({
    model: 'grok-4.7', context: 'page 2', question: 'What?',
    imageDataUrl: 'data:image/png;base64,aaaa', history: [{ role: 'user', content: 'earlier' }]
  });
  assert.equal(body.store, undefined);
  assert.equal(body.model, 'grok-4.7');
  assert.equal(body.input[1].content[1].type, 'input_image');
  assert.equal(JSON.stringify(body).includes('refresh'), false);
});

test('the native host does not import CC Switch or Grok CLI logins', () => {
  const host = fs.readFileSync(path.join(__dirname, '../native/host.cjs'), 'utf8');
  assert.doesNotMatch(host, /\.grok\/auth|xai_oauth_auth\.json/);
  assert.match(host, /LexiLoop', 'xai'/);
  assert.match(host, /grok-login/);
});
