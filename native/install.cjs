// Run with Node from the installed extension directory. Generates native host registration.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const extensionId = process.argv[2];
if (!extensionId) {
  throw new Error('Usage: node native/install.cjs EXTENSION_ID\n' +
    'Find the ID on chrome://extensions (Developer mode) for the loaded LexiLoop extension.');
}
if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid extension ID');
if (process.platform !== 'darwin') throw new Error('This installer currently supports macOS Chrome');
const directory = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
const support = path.join(os.homedir(), 'Library/Application Support/LexiLoop');
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(support, { recursive: true, mode: 0o700 });
// Chrome cannot reliably exec a host inside ~/Documents or a path containing spaces.
// The registered executable lives next to Chrome's own support files.
const launcher = path.join(support, 'oauth-host');
const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const script = '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(path.join(__dirname, 'host.cjs')) + '\n';
fs.writeFileSync(launcher, script, { mode: 0o700 });
fs.chmodSync(launcher, 0o700);
try { execFileSync('xattr', ['-d', 'com.apple.quarantine', launcher], { stdio: 'ignore' }); } catch { /* not quarantined */ }
fs.writeFileSync(path.join(directory, 'com.lexiloop.oauth.json'), JSON.stringify({
  name: 'com.lexiloop.oauth', description: 'LexiLoop subscription login', path: launcher,
  type: 'stdio', allowed_origins: ['chrome-extension://' + extensionId + '/']
}, null, 2), { mode: 0o600 });
console.log('LexiLoop OAuth native host registered for ' + extensionId);
