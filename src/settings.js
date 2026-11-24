'use strict';

// User settings and small app state, persisted as JSON in userData.
// Every value read from disk is validated against SCHEMA, so an edited or
// corrupted file can only ever yield known keys of the expected shape.

const fs = require('fs');
const path = require('path');
const { normalizeRules } = require('./focus');

const LOCK_MINUTES = [1, 5, 15, 60];
const MAX_ACCOUNTS = 9;
const ACCOUNT_ID = /^[a-z0-9]{1,16}$/;

function isChatPath(p) {
  return typeof p === 'string' && /^\/messages\/(e2ee\/)?t\/[A-Za-z0-9_.-]{1,64}\/?$/.test(p);
}

function cleanName(name) {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const n = name.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, 40);
  return n.length > 0 ? n : null;
}

const bool = (def) => ({ default: def, parse: (v) => (typeof v === 'boolean' ? v : undefined) });
const num = (def, ok) => ({ default: def, parse: (v) => (typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : undefined) });
const hex = (len) => ({ default: '', parse: (v) => (v === '' || (typeof v === 'string' && new RegExp(`^[0-9a-f]{${len}}$`).test(v)) ? v : undefined) });

const SCHEMA = {
  hideTopBar: bool(true),
  runInBackground: bool(true),
  openAtLogin: bool(false),
  globalShortcut: bool(true),
  privacyScreen: bool(false),
  restoreLastChat: bool(true),
  ephemeral: bool(false),
  checkForUpdates: bool(false),
  trayHintShown: bool(false),
  // 0 = notifications on, -1 = paused until resumed, otherwise epoch ms.
  dndUntil: num(0, (v) => v === -1 || v >= 0),
  focusEnabled: bool(false),
  focusRules: {
    default: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }],
    parse: (v) => normalizeRules(v) ?? undefined,
  },
  // "Resume" during a focus period turns notifications on until this time.
  focusOverrideUntil: num(0, (v) => v >= 0),
  lockEnabled: bool(false),
  lockAfterMinutes: num(5, (v) => LOCK_MINUTES.includes(v)),
  lockSalt: hex(32),
  lockHash: hex(128),
  // Wrong-password throttle (password.js), kept across restarts.
  lockFailures: num(0, (v) => Number.isInteger(v) && v >= 0),
  lockBlockedUntil: num(0, (v) => v >= 0),
  lastUpdateCheck: num(0, (v) => v >= 0),
  accounts: {
    default: [{ id: 'default', name: 'Account 1' }],
    parse: (v) => {
      if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ACCOUNTS) return undefined;
      const out = [];
      for (const a of v) {
        const name = a && cleanName(a.name);
        if (!a || !ACCOUNT_ID.test(a.id) || !name || out.some((o) => o.id === a.id)) return undefined;
        out.push({ id: a.id, name });
      }
      return out;
    },
  },
  activeAccount: { default: 'default', parse: (v) => (typeof v === 'string' && ACCOUNT_ID.test(v) ? v : undefined) },
  // Path of the last opened conversation per account, e.g. /messages/t/123.
  lastChats: {
    default: {},
    parse: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const out = {};
      for (const [id, p] of Object.entries(v)) if (ACCOUNT_ID.test(id) && isChatPath(p)) out[id] = p;
      return out;
    },
  },
  bounds: {
    default: null,
    parse: (b) => {
      if (b === null || typeof b !== 'object') return undefined;
      const ok = (k, lo, hi) => Number.isFinite(b[k]) && b[k] >= lo && b[k] <= hi;
      if (!ok('width', 200, 10000) || !ok('height', 200, 10000)) return undefined;
      const out = { width: Math.round(b.width), height: Math.round(b.height) };
      if (ok('x', -100000, 100000) && ok('y', -100000, 100000)) Object.assign(out, { x: Math.round(b.x), y: Math.round(b.y) });
      return out;
    },
  },
};

const clone = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));

function sanitize(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMA)) {
    const v = Object.prototype.hasOwnProperty.call(src, key) ? spec.parse(src[key]) : undefined;
    out[key] = v === undefined ? clone(spec.default) : v;
  }
  // Cross-field rules.
  const ids = out.accounts.map((a) => a.id);
  if (!ids.includes(out.activeAccount)) out.activeAccount = ids[0];
  for (const id of Object.keys(out.lastChats)) if (!ids.includes(id)) delete out.lastChats[id];
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run or unreadable */ }
    if (!fs.existsSync(this.file)) {
      // Migrate v0.1 files: prefs.json (hideTopBar) and window-state.json (bounds).
      try { raw = { ...JSON.parse(fs.readFileSync(path.join(dir, 'prefs.json'), 'utf8')) }; } catch { /* none */ }
      try { raw.bounds = JSON.parse(fs.readFileSync(path.join(dir, 'window-state.json'), 'utf8')); } catch { /* none */ }
    }
    // Migrate the single-account lastChat of early 0.2 builds.
    if (raw && typeof raw === 'object' && isChatPath(raw.lastChat) && !raw.lastChats) raw.lastChats = { default: raw.lastChat };
    this.values = sanitize(raw);
  }

  get(key) {
    if (!(key in SCHEMA)) throw new Error(`Unknown setting: ${key}`);
    return clone(this.values[key]);
  }

  set(key, value) {
    if (!(key in SCHEMA)) throw new Error(`Unknown setting: ${key}`);
    if (SCHEMA[key].parse(value) === undefined) throw new Error(`Invalid value for ${key}`);
    this.values = sanitize({ ...this.values, [key]: value });
    this.save();
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.values, null, 1), { mode: 0o600 }); } catch { /* non-critical */ }
  }
}

module.exports = { Settings, sanitize, isChatPath, cleanName, LOCK_MINUTES, MAX_ACCOUNTS, ACCOUNT_ID, SCHEMA };
