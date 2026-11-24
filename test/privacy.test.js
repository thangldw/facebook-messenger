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
  // Strip comments so they cannot satisfy or trip a check. A line comment must
  // start the line or follow whitespace, so "\/\/" in regexes and "https://" survive.
  .map((f) => ({ file: f, code: fs.readFileSync(path.join(SRC, f), 'utf8').replace(/(^|\s)\/\/.*$|\/\*[\s\S]*?\*\//gm, '$1') }));
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

test('every window is guarded and <webview> is blocked', () => {
  assert.match(main, /app\.on\(['"]web-contents-created['"]/);
  assert.match(main, /will-attach-webview[^\n]*preventDefault/);
  assert.match(main, /guardContents\(wc\)/);
  for (const ev of ['will-navigate', 'will-redirect', 'did-navigate']) {
    assert.match(main, new RegExp(`wc\\.on\\(['"]${ev}['"]`), `missing ${ev} guard`);
  }
  assert.match(main, /setWindowOpenHandler/);
});

test('permissions and screen capture are limited to Facebook origins', () => {
  assert.match(main, /setPermissionRequestHandler\([^]*?isFacebookUrl\(details\.requestingUrl\)/);
  assert.match(main, /setPermissionCheckHandler\([^]*?isFacebookUrl\(requestingOrigin\)/);
  const share = sources.find((s) => s.file === 'screen-share.js').code;
  assert.match(share, /isFacebookUrl\(request\.securityOrigin\)/);
});

test('packaged builds refuse remote-debugging switches', () => {
  assert.ok(main.includes('if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {\n  app.exit(1);'));
  for (const s of ['remote-debugging-port', 'remote-debugging-pipe']) assert.ok(main.includes(`'${s}'`));
});

test('no third-party spellcheck dictionary downloads (Windows/Linux)', () => {
  assert.match(main, /setSpellCheckerEnabled\(process\.platform === ['"]darwin['"]\)/);
});

test('external links only open http(s) in the browser', () => {
  // Every shell.openExternal call must sit behind the http(s) check, so a page
  // cannot launch file:, smb: or custom-protocol handlers on the computer.
  const calls = sources.flatMap((s) => s.code.split('\n').filter((l) => l.includes('shell.openExternal')));
  assert.ok(calls.length > 0);
  for (const line of calls) assert.ok(line.includes('/^https?:'), `unguarded: ${line.trim()}`);
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
