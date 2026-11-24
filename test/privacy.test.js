'use strict';

// Guards the claims in PRIVACY.md. If one of these fails, the code changed in a
// way that may let the app read page content, credentials or cookies, or send
// data somewhere other than Facebook. Update PRIVACY.md before relaxing a rule.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const sources = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: f, code: fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '') }));
const main = sources.find((s) => s.file === 'main.js').code;
const pkg = require('../package.json');

const FORBIDDEN = {
  'runs script inside the page (could read form fields)': /\bexecuteJavaScript(InIsolatedWorld)?\b/,
  'injects a preload script into the page': /\bpreload\b/,
  'IPC channel between page and app': /\b(ipcMain|ipcRenderer|contextBridge)\b/,
  'reads or writes cookies': /\bcookies\s*\./,
  'intercepts or inspects network traffic': /\b(webRequest|protocol\.handle|debugger\.attach)\b/,
  'makes its own network requests': /\b(fetch\s*\(|net\.request|require\(['"]https?['"]\)|XMLHttpRequest)/,
  'uploads crash reports': /\bcrashReporter\b/,
  'phones home for updates': /\bautoUpdater\b/,
  'reads page console output': /console-message/,
};

for (const [what, re] of Object.entries(FORBIDDEN)) {
  test(`app code never ${what}`, () => {
    const hits = sources.filter((s) => re.test(s.code)).map((s) => s.file);
    assert.deepStrictEqual(hits, [], `found in: ${hits.join(', ')}`);
  });
}

test('the only thing injected into the page is CSS', () => {
  assert.match(main, /\binsertCSS\(/);
});

test('page runs isolated from the app (contextIsolation, sandbox, no Node)', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false/);
});

test('permissions are an explicit allow-list', () => {
  const m = main.match(/const allowed = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'permission allow-list not found');
  const granted = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).sort();
  assert.deepStrictEqual(granted, ['clipboard-sanitized-write', 'display-capture', 'fullscreen', 'media', 'notifications']);
});

test('build hardens the binary: cookie encryption on, code-injection switches off', () => {
  const f = pkg.build.electronFuses;
  assert.strictEqual(f.enableCookieEncryption, true);
  assert.strictEqual(f.runAsNode, false);
  assert.strictEqual(f.enableNodeOptionsEnvironmentVariable, false);
  assert.strictEqual(f.enableNodeCliInspectArguments, false);
  assert.strictEqual(f.onlyLoadAppFromAsar, true);
});

test('app has no runtime dependencies that could add behaviour', () => {
  assert.strictEqual(pkg.dependencies, undefined);
});
