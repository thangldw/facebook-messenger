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
  assert.ok(up.includes("const API_URL = 'https://api.github.com/repos/thangldw/thrum/releases/latest';"));
  const fetches = up.match(/net\.fetch\(([^,]+),/g) || [];
  assert.deepStrictEqual(fetches, ['net.fetch(API_URL,'], 'the release check');
  assert.match(up, /credentials: 'omit'/);
  const requests = up.match(/net\.request\(\{[^}]*\}\)/g) || [];
  assert.deepStrictEqual(requests, ["net.request({ url, redirect: 'manual', useSessionCookies: false, cache: 'no-store' })"], 'release downloads, without cookies');
  // Downloads: this repository's releases only, every redirect hop checked, checksum before use.
  assert.ok(up.includes("const DOWNLOAD_BASE = 'https://github.com/thangldw/thrum/releases/download/';"));
  assert.match(up, /if \(!allowedDownloadUrl\(url\)\) \{ reject\(new Error\('Download left GitHub'\)\); return; \}\s*const req = net\.request\(/);
  assert.match(up, /if \(hops > MAX_REDIRECTS \|\| !allowedDownloadUrl\(next\)\) \{\s*req\.abort\(\);/);
  assert.match(up, /if \(hash\.digest\('hex'\) !== expected\) throw/);
  const { allowedDownloadUrl, releaseFileUrl } = require('../src/updater');
  assert.ok(allowedDownloadUrl('https://objects.githubusercontent.com/x'));
  for (const bad of ['http://github.com/x', 'https://evil.com/x', 'https://github.com.evil.com/x', 'file:///etc/passwd']) assert.ok(!allowedDownloadUrl(bad), bad);
  assert.throws(() => releaseFileUrl('0.4.0', '../../evil'));
  assert.throws(() => releaseFileUrl('latest', 'SHA256SUMS.txt'));
  // Installing happens only after the user clicks "Update now", never from the automatic check.
  assert.doesNotMatch(main, /onUpdateAvailable[^}]*installUpdate/);
  assert.match(main, /if \(response === 0\) installUpdate\(release\);/);
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

test('popups: shown only after their opener is checked, hidden while locked', () => {
  // A popup starts as about:blank and its opener can write anything into it.
  assert.match(main, /overrideBrowserWindowOptions: \{\s*show: false,/);
  assert.match(main, /wc\.on\('did-create-window'[^]*?if \(opener && !isFacebookUrl\(opener\.origin\)\) \{ win\.destroy\(\); return; \}/);
  // The lock covers popups: nothing opens while locked, open ones are hidden.
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{\s*if \(lock && lock\.locked\) return \{ action: 'deny' \};/);
  const vis = main.slice(main.indexOf('function applyVisibility('), main.indexOf('function switchAccount('));
  assert.match(vis, /for \(const win of popups\)[^]*?win\.hide\(\)/);
  assert.match(main, /win\.on\('show', \(\) => \{ if \(lock && lock\.locked\)/);
});

test('release builds do not fetch packages from npm on the fly', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.doesNotMatch(wf, /npx (--yes|-y)\b/);
  assert.strictEqual(pkg.devDependencies['@electron/fuses'], '1.8.0');
});

test('permissions and screen capture are limited to Facebook origins', () => {
  assert.match(main, /setPermissionRequestHandler\([^]*?isFacebookUrl\(details\.requestingUrl\)/);
  assert.match(main, /setPermissionCheckHandler\([^]*?isFacebookUrl\(requestingOrigin\)/);
  const share = code('screen-share.js');
  assert.match(share, /isFacebookUrl\(request\.securityOrigin\)/);
});

test('the session (user agent, permissions) is configured before an account view is created', () => {
  const fn = main.slice(main.indexOf('function addAccountView('));
  assert.ok(fn.indexOf('configureSession(') > 0 && fn.indexOf('configureSession(') < fn.indexOf('new AccountView('));
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
