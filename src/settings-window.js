'use strict';

// The app's settings window (accounts, focus schedule): a local page with its
// own preload. Like the overlay, its IPC channel accepts requests only from
// this window's webContents and only for the actions listed in ACTIONS.
// Facebook's pages never get a preload or IPC.

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { registerAppPage } = require('./app-pages');

const ACTIONS = new Set(['getState', 'addAccount', 'renameAccount', 'removeAccount', 'setFocus']);

class SettingsWindow {
  /**
   * @param {object} opts { getState(), handlers: { addAccount(), renameAccount(p), removeAccount(p), setFocus(p) } }
   */
  constructor({ getState, handlers }) {
    this.getState = getState;
    this.handlers = handlers;
    this.win = null;
    ipcMain.handle('settings-ui', async (event, action, payload) => {
      if (!this.win || this.win.isDestroyed() || event.sender !== this.win.webContents || !ACTIONS.has(action)) {
        throw new Error('Rejected');
      }
      if (action === 'getState') return this.getState();
      const result = await this.handlers[action](payload);
      this.push();
      return result;
    });
  }

  open(parent, section) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      this.win.webContents.send('settings:section', section || null);
      return;
    }
    this.win = new BrowserWindow({
      width: 560,
      height: 680,
      minWidth: 420,
      minHeight: 400,
      title: 'Messenger Lite Settings',
      backgroundColor: '#111214',
      autoHideMenuBar: true,
      parent: process.platform === 'darwin' ? undefined : parent,
      webPreferences: {
        preload: path.join(__dirname, 'ui', 'settings-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const wc = this.win.webContents;
    registerAppPage(wc);
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-finish-load', () => { if (section) wc.send('settings:section', section); });
    this.win.on('closed', () => { this.win = null; });
    this.win.loadFile(path.join(__dirname, 'ui', 'settings.html'));
  }

  push() {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('settings:state', this.getState());
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }
}

module.exports = { SettingsWindow, ACTIONS };
