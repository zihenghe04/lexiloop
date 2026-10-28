const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Explicit integration check for the macOS installation, opt in locally.
test('native host initializes Codex with Chrome GUI PATH', { skip: !process.env.LEXILOOP_NATIVE_TEST, timeout: 45000 }, async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '../native/host.cjs')], {
    env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['pipe', 'pipe', 'pipe']
  });
  try {
    const result = new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      child.on('error', reject);
      child.on('exit', code => reject(new Error('Host exited: ' + code)));
      child.stdout.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
          resolve(JSON.parse(buffer.subarray(4, buffer.readUInt32LE(0) + 4)));
        }
      });
      child.stderr.resume();
    });
    const message = Buffer.from(JSON.stringify({ id: 1, action: 'status' }));
    const header = Buffer.alloc(4); header.writeUInt32LE(message.length);
    child.stdin.write(Buffer.concat([header, message]));
    const reply = await result;
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.type, 'done');
  } finally { child.stdin.end(); }
});
