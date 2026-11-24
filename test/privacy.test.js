'use strict';

// Guards the claims in PRIVACY.md. If one of these fails, the code changed in a
// way that may let the app read page content, credentials or cookies, or send
// data somewhere other than Facebook. Update PRIVACY.md before relaxing a rule.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');
const sources = fs.readdirSync(SRC, { recursive: true })
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => f.endsWith('.js'))
  // Strip comments so they cannot satisfy or trip a check. A line comment must
  // start the line or follow whitespace, so "\/\/" in regexes and "https://" survive.
  // Normalise CRLF first: Windows checkouts may convert line endings.
  .map((f) => ({ file: f, code: fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n').replace(/(^|\s)\/\/.*$|\/\*[\s\S]*?\*\//gm, '$1') }));
const code = (file) => sources.find((s) => s.file === file).code;
const main = code('main.js');
const pkg = require('../package.json');

// Each rule may name the only files allowed to use it, with the reason
// enforced by the dedicated tests further down.
// The app's own local pages (lock/recovery overlay, settings window).
const OVERLAY_FILES = ['overlay.js', 'ui/overlay-preload.js', 'settings-window.js', 'ui/settings-preload.js'];
const FORBIDDEN = {
  'runs script inside the page (could read form fields)': [/\bexecuteJavaScript(InIsolatedWorld)?\b/],
  'injects a preload script into the page': [/\bpreload\b/, OVERLAY_FILES],
  'IPC channel between page and app': [/\b(ipcMain|ipcRenderer|contextBridge)\b/, OVERLAY_FILES],
  'reads or writes cookies': [/\bcookies\s*\./],
  'intercepts or inspects network traffic': [/\b(webRequest|protocol\.handle|debugger\.attach)\b/],
  'makes its own network requests': [/\b(fetch\s*\(|net\.request|require\(['"]https?['"]\)|XMLHttpRequest)/, ['updater.js']],
  'uploads crash reports': [/\bcrashReporter\b/],
  'phones home for updates': [/\bautoUpdater\b/],
  'reads page console output': [/console-message/],
};

for (const [what, [re, allowedIn = []]] of Object.entries(FORBIDDEN)) {
  test(`app code never ${what}${allowedIn.length ? ` (except ${allowedIn.join(', ')})` : ''}`, () => {
    const hits = sources.filter((s) => re.test(s.code) && !allowedIn.includes(s.file)).map((s) => s.file);
    assert.deepStrictEqual(hits, [], `found in: ${hits.join(', ')}`);
  });
}

test('Facebook pages never get a preload or IPC: only the app\'s own pages do', () => {
  // main.js and account-view.js create every view and window that shows Facebook;
  // neither may mention preload at all.
  assert.doesNotMatch(main, /\bpreload\b/);
  const account = code('account-view.js');
  assert.doesNotMatch(account, /\bpreload\b/);
  assert.match(account, /contextIsolation: true,\s*sandbox: true,\s*nodeIntegration: false/);
  // Call windows inherit the account's session and the same isolation.
  assert.match(main, /webPreferences: \{ session: wc\.session, contextIsolation: true, sandbox: true, nodeIntegration: false \}/);
  const overlay = code('overlay.js');
  assert.match(overlay, /new WebContentsView\(/);
  assert.match(overlay, /preload: path\.join\(__dirname, 'ui', 'overlay-preload\.js'\)/);
  assert.match(overlay, /wc\.loadFile\(/, 'overlay loads a local file only');
  assert.doesNotMatch(overlay, /loadURL\(/);
});

test('overlay IPC accepts only its own page and a fixed set of actions', () => {
  const overlay = code('overlay.js');
  assert.match(overlay, /if \(!this\.view \|\| event\.sender !== this\.view\.webContents \|\| !ACTIONS\.has\(action\)\) throw/);
  assert.match(overlay, /wc\.on\('will-navigate', \(e\) => e\.preventDefault\(\)\)/);
  assert.match(overlay, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  const html = read('ui/overlay.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\//, 'overlay page loads nothing remote');
});

test('settings window IPC accepts only its own page and a fixed set of actions', () => {
  const sw = code('settings-window.js');
  assert.match(sw, /event\.sender !== this\.win\.webContents \|\| !ACTIONS\.has\(action\)\) \{\s*throw/);
  assert.match(sw, /registerAppPage\(wc\)/);
  assert.match(sw, /wc\.on\('will-navigate', \(e\) => e\.preventDefault\(\)\)/);
  assert.match(sw, /this\.win\.loadFile\(/);
  assert.doesNotMatch(sw, /loadURL\(/);
  const html = read('ui/settings.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('accounts never share a session', () => {
  const account = code('account-view.js');
  assert.match(account, /return id === 'default' \? 'persist:messenger' : `persist:messenger-\$\{id\}`;/);
  assert.match(account, /if \(ephemeral\) return `messenger-private-\$\{id\}`;/);
  assert.match(account, /partition: this\.partition,/);
});

test('update check: off by default, GitHub releases API only, no cookies', () => {
  const up = code('updater.js');
  assert.ok(up.includes("const API_URL = 'https://api.github.com/repos/thangldw/facebook-messenger/releases/latest';"));
  const fetches = up.match(/net\.fetch\(([^,]+),/g) || [];
  assert.deepStrictEqual(fetches, ['net.fetch(API_URL,']);
  assert.match(up, /credentials: 'omit'/);
  assert.match(up, /async autoCheck\(\) \{\s*if \(!this\.settings\.get\('checkForUpdates'\)\) return;/);
  assert.strictEqual(require('../src/settings').SCHEMA.checkForUpdates.default, false);
});

test('notifications are withheld while paused or locked', () => {
  assert.match(main, /permission === 'notifications' \? notificationsAllowed\(\) : true/);
  assert.match(main, /function notificationsAllowed\(\) \{\s*return !dnd\.isPaused\(\) && !\(lock && lock\.locked\);/);
});

test('while locked, DevTools and "open in browser" are disabled', () => {
  assert.match(main, /label: 'Toggle Developer Tools', [^\n]*enabled: !locked/);
  assert.match(main, /label: 'Open current page in browser', enabled: !locked/);
});

test('the only thing injected into the page is CSS', () => {
  assert.match(code('account-view.js'), /this\.wc\.insertCSS\(css\)/);
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
  const share = code('screen-share.js');
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
