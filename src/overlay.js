'use strict';

// A local page (src/ui/overlay.html) layered over the Facebook page for the
// lock screen, password setup and connection/crash recovery.
//
// This is the only page in the app with a preload script and IPC. Facebook's
// pages never get either. IPC requests are accepted only from this view's own
// webContents and only for the actions listed in ACTIONS.

const { WebContentsView, ipcMain } = require('electron');
const path = require('path');

// Highest priority first: a locked app never reveals anything else.
const LAYERS = ['lock', 'setup', 'crashed', 'offline'];
// webContents of the app's own pages, which the Facebook navigation guards skip
// (they would otherwise treat the local file as a foreign page and close it).
const appPages = new WeakSet();
const isAppPage = (wc) => appPages.has(wc);
const ACTIONS = new Set(['getState', 'unlock', 'touchId', 'setPassword', 'cancel', 'retry', 'reset']);

class Overlay {
  /**
   * @param {BrowserWindow} win
   * @param {Record<string, Function>} handlers  action name -> async (payload) => result
   */
  constructor(win, handlers) {
    this.win = win;
    this.handlers = handlers;
    this.layers = new Map();
    this.attached = false;

    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'ui', 'overlay-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.view.setBackgroundColor('#111214');
    const wc = this.view.webContents;
    appPages.add(wc);
    // The overlay never navigates or opens windows.
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-finish-load', () => this.push());
    wc.loadFile(path.join(__dirname, 'ui', 'overlay.html'));

    win.on('resize', () => this.layout());

    this.ipcListener = async (event, action, payload) => {
      if (event.sender !== wc || !ACTIONS.has(action)) throw new Error('Rejected');
      if (action === 'getState') return this.state();
      const fn = this.handlers[action];
      return fn ? fn(payload) : null;
    };
    ipcMain.handle('overlay', this.ipcListener);
  }

  get visible() {
    return this.attached;
  }

  top() {
    return LAYERS.find((name) => this.layers.has(name)) ?? null;
  }

  state() {
    const name = this.top();
    return name ? { mode: name, ...this.layers.get(name) } : { mode: null };
  }

  setLayer(name, data) {
    if (!LAYERS.includes(name)) throw new Error(`Unknown overlay layer ${name}`);
    if (data) this.layers.set(name, data); else this.layers.delete(name);
    this.update();
  }

  has(name) {
    return this.layers.has(name);
  }

  update() {
    const show = this.top() !== null;
    if (show && !this.attached) {
      this.win.contentView.addChildView(this.view);
      this.attached = true;
      this.layout();
    } else if (!show && this.attached) {
      this.win.contentView.removeChildView(this.view);
      this.attached = false;
      this.win.webContents.focus();
    }
    this.push();
    if (show && this.win.isFocused()) this.view.webContents.focus();
  }

  layout() {
    if (!this.attached) return;
    const [width, height] = this.win.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  push() {
    const wc = this.view.webContents;
    if (wc && !wc.isDestroyed()) wc.send('overlay:state', this.state());
  }

  focus() {
    if (this.attached) this.view.webContents.focus();
  }

  destroy() {
    ipcMain.removeHandler('overlay');
    const wc = this.view.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
  }
}

module.exports = { Overlay, isAppPage, LAYERS, ACTIONS };
