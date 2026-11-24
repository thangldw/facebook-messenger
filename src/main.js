'use strict';

const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { classify, isFacebookUrl, HOME_URL } = require('./routes');
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

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Only take known keys of the expected type from files on disk, so an edited
// settings file cannot inject arbitrary BrowserWindow options.
function loadBounds() {
  const saved = readJson(STATE_FILE());
  const bounds = { width: 1100, height: 780 };
  for (const k of ['x', 'y', 'width', 'height']) {
    if (Number.isFinite(saved[k])) bounds[k] = Math.round(saved[k]);
  }
  return bounds;
}

function loadPrefs() {
  const saved = readJson(PREFS_FILE());
  return { hideTopBar: typeof saved.hideTopBar === 'boolean' ? saved.hideTopBar : true };
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

// Navigation and window-creation policy, applied to every window the app
// creates: the main window, call windows and any popup they open. App windows
// have no address bar, so nothing but Facebook may ever render in one.
function guardContents(wc) {
  const isMain = () => mainWindow !== null && wc === mainWindow.webContents;

  // Full navigations triggered by the page (link clicks, form posts).
  wc.on('will-navigate', (event, url) => {
    const kind = classify(url);
    if (kind === 'allowed') return;
    event.preventDefault();
    if (kind === 'feed') { if (isMain()) wc.loadURL(HOME_URL); }
    else openExternal(url);
  });

  // Server redirects may pass through unlisted Facebook paths (login,
  // checkpoint), but must never land on a third-party site inside the app.
  wc.on('will-redirect', (event) => {
    if (!event.isMainFrame || event.url === 'about:blank' || isFacebookUrl(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });

  // Last line of defence if a non-Facebook page still loads in an app window.
  wc.on('did-navigate', (_e, url) => {
    if (url === 'about:blank') return;
    if (!isFacebookUrl(url)) {
      if (isMain()) wc.loadURL(HOME_URL); else wc.close();
      return;
    }
    // Post-login redirect to "/" and similar: back to the inbox.
    if (isMain() && classify(url) === 'feed') wc.loadURL(HOME_URL);
  });

  wc.setWindowOpenHandler(({ url }) => {
    // Call windows must stay in-app to keep the session; they get the same guards.
    if (classify(url) === 'allowed') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

function attachMainWindowBehaviour(win) {
  const wc = win.webContents;

  // Facebook is an SPA: clicking the logo or a profile name is a pushState.
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const kind = classify(url);
    if (kind === 'allowed') return;
    if (kind !== 'feed') openExternal(url);
    wc.loadURL(HOME_URL);
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
  // Granted only to Facebook's own frames, never to embedded third-party iframes.
  const allowed = new Set(['notifications', 'media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(allowed.has(permission) && isFacebookUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isFacebookUrl(requestingOrigin);
  });
  // Spellcheck dictionaries are downloaded from Google's CDN on Windows/Linux;
  // macOS uses the OS spellchecker. Keep the app's traffic Facebook-only.
  ses.setSpellCheckerEnabled(process.platform === 'darwin');
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
  mainWindow = new BrowserWindow({
    ...loadBounds(),
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

  attachMainWindowBehaviour(mainWindow);
  mainWindow.on('close', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) writeJson(STATE_FILE(), mainWindow.getBounds());
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(HOME_URL);
}

// A remote-debugging port lets any local process read the page and its cookies
// over the DevTools protocol, bypassing cookie encryption. Fuses already block
// --inspect; refuse Chromium's debugging switches in packaged builds too.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address'];
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_e, wc) => {
    // No <webview> tags anywhere: they would bypass the guards below.
    wc.on('will-attach-webview', (event) => event.preventDefault());
    if (wc.getType() === 'window') guardContents(wc);
  });

  app.whenReady().then(() => {
    prefs = loadPrefs();
    configureSession();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
