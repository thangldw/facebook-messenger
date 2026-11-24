'use strict';

// In-app updates: install detection (pure) and the helper scripts that swap the
// new version in, run for real against throwaway folders on the current OS.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { installInfo, MAC_HELPER, WIN_HELPER } = require('../src/self-update');
const { parseSums, releaseFileUrl } = require('../src/updater');

const yes = () => true;
const no = () => false;

test('install detection: macOS', () => {
  const exec = '/Users/me/Applications/Thrum.app/Contents/MacOS/Thrum';
  const mac = installInfo({ platform: 'darwin', arch: 'arm64', execPath: exec, exists: no, writable: yes });
  assert.strictEqual(mac.kind, 'mac');
  assert.strictEqual(mac.target, '/Users/me/Applications/Thrum.app');
  assert.strictEqual(mac.asset('0.4.0'), 'Thrum-0.4.0-mac-arm64.zip');
  assert.strictEqual(installInfo({ platform: 'darwin', arch: 'x64', execPath: exec, exists: no, writable: yes }).asset('1.2.3'), 'Thrum-1.2.3-mac-x64.zip');
  // Homebrew owns /Applications/Thrum.app when the cask is installed...
  const brewExec = '/Applications/Thrum.app/Contents/MacOS/Thrum';
  assert.strictEqual(installInfo({ platform: 'darwin', arch: 'arm64', execPath: brewExec, exists: (p) => p === '/opt/homebrew/Caskroom/thrum', writable: yes }).kind, 'brew');
  // ...but not a copy elsewhere.
  assert.strictEqual(installInfo({ platform: 'darwin', arch: 'arm64', execPath: exec, exists: yes, writable: yes }).kind, 'mac');
  assert.strictEqual(installInfo({ platform: 'darwin', arch: 'arm64', execPath: brewExec, exists: no, writable: no }).reason, 'not-writable');
  assert.strictEqual(installInfo({ platform: 'darwin', arch: 'arm64', execPath: exec, isPackaged: false }).kind, 'manual');
});

test('install detection: Windows zip vs setup.exe', () => {
  const exec = 'C:\\Users\\me\\AppData\\Local\\Programs\\Thrum\\Thrum.exe';
  const zip = installInfo({ platform: 'win32', arch: 'x64', execPath: exec, exists: no, writable: yes });
  assert.deepStrictEqual([zip.kind, zip.target, zip.asset('0.4.0')], ['win-zip', 'C:\\Users\\me\\AppData\\Local\\Programs\\Thrum', 'Thrum-0.4.0-win-x64.zip']);
  const setup = installInfo({ platform: 'win32', arch: 'arm64', execPath: exec, exists: (p) => p.endsWith('Uninstall Thrum.exe'), writable: yes });
  assert.deepStrictEqual([setup.kind, setup.asset('0.4.0')], ['win-setup', 'Thrum-0.4.0-win-arm64-setup.exe']);
  assert.strictEqual(installInfo({ platform: 'win32', arch: 'x64', execPath: 'C:\\Program Files\\Thrum\\Thrum.exe', exists: no, writable: no }).kind, 'manual');
});

test('install detection: Linux AppImage only', () => {
  const img = installInfo({ platform: 'linux', arch: 'x64', execPath: '/tmp/.mount_x/thrum', env: { APPIMAGE: '/home/me/Apps/Thrum.AppImage' }, writable: yes });
  assert.deepStrictEqual([img.kind, img.target, img.asset('0.4.0')], ['appimage', '/home/me/Apps/Thrum.AppImage', 'Thrum-0.4.0-linux-x86_64.AppImage']);
  assert.strictEqual(installInfo({ platform: 'linux', arch: 'x64', execPath: '/opt/Thrum/thrum', env: {}, writable: yes }).reason, 'package-manager');
});

