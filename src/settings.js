'use strict';

// User settings and small app state, persisted as JSON in userData.
// Every value read from disk is validated against SCHEMA, so an edited or
// corrupted file can only ever yield known keys of the expected type.

const fs = require('fs');
const path = require('path');

const LOCK_MINUTES = [1, 5, 15, 60];

const SCHEMA = {
  hideTopBar: { type: 'boolean', default: true },
  runInBackground: { type: 'boolean', default: true },
  openAtLogin: { type: 'boolean', default: false },
  globalShortcut: { type: 'boolean', default: true },
  privacyScreen: { type: 'boolean', default: false },
  restoreLastChat: { type: 'boolean', default: true },
  ephemeral: { type: 'boolean', default: false },
  checkForUpdates: { type: 'boolean', default: false },
  // 0 = notifications on, -1 = paused until resumed, otherwise epoch ms.
  dndUntil: { type: 'number', default: 0, valid: (v) => v === -1 || v >= 0 },
  lockEnabled: { type: 'boolean', default: false },
  lockAfterMinutes: { type: 'number', default: 5, valid: (v) => LOCK_MINUTES.includes(v) },
  lockSalt: { type: 'string', default: '', valid: (v) => v === '' || /^[0-9a-f]{32}$/.test(v) },
  lockHash: { type: 'string', default: '', valid: (v) => v === '' || /^[0-9a-f]{128}$/.test(v) },
  // Path of the last opened conversation, e.g. /messages/t/123.
  lastChat: { type: 'string', default: '', valid: (v) => v === '' || isChatPath(v) },
  lastUpdateCheck: { type: 'number', default: 0, valid: (v) => v >= 0 },
  trayHintShown: { type: 'boolean', default: false },
  bounds: { type: 'object', default: null, valid: isBounds },
};

function isChatPath(p) {
  return typeof p === 'string' && /^\/messages\/(e2ee\/)?t\/[A-Za-z0-9_.-]{1,64}\/?$/.test(p);
}

function isBounds(b) {
  return b !== null && typeof b === 'object'
    && ['width', 'height'].every((k) => Number.isFinite(b[k]) && b[k] >= 200 && b[k] <= 10000)
    && ['x', 'y'].every((k) => b[k] === undefined || (Number.isFinite(b[k]) && Math.abs(b[k]) <= 100000));
}

function sanitize(raw) {
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMA)) {
    const v = raw && Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
    const typeOk = spec.type === 'object' ? (v === null || typeof v === 'object') : typeof v === spec.type;
    out[key] = v !== undefined && typeOk && (!spec.valid || spec.valid(v)) ? cloneValue(v) : spec.default;
  }
  if (out.bounds) {
    const { x, y, width, height } = out.bounds;
    out.bounds = { width: Math.round(width), height: Math.round(height) };
    if (x !== undefined && y !== undefined) Object.assign(out.bounds, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

function cloneValue(v) {
  return v && typeof v === 'object' ? { ...v } : v;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run or unreadable */ }
    // Migrate v0.1 files: prefs.json (hideTopBar) and window-state.json (bounds).
    if (!fs.existsSync(this.file)) {
      try { raw = { ...JSON.parse(fs.readFileSync(path.join(dir, 'prefs.json'), 'utf8')) }; } catch { /* none */ }
      try { raw.bounds = JSON.parse(fs.readFileSync(path.join(dir, 'window-state.json'), 'utf8')); } catch { /* none */ }
    }
    this.values = sanitize(raw);
  }

  get(key) {
    if (!(key in SCHEMA)) throw new Error(`Unknown setting: ${key}`);
    return this.values[key];
  }

  set(key, value) {
    if (!(key in SCHEMA)) throw new Error(`Unknown setting: ${key}`);
    const next = sanitize({ ...this.values, [key]: value });
    if (next[key] !== value && !(SCHEMA[key].type === 'object' && value !== null)) {
      throw new Error(`Invalid value for ${key}`);
    }
    this.values = next;
    this.save();
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.values, null, 1), { mode: 0o600 }); } catch { /* non-critical */ }
  }
}

module.exports = { Settings, sanitize, isChatPath, LOCK_MINUTES, SCHEMA };
