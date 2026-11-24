'use strict';

// Per-service policy: which site an account runs, where it may navigate, which
// origins get permissions, where files are downloaded from, how unread state is
// read from the page title, and which session partition holds its login.
// Kept free of Electron imports so it can be unit-tested.

const routes = require('./routes');

// Zalo Web shows no count: when a message arrives while its page is not
// focused it scrolls this text through the title (rotating it every 60 ms)
// until the page gets focus again. Chromium trims and collapses whitespace in
// titles, so compare without whitespace; any rotation of the text matches.
const ZALO_NEW_MESSAGE = 'Zalo - bạn có tin nhắn mới';
const compact = (s) => s.replace(/\s+/g, '');
const ZALO_NEW_COMPACT = compact(ZALO_NEW_MESSAGE);

function facebookUnread(title) {
  const m = /^\((\d+)\)/.exec(title || '');
  return m ? Number(m[1]) : 0;
}

function zaloUnread(title) {
  const t = compact(title || '');
  if (t.length === ZALO_NEW_COMPACT.length && (ZALO_NEW_COMPACT + ZALO_NEW_COMPACT).includes(t)) return 1;
  return facebookUnread(title) > 0 ? 1 : 0; // in case Zalo adds a "(n)" prefix later
}

const SERVICES = {
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    home: routes.HOME_URL,
    origin: 'https://www.facebook.com',
    classify: routes.classify,
    isOwnUrl: routes.isFacebookUrl,
    downloadTarget: routes.downloadTarget,
    unread: facebookUnread,
    // Facebook's title carries the number of unread conversations.
    countsUnread: true,
    // Conversations have their own URLs, so the last one can be reopened.
    restoresChats: true,
    // The default account keeps the v0.1 partition so existing logins survive.
    partition: (id, ephemeral) => {
      if (ephemeral) return `messenger-private-${id}`;
      return id === 'default' ? 'persist:messenger' : `persist:messenger-${id}`;
    },
  },
  zalo: {
    id: 'zalo',
    label: 'Zalo',
    home: routes.ZALO_HOME_URL,
    origin: 'https://chat.zalo.me',
    classify: routes.classifyZalo,
    isOwnUrl: routes.isZaloUrl,
    downloadTarget: routes.zaloDownloadTarget,
    unread: zaloUnread,
    countsUnread: false,
    restoresChats: false,
    partition: (id, ephemeral) => (ephemeral ? `zalo-private-${id}` : `persist:zalo-${id}`),
  },
};

const SERVICE_IDS = Object.keys(SERVICES);

// Used for windows whose session belongs to no account: nothing is allowed.
const NONE = {
  id: 'none',
  label: 'Thrum',
  home: 'about:blank',
  classify: (url) => (url === 'about:blank' ? 'allowed' : 'external'),
  isOwnUrl: () => false,
  downloadTarget: () => null,
  unread: () => 0,
  countsUnread: false,
  restoresChats: false,
};

function serviceFor(id) {
  return SERVICES[id] || SERVICES.facebook;
}

module.exports = { SERVICES, SERVICE_IDS, NONE, serviceFor, facebookUnread, zaloUnread, ZALO_NEW_MESSAGE };
