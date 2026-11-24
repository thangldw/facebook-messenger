'use strict';

// App lock: password (and Touch ID on macOS) required to see the app.
// Locks on launch, when the computer is locked or goes to sleep, and after
// N minutes without keyboard/mouse input.

const { powerMonitor, systemPreferences } = require('electron');
const { hashPassword, verifyPassword, isAcceptable, Throttle, MIN_LENGTH } = require('./password');

class AppLock {
  /**
   * @param {object} deps { settings, overlay, onChange() }
   */
  constructor({ settings, overlay, onChange }) {
    this.settings = settings;
    this.overlay = overlay;
    this.onChange = onChange;
    this.locked = false;
    this.throttle = new Throttle();

    const lockIfEnabled = () => this.lock();
    powerMonitor.on('lock-screen', lockIfEnabled);
    powerMonitor.on('suspend', lockIfEnabled);
    this.idleTimer = setInterval(() => this.checkIdle(), 30 * 1000);
  }

  get enabled() {
    return this.settings.get('lockEnabled') && Boolean(this.settings.get('lockHash'));
  }

  touchIdAvailable() {
    return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
  }

  checkIdle() {
    if (!this.enabled || this.locked) return;
    if (powerMonitor.getSystemIdleTime() >= this.settings.get('lockAfterMinutes') * 60) this.lock();
  }

  lock() {
    if (!this.enabled || this.locked) return;
    this.locked = true;
    this.overlay.setLayer('lock', { touchId: this.touchIdAvailable() });
    this.onChange();
  }

  unlockNow() {
    this.locked = false;
    this.throttle.succeed();
    this.overlay.setLayer('lock', null);
    this.onChange();
  }

  async tryPassword(password) {
    if (!this.locked) return { ok: true };
    const wait = this.throttle.waitMs();
    if (wait > 0) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s.` };
    if (verifyPassword(password, this.settings.get('lockSalt'), this.settings.get('lockHash'))) {
      this.unlockNow();
      return { ok: true };
    }
    this.throttle.fail();
    return { ok: false, error: 'Wrong password.' };
  }

  async tryTouchId() {
    if (!this.locked || !this.touchIdAvailable()) return { ok: false };
    try {
      await systemPreferences.promptTouchID('unlock Thrum');
      this.unlockNow();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Setup: shows the password form; finishSetup() turns the lock on.
  startSetup() {
    if (this.locked) return;
    this.overlay.setLayer('setup', {});
  }

  async finishSetup(password) {
    if (!this.overlay.has('setup')) return { ok: false };
    if (!isAcceptable(password)) return { ok: false, error: `Use at least ${MIN_LENGTH} characters.` };
    const { salt, hash } = hashPassword(password);
    this.settings.set('lockSalt', salt);
    this.settings.set('lockHash', hash);
    this.settings.set('lockEnabled', true);
    this.overlay.setLayer('setup', null);
    this.onChange();
    return { ok: true };
  }

  cancelSetup() {
    this.overlay.setLayer('setup', null);
  }

  // Only reachable from the menu while unlocked, or through a full reset.
  disable() {
    this.settings.set('lockEnabled', false);
    this.settings.set('lockSalt', '');
    this.settings.set('lockHash', '');
    if (this.locked) this.unlockNow(); else this.onChange();
  }
}

module.exports = { AppLock };
