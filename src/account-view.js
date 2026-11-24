'use strict';

// One account (Facebook or Zalo): a WebContentsView with its own session (partition),
// so accounts never share cookies or storage. Every account keeps running in
// the background, so notifications and unread counts arrive for all of them.
// Like every web page in the app it has no preload and no IPC.

const { WebContentsView } = require('electron');
const { Recovery } = require('./recovery');
const { serviceFor } = require('./services');

function partitionFor(id, ephemeral, service = 'facebook') {
  return serviceFor(service).partition(id, ephemeral);
}

class AccountView {
  /**
   * @param {object} opts { id, name, service, ephemeral, startUrl(account), onUnread(account), onStatus(account) }
   */
  constructor({ id, name, service, ephemeral, startUrl, onUnread, onStatus }) {
    this.id = id;
    this.name = name;
    this.service = serviceFor(service);
    this.partition = this.service.partition(id, ephemeral);
    this.unread = 0;
    this.status = { offline: null, crashed: null };
    this.css = { topbar: null, privacy: null };

    this.view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    this.view.setBackgroundColor('#111214');
    this.wc = this.view.webContents;

    // Unread state from the title: "(3) Messenger" on Facebook, a scrolling
    // "new message" text on Zalo (see services.js).
    this.wc.on('page-title-updated', (_e, title) => {
      const n = this.service.unread(title);
      if (n !== this.unread) { this.unread = n; onUnread(this); }
    });

    this.startUrl = () => startUrl(this);
    this.recovery = new Recovery({
      webContents: this.wc,
      startUrl: this.startUrl,
      onStatus: (layer, data) => { this.status[layer] = data; onStatus(this); },
    });
  }

  load() {
    this.wc.loadURL(this.startUrl());
  }

  async setCss(key, css, on) {
    if (this.wc.isDestroyed()) return;
    if (this.css[key]) {
      await this.wc.removeInsertedCSS(this.css[key]).catch(() => {});
      this.css[key] = null;
    }
    if (on) this.css[key] = await this.wc.insertCSS(css).catch(() => null);
  }

  destroy() {
    this.recovery.destroy();
    if (!this.wc.isDestroyed()) this.wc.close();
  }
}

module.exports = { AccountView, partitionFor };
