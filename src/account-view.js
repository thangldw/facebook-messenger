'use strict';

// One Facebook account: a WebContentsView with its own session (partition),
// so accounts never share cookies or storage. Every account keeps running in
// the background, so notifications and unread counts arrive for all of them.
// Like every Facebook page in the app it has no preload and no IPC.

const { WebContentsView } = require('electron');
const { Recovery } = require('./recovery');

// The default account keeps the v0.1 partition so existing logins survive.
function partitionFor(id, ephemeral) {
  if (ephemeral) return `messenger-private-${id}`;
  return id === 'default' ? 'persist:messenger' : `persist:messenger-${id}`;
}

class AccountView {
  /**
   * @param {object} opts { id, name, ephemeral, startUrl(account), onUnread(account), onStatus(account) }
   */
  constructor({ id, name, ephemeral, startUrl, onUnread, onStatus }) {
    this.id = id;
    this.name = name;
    this.partition = partitionFor(id, ephemeral);
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

    // Unread count: Facebook sets the title to "(3) Messenger" / "(3) Facebook".
    this.wc.on('page-title-updated', (_e, title) => {
      const m = /^\((\d+)\)/.exec(title);
      const n = m ? Number(m[1]) : 0;
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
