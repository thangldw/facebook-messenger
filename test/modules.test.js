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
  assert.throws(() => hashPassword('abcde'));
  assert.doesNotThrow(() => hashPassword('abcdef'));
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

test('password: an existing shorter password (old 4-character minimum) still verifies', () => {
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync('abcd', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  assert.ok(verifyPassword('abcd', salt.toString('hex'), hash.toString('hex')));
});

test('password: throttle state survives a restart through its store, capped after a clock change', () => {
  let now = 0;
  let saved = { failures: 0, blockedUntil: 0 };
  const store = { load: () => saved, save: (s) => { saved = s; } };
  const t = new Throttle(() => now, store);
  for (let i = 0; i < 5; i += 1) t.fail();
  assert.deepStrictEqual(saved, { failures: 5, blockedUntil: 30000 });
  const restarted = new Throttle(() => now, store);
  assert.strictEqual(restarted.waitMs(), 30000);
  restarted.fail();
  assert.strictEqual(restarted.waitMs(), 60000);
  now = -1e9; // clock moved far back
  assert.strictEqual(restarted.waitMs(), 300000);
  restarted.succeed();
  assert.deepStrictEqual(saved, { failures: 0, blockedUntil: 0 });
});

// ---- do not disturb

function memSettings(init = {}) {
  const v = { dndUntil: 0, focusEnabled: false, focusRules: [], focusOverrideUntil: 0, ...init };
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
  clearTimeout(d.timer); clearInterval(d.ticker);
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
  const good = { tag_name: 'v0.3.0', html_url: 'https://github.com/thangldw/thrum/releases/tag/v0.3.0' };
  assert.deepStrictEqual(parseRelease(good), { version: '0.3.0', url: good.html_url });
  assert.strictEqual(parseRelease({ ...good, html_url: 'https://evil.example/download' }), null);
  assert.strictEqual(parseRelease({ ...good, html_url: 'https://github.com/someone-else/facebook-messenger/releases/x' }), null);
  assert.strictEqual(parseRelease({ ...good, tag_name: 'v0.3.0; rm -rf /' }), null);
  assert.strictEqual(parseRelease(null), null);
});

// ---- focus schedule

const { focusEnd, normalizeRules } = require('../src/focus');

test('focus: weekday office hours', () => {
  const rules = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }];
  const mon = (h, m = 0) => new Date(2026, 10, 23, h, m); // Mon 23 Nov 2026
  assert.strictEqual(focusEnd(rules, mon(8, 59)), null);
  assert.strictEqual(focusEnd(rules, mon(9, 0)), new Date(2026, 10, 23, 18, 0).getTime());
  assert.strictEqual(focusEnd(rules, mon(17, 59)), new Date(2026, 10, 23, 18, 0).getTime());
  assert.strictEqual(focusEnd(rules, mon(18, 0)), null, 'end time is exclusive');
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 22, 10, 0)), null, 'Sunday is off');
});

test('focus: overnight range belongs to the day it starts', () => {
  const rules = [{ days: [5], start: '22:00', end: '07:00' }]; // Friday night
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 27, 23, 0)), new Date(2026, 10, 28, 7, 0).getTime());
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 28, 6, 59)), new Date(2026, 10, 28, 7, 0).getTime(), 'Saturday morning');
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 28, 7, 0)), null);
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 27, 6, 0)), null, 'Friday morning belongs to Thursday');
});

test('focus: overlapping ranges extend to the latest end', () => {
  const rules = [{ days: [1], start: '09:00', end: '12:00' }, { days: [1], start: '11:00', end: '14:00' }];
  assert.strictEqual(focusEnd(rules, new Date(2026, 10, 23, 11, 30)), new Date(2026, 10, 23, 14, 0).getTime());
});

test('focus: rules are validated', () => {
  assert.deepStrictEqual(normalizeRules([{ days: [5, 1, 1], start: '09:00', end: '17:30' }]), [{ days: [1, 5], start: '09:00', end: '17:30' }]);
  for (const bad of [[{ days: [], start: '09:00', end: '10:00' }], [{ days: [1], start: '9:00', end: '10:00' }], [{ days: [1], start: '10:00', end: '10:00' }], [{ days: [7], start: '09:00', end: '10:00' }], 'x', [null]]) {
    assert.strictEqual(normalizeRules(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(normalizeRules(Array(20).fill({ days: [1], start: '09:00', end: '10:00' })).length, 10);
});

test('dnd: focus schedule pauses; resume lasts until the period ends; manual pause wins', () => {
  let now = new Date(2026, 10, 23, 10, 0).getTime(); // Monday 10:00
  const s = memSettings({ focusEnabled: true, focusRules: [{ days: [1], start: '09:00', end: '18:00' }], focusOverrideUntil: 0 });
  const d = new Dnd({ settings: s, onChange: () => {}, now: () => now });
  assert.ok(d.isPaused(), 'in focus period');
  assert.match(d.label(), /^Focus time until/);
  d.resume();
  assert.ok(!d.isPaused(), 'resumed for the rest of the period');
  d.pauseFor(HOUR_MS);
  assert.ok(d.isPaused(), 'manual pause still applies');
  d.resume();
  now = new Date(2026, 10, 24, 10, 0).getTime(); // Tuesday: rule is Monday only
  assert.ok(!d.isPaused());
  now = new Date(2026, 10, 30, 10, 0).getTime(); // next Monday: override has expired
  assert.ok(d.isPaused(), 'next period pauses again');
  s.set('focusEnabled', false);
  assert.ok(!d.isPaused());
  clearInterval(d.ticker); clearTimeout(d.timer);
});
const HOUR_MS = 3600000;

// ---- accounts in settings

test('settings: accounts are validated and the active account must exist', () => {
  const s = sanitize({
    accounts: [{ id: 'default', name: ' Personal‮ ' }, { id: 'ab12', name: 'Work' }],
    activeAccount: 'zz99',
    lastChats: { default: '/messages/t/1', ab12: 'https://evil.example', ghost: '/messages/t/2' },
  });
  assert.deepStrictEqual(s.accounts, [{ id: 'default', name: 'Personal' }, { id: 'ab12', name: 'Work' }]);
  assert.strictEqual(s.activeAccount, 'default', 'unknown active account falls back to the first');
  assert.deepStrictEqual(s.lastChats, { default: '/messages/t/1' });
  for (const bad of [[], [{ id: 'A!', name: 'x' }], [{ id: 'a', name: '' }], [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }], Array(10).fill(0).map((_, i) => ({ id: `a${i}`, name: 'x' }))]) {
    assert.deepStrictEqual(sanitize({ accounts: bad }).accounts, [{ id: 'default', name: 'Account 1' }], JSON.stringify(bad));
  }
});

test('settings: v0.2 single lastChat migrates to the default account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-mig-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ lastChat: '/messages/t/42' }));
  assert.deepStrictEqual(new Settings(dir).get('lastChats'), { default: '/messages/t/42' });
});