test('release files: checksum list parsing and URL construction', () => {
  const sums = parseSums(`${'a'.repeat(64)}  Thrum-0.4.0-mac-arm64.zip\n${'b'.repeat(64)} *Thrum-0.4.0-win-x64.zip\r\njunk line\n`);
  assert.deepStrictEqual(sums, { 'Thrum-0.4.0-mac-arm64.zip': 'a'.repeat(64), 'Thrum-0.4.0-win-x64.zip': 'b'.repeat(64) });
  assert.strictEqual(releaseFileUrl('0.4.0', 'SHA256SUMS.txt'), 'https://github.com/thangldw/thrum/releases/download/v0.4.0/SHA256SUMS.txt');
});

// ---- helpers, for real

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thrum-helper-'));
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  return { root, work };
}

// A stand-in for the app process: the helper must wait until it has exited.
function fakeApp(ms) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore' });
  const exited = new Promise((r) => child.on('exit', () => r(Date.now())));
  return { pid: child.pid, exited };
}

const posix = process.platform !== 'win32';

// Async on purpose: spawnSync would block this process from reaping the fake
// app, which then lingers as a zombie that still looks alive to the helper.
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stderr, at: Date.now() }));
  });
}

test('macOS/Linux helper: waits for the app, swaps the bundle, cleans up', { skip: !posix }, async () => {
  const { root, work } = scratch();
  const target = path.join(root, 'Thrum.app');
  const source = path.join(work, 'Thrum.app');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'version'), 'old');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'version'), 'new');
  const script = path.join(root, 'update.sh');
  fs.writeFileSync(script, MAC_HELPER);
  const app = fakeApp(1500);
  const r = await run('/bin/sh', [script, String(app.pid), source, target, work, '0']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.at >= await app.exited, 'swapped only after the app exited');
  assert.strictEqual(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(`${target}.previous-version`));
  assert.ok(!fs.existsSync(work), 'work folder removed');
});

test('macOS/Linux helper: keeps the old version if the new one is missing', { skip: !posix }, async () => {
  const { root, work } = scratch();
  const target = path.join(root, 'Thrum.app');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'version'), 'old');
  const script = path.join(root, 'update.sh');
  fs.writeFileSync(script, MAC_HELPER);
  await run('/bin/sh', [script, '999999', path.join(work, 'missing.app'), target, work, '0']);
  assert.strictEqual(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'old');
  assert.ok(!fs.existsSync(`${target}.previous-version`));
});

function runWinHelper(args) {
  const { root } = args;
  const script = path.join(root, 'update.ps1');
  fs.writeFileSync(script, WIN_HELPER);
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-AppPid', String(args.pid), '-Kind', 'win-zip', '-Source', args.source, '-Target', args.target, '-Work', args.work, '-Relaunch', '0']);
}

test('Windows helper: waits for the app, replaces the folder, cleans up', { skip: posix }, async () => {
  const { root, work } = scratch();
  const target = path.join(root, 'Thrum');
  const source = path.join(work, 'extract');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'Thrum.exe'), 'old');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'Thrum.exe'), 'new');
  const app = fakeApp(1500);
  const r = await runWinHelper({ root, work, source, target, pid: app.pid });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.at >= await app.exited, 'replaced only after the app exited');
  assert.strictEqual(fs.readFileSync(path.join(target, 'Thrum.exe'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(`${target}.previous-version`));
  assert.ok(!fs.existsSync(work), 'work folder removed');
});

test('Windows helper: keeps the old version if the new one is missing', { skip: posix }, async () => {
  const { root, work } = scratch();
  const target = path.join(root, 'Thrum');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'Thrum.exe'), 'old');
  await runWinHelper({ root, work, source: path.join(work, 'missing'), target, pid: 999999 });
  assert.strictEqual(fs.readFileSync(path.join(target, 'Thrum.exe'), 'utf8'), 'old');
  assert.ok(!fs.existsSync(`${target}.previous-version`));
});
