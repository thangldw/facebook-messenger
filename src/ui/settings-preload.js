'use strict';

// Preload for the app's own settings window only (never for Facebook's or Zalo's pages).

const { contextBridge, ipcRenderer } = require('electron');

const call = (action, payload) => ipcRenderer.invoke('settings-ui', action, payload);

contextBridge.exposeInMainWorld('settingsApi', {
  getState: () => call('getState'),
  addAccount: (service) => call('addAccount', { service: String(service) }),
  renameAccount: (id, name) => call('renameAccount', { id: String(id), name: String(name) }),
  removeAccount: (id) => call('removeAccount', { id: String(id) }),
  setFocus: (enabled, rules) => call('setFocus', { enabled: Boolean(enabled), rules: JSON.parse(JSON.stringify(rules)) }),
  onState: (cb) => ipcRenderer.on('settings:state', (_e, state) => cb(state)),
  onSection: (cb) => ipcRenderer.on('settings:section', (_e, section) => cb(section)),
});
