'use strict';

const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { classify, HOME_URL } = require('./routes');
const { handleDisplayMediaRequest } = require('./screen-share');

const PARTITION = 'persist:messenger';
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const PREFS_FILE = () => path.join(app.getPath('userData'), 'prefs.json');

// Hides Facebook's global top bar (Home/Watch/Marketplace...). Best-effort:
// Facebook class names are obfuscated, so we only rely on ARIA roles.
// Layout sizes are calc(100vh - var(--header-height)), and theme containers
// below :root redefine the variable (56px), so it must be zeroed on every element.
const HIDE_TOPBAR_CSS = `
  div[role="banner"] { display: none !important; }
  :root, :root * { --header-height: 0px !important; }
`;

let mainWindow = null;
let topbarCssKey = null;
let prefs = { hideTopBar: true };

function readJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return fallback; }
}

function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* non-critical */ }
}

// Facebook serves degraded or "unsupported browser" pages to UAs containing "Electron".
function chromeUserAgent() {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');
}

async function applyTopBarCss(wc) {
  if (topbarCssKey) {
    await wc.removeInsertedCSS(topbarCssKey).catch(() => {});
    topbarCssKey = null;
  }
  if (prefs.hideTopBar) topbarCssKey = await wc.insertCSS(HIDE_TOPBAR_CSS).catch(() => null);
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function attachGuards(win) {
  const wc = win.webContents;

  // Full navigations triggered by the page (link clicks, form posts).
  wc.on('will-navigate', (event, url) => {
    const kind = classify(url);
    if (kind === 'allowed') return;
    event.preventDefault();
    if (kind === 'feed') wc.loadURL(HOME_URL);
    else openExternal(url);
  });

  // Server redirects (e.g. post-login redirect to "/") land here. Only bounce
  // feed routes: unknown paths may be part of login/checkpoint flows.
  wc.on('did-navigate', (_e, url) => {
    if (classify(url) === 'feed') wc.loadURL(HOME_URL);
  });

  // Facebook is an SPA: clicking the logo or a profile name is a pushState.
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const kind = classify(url);
    if (kind === 'allowed') return;
    if (kind !== 'feed') openExternal(url);
    wc.loadURL(HOME_URL);
  });

  wc.setWindowOpenHandler(({ url }) => {
    // Call windows must stay in-app to keep the session.
    if (classify(url) === 'allowed') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  wc.on('dom-ready', () => applyTopBarCss(wc));

  // Unread count: Facebook sets the title to "(3) Messenger" / "(3) Facebook".
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const m = title.match(/^\((\d+)\)/);
    app.setBadgeCount(m ? Number(m[1]) : 0); // no-op on Windows
    win.setTitle(m ? `(${m[1]}) Messenger Lite` : 'Messenger Lite');
  });
}

function configureSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(chromeUserAgent());
  const allowed = new Set(['notifications', 'media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  // macOS 15+ shows the native system picker; elsewhere our handler asks for a source.
  ses.setDisplayMediaRequestHandler(handleDisplayMediaRequest, { useSystemPicker: true });
}

// Deletes everything the app keeps for Facebook: cookies (the login session),
// local/IndexedDB storage, service workers and HTTP cache.
async function logOutAndClearData() {
  const options = {
    type: 'warning',
    message: 'Log out and delete all local data?',
    detail: 'This removes your Facebook session, cached messages and settings stored by Facebook in this app. You will need to sign in again.',
    buttons: ['Log out and clear', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  };
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return;
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  mainWindow?.loadURL(HOME_URL);
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Messages', accelerator: 'CmdOrCtrl+Shift+M', click: () => mainWindow?.loadURL(HOME_URL) },
        { role: 'reload' },
        { type: 'separator' },
        {
          label: 'Hide Facebook top bar',
          type: 'checkbox',
          checked: prefs.hideTopBar,
          click: (item) => {
            prefs.hideTopBar = item.checked;
            writeJson(PREFS_FILE(), prefs);
            if (mainWindow) applyTopBarCss(mainWindow.webContents);
          },
        },
        {
          label: 'Open current page in browser',
          click: () => mainWindow && openExternal(mainWindow.webContents.getURL()),
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Account',
      submenu: [{ label: 'Log out and clear data…', click: () => logOutAndClearData() }],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const state = readJson(STATE_FILE(), { width: 1100, height: 780 });
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 480,
    minHeight: 400,
    title: 'Messenger Lite',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  attachGuards(mainWindow);
  mainWindow.on('close', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) writeJson(STATE_FILE(), mainWindow.getBounds());
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(HOME_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    prefs = readJson(PREFS_FILE(), prefs);
    configureSession();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
