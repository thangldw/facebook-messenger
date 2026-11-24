'use strict';

// Keeps the Facebook page alive: reconnects after network failures, reloads
// after renderer crashes or hangs, and shows the overlay while it does.

const { net, powerMonitor } = require('electron');

const ERR_ABORTED = -3; // navigation replaced by another one; not a failure
const RETRY_DELAYS = [3000, 5000, 10000, 20000, 30000];
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 2 * 60 * 1000;
const HANG_TIMEOUT_MS = 20 * 1000;

class Recovery {
  /**
   * @param {object} deps { webContents, overlay, startUrl() }
   */
  constructor({ webContents, overlay, startUrl }) {
    this.wc = webContents;
    this.overlay = overlay;
    this.startUrl = startUrl;
    this.failing = false;
    this.attempt = 0;
    this.retryTimer = null;
    this.hangTimer = null;
    this.crashes = [];

    // A failed load is followed by did-finish-load for Chromium's error page,
    // so success means "finished without a main-frame failure in this load".
    this.loadFailed = false;
    this.wc.on('did-start-loading', () => { this.loadFailed = false; });
    this.wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      this.loadFailed = true;
      this.onFailure(description);
    });
    this.wc.on('did-finish-load', () => { if (!this.loadFailed) this.onSuccess(); });

    this.wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      const now = Date.now();
      this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS).concat(now);
      if (this.crashes.length > MAX_CRASHES) {
        this.overlay.setLayer('crashed', {});
        return;
      }
      setTimeout(() => this.reload(), 1000);
    });

    this.wc.on('unresponsive', () => {
      clearTimeout(this.hangTimer);
      this.hangTimer = setTimeout(() => this.wc.forcefullyCrashRenderer(), HANG_TIMEOUT_MS);
    });
    this.wc.on('responsive', () => clearTimeout(this.hangTimer));

    powerMonitor.on('resume', () => { if (this.failing) this.retryNow(); });
  }

  onFailure(description) {
    this.failing = true;
    this.overlay.setLayer('offline', { status: net.isOnline() ? 'Retrying…' : 'Waiting for the network…', detail: description });
    this.schedule();
  }

  onSuccess() {
    clearTimeout(this.retryTimer);
    this.failing = false;
    this.attempt = 0;
    this.overlay.setLayer('offline', null);
    this.overlay.setLayer('crashed', null);
  }

  schedule() {
    clearTimeout(this.retryTimer);
    const delay = RETRY_DELAYS[Math.min(this.attempt, RETRY_DELAYS.length - 1)];
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      // Don't hammer the network while the OS says we're offline; check again soon.
      if (!net.isOnline()) { this.schedule(); return; }
      this.reload();
    }, delay);
  }

  reload() {
    if (this.wc.isDestroyed()) return;
    this.wc.loadURL(this.startUrl());
  }

  retryNow() {
    this.crashes = [];
    this.attempt = 0;
    this.overlay.setLayer('crashed', null);
    this.reload();
  }
}

module.exports = { Recovery };
