'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { sanitize, isChatPath, Settings } = require('../src/settings');
const { hashPassword, verifyPassword, Throttle } = require('../src/password');

// updater.js and dnd.js import electron only for runtime objects; stub it.
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { app: { getVersion: () => '0.2.0' }, net: {} };
  return realLoad.call(this, request, ...rest);
};
const { isNewer, parseRelease } = require('../src/updater');
const { Dnd, nextMorning } = require('../src/dnd');
Module._load = realLoad;

// ---- settings

test('settings: defaults for empty or garbage input', () => {
  for (const raw of [undefined, null, 42, 'x', [], {}]) {
    const s = sanitize(raw);
    assert.strictEqual(s.hideTopBar, true);
    assert.strictEqual(s.checkForUpdates, false, 'update checks must default to off');
    assert.strictEqual(s.lockEnabled, false);
    assert.strictEqual(s.bounds, null);
  }
});

test('settings: unknown keys are dropped, wrong types fall back to defaults', () => {
  const s = sanitize({ webPreferences: { nodeIntegration: true }, preload: '/tmp/x.js', hideTopBar: 'no', dndUntil: -5, lockAfterMinutes: 7 });
  assert.ok(!('webPreferences' in s) && !('preload' in s));
  assert.strictEqual(s.hideTopBar, true);
  assert.strictEqual(s.dndUntil, 0);
  assert.strictEqual(s.lockAfterMinutes, 5);
});

test('settings: bounds only carry numeric geometry', () => {
  const s = sanitize({ bounds: { x: 10.4, y: 20, width: 900, height: 700, webPreferences: { sandbox: false } } });
  assert.deepStrictEqual(s.bounds, { x: 10, y: 20, width: 900, height: 700 });
  assert.strictEqual(sanitize({ bounds: { width: 50, height: 700 } }).bounds, null);
  assert.strictEqual(sanitize({ bounds: { width: 'big', height: 700 } }).bounds, null);
});

test('settings: lock hash fields must be well-formed hex', () => {
  assert.strictEqual(sanitize({ lockHash: 'nothex' }).lockHash, '');
  assert.strictEqual(sanitize({ lockSalt: 'a'.repeat(32) }).lockSalt, 'a'.repeat(32));
});

test('settings: last chat must be a conversation path', () => {
  assert.ok(isChatPath('/messages/t/1234567890'));
  assert.ok(isChatPath('/messages/e2ee/t/7034/'));
  for (const p of ['/messages/', '/profile.php', 'https://evil.example/messages/t/1', '/messages/t/../../x', '/messages/t/a b', '//evil.example/messages/t/1']) {
    assert.ok(!isChatPath(p), p);
  }
});

test('settings: persist, reload, migrate v0.1 files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-settings-'));
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({ hideTopBar: false }));
  fs.writeFileSync(path.join(dir, 'window-state.json'), JSON.stringify({ x: 5, y: 6, width: 1000, height: 800 }));
  const a = new Settings(dir);
  assert.strictEqual(a.get('hideTopBar'), false);
  assert.deepStrictEqual(a.get('bounds'), { x: 5, y: 6, width: 1000, height: 800 });
  a.set('dndUntil', -1);
  const b = new Settings(dir);
  assert.strictEqual(b.get('dndUntil'), -1);
  assert.throws(() => b.set('nope', 1));
  assert.throws(() => b.set('lockAfterMinutes', 7));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'settings.json')).mode & 0o777, 0o600);
});

// ---- password

test('password: hash verifies, wrong password does not, hash is salted', () => {
  const a = hashPassword('correct horse');
  const b = hashPassword('correct horse');
  assert.notStrictEqual(a.hash, b.hash, 'same password must hash differently (salt)');
  assert.ok(verifyPassword('correct horse', a.salt, a.hash));
  assert.ok(!verifyPassword('correct horsE', a.salt, a.hash));
  assert.ok(!verifyPassword('', a.salt, a.hash));
  assert.ok(!verifyPassword('x', '', ''));
  assert.match(a.hash, /^[0-9a-f]{128}$/);
  assert.match(a.salt, /^[0-9a-f]{32}$/);
});

test('password: too short or too long is rejected', () => {
  assert.throws(() => hashPassword('abc'));
  assert.throws(() => hashPassword('x'.repeat(257)));
});

test('password: throttle after 5 failures, growing, reset on success', () => {
  let now = 0;
  const t = new Throttle(() => now);
  for (let i = 0; i < 4; i += 1) t.fail();
  assert.strictEqual(t.waitMs(), 0);
  t.fail();
  assert.strictEqual(t.waitMs(), 30000);
  t.fail();
  assert.strictEqual(t.waitMs(), 60000);
  now += 60000;
  assert.strictEqual(t.waitMs(), 0);
  t.succeed();
  t.fail();
  assert.strictEqual(t.waitMs(), 0);
});

// ---- do not disturb

function memSettings(init = {}) {
  const v = { dndUntil: 0, ...init };
  return { get: (k) => v[k], set: (k, x) => { v[k] = x; } };
}

test('dnd: pause for a duration, indefinitely, resume', () => {
  let now = 1_000_000;
  const changes = [];
  const d = new Dnd({ settings: memSettings(), onChange: () => changes.push(1), now: () => now });
  assert.ok(!d.isPaused());
  d.pauseFor(3600000);
  assert.ok(d.isPaused());
  now += 3600001;
  assert.ok(!d.isPaused(), 'timed pause ends by itself');
  d.pauseIndefinitely();
  assert.ok(d.isPaused());
  d.resume();
  assert.ok(!d.isPaused());
  assert.ok(changes.length >= 3);
  clearTimeout(d.timer);
});

test('dnd: next morning is 08:00 local, today or tomorrow', () => {
  const early = new Date(2026, 10, 24, 6, 0);
  const late = new Date(2026, 10, 24, 22, 0);
  assert.strictEqual(new Date(nextMorning(early)).getDate(), 24);
  assert.strictEqual(new Date(nextMorning(late)).getDate(), 25);
  assert.strictEqual(new Date(nextMorning(late)).getHours(), 8);
});

// ---- updater

test('updater: version comparison', () => {
  assert.ok(isNewer('0.2.1', '0.2.0'));
  assert.ok(isNewer('v1.0.0', '0.9.9'));
  assert.ok(!isNewer('0.2.0', '0.2.0'));
  assert.ok(!isNewer('0.1.9', '0.2.0'));
  assert.ok(!isNewer('garbage', '0.2.0'));
});

test('updater: only well-formed releases from this repo are accepted', () => {
  const good = { tag_name: 'v0.3.0', html_url: 'https://github.com/thangldw/facebook-messenger/releases/tag/v0.3.0' };
  assert.deepStrictEqual(parseRelease(good), { version: '0.3.0', url: good.html_url });
  assert.strictEqual(parseRelease({ ...good, html_url: 'https://evil.example/download' }), null);
  assert.strictEqual(parseRelease({ ...good, html_url: 'https://github.com/someone-else/facebook-messenger/releases/x' }), null);
  assert.strictEqual(parseRelease({ ...good, tag_name: 'v0.3.0; rm -rf /' }), null);
  assert.strictEqual(parseRelease(null), null);
});
