'use strict';

const {
  app, BrowserWindow, Menu, shell, session, dialog, globalShortcut, Notification, clipboard, nativeImage,
} = require('electron');
const path = require('path');
const { classify, isFacebookUrl, downloadTarget, HOME_URL } = require('./routes');
const { handleDisplayMediaRequest } = require('./screen-share');
const { Settings, isChatPath, LOCK_MINUTES } = require('./settings');
const { AppTray } = require('./tray');
const { Overlay, isAppPage } = require('./overlay');
const { AppLock } = require('./lock');
const { Recovery } = require('./recovery');
const { Dnd, HOUR } = require('./dnd');
const { Updater, updateCommand } = require('./updater');

// Must match build.appId: Windows ties notifications to this ID.
const APP_ID = 'local.personal.messenger-lite';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const FB_ORIGIN = 'https://www.facebook.com';
// Chosen to avoid common system and app shortcuts; Ctrl+Alt alone is AltGr on
// many Windows keyboard layouts, so Shift is added there.
const SHORTCUT = isMac ? 'Control+Alt+M' : 'Control+Alt+Shift+M';
const SHORTCUT_LABEL = isMac ? '⌃⌥M' : 'Ctrl+Alt+Shift+M';

// Hides Facebook's global top bar (Home/Watch/Marketplace...). Best-effort:
// Facebook class names are obfuscated, so we only rely on ARIA roles.
// Layout sizes are calc(100vh - var(--header-height)), and theme containers
// below :root redefine the variable (56px), so it must be zeroed on every element.
const HIDE_TOPBAR_CSS = `
  div[role="banner"] { display: none !important; }
  :root, :root * { --header-height: 0px !important; }
`;
// Privacy screen: blur the page while the window is not focused.
const PRIVACY_CSS = 'html { filter: blur(24px) saturate(0.6) !important; }';

// A remote-debugging port lets any local process read the page and its cookies
// over the DevTools protocol, bypassing cookie encryption. Fuses already block
// --inspect; refuse Chromium's debugging switches in packaged builds too.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address'];
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

let settings;
let partition;
let mainWindow = null;
let tray = null;
let overlay = null;
let lock = null;
let dnd = null;
let updater = null;
let isQuitting = false;
let unread = 0;
const cssKeys = { topbar: null, privacy: null };

// ---------------------------------------------------------------- helpers

// Facebook serves degraded or "unsupported browser" pages to UAs containing "Electron".
function chromeUserAgent() {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function startUrl() {
  const last = settings.get('lastChat');
  if (settings.get('restoreLastChat') && !settings.get('ephemeral') && isChatPath(last)) return FB_ORIGIN + last;
  return HOME_URL;
}

let saveChatTimer = null;
function rememberChat(url) {
  if (!settings.get('restoreLastChat') || settings.get('ephemeral')) return;
  let p;
  try { p = new URL(url).pathname; } catch { return; }
  if (!isChatPath(p) || p === settings.get('lastChat')) return;
  clearTimeout(saveChatTimer);
  saveChatTimer = setTimeout(() => settings.set('lastChat', p), 2000);
}

function notificationsAllowed() {
  return !dnd.isPaused() && !(lock && lock.locked);
}

async function setPageCss(wc, key, css, on) {
  if (cssKeys[key]) {
    await wc.removeInsertedCSS(cssKeys[key]).catch(() => {});
    cssKeys[key] = null;
  }
  if (on) cssKeys[key] = await wc.insertCSS(css).catch(() => null);
}

function applyPageCss() {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  setPageCss(wc, 'topbar', HIDE_TOPBAR_CSS, settings.get('hideTopBar'));
  setPageCss(wc, 'privacy', PRIVACY_CSS, settings.get('privacyScreen') && !mainWindow.isFocused());
}

// ---------------------------------------------------------------- window

function showWindow() {
  if (!mainWindow) createWindow({ show: true });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  overlay.focus();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

function setUnread(count) {
  unread = count;
  app.setBadgeCount(count); // macOS dock, supported Linux launchers
  if (isWin && mainWindow) {
    const badge = nativeImage.createFromPath(path.join(__dirname, 'assets', 'badge.png'));
    mainWindow.setOverlayIcon(count > 0 ? badge : null, count > 0 ? `${count} unread` : '');
  }
  if (mainWindow) mainWindow.setTitle(count > 0 ? `(${count}) Messenger Lite` : 'Messenger Lite');
  if (tray) tray.setUnread(count, { paused: dnd.isPaused() });
}

// Navigation and window-creation policy, applied to every window the app
// creates: the main window, call windows and any popup they open. App windows
// have no address bar, so nothing but Facebook may ever render in one.
function guardContents(wc) {
  const isMain = () => mainWindow !== null && wc === mainWindow.webContents;
  // The overlay registers itself after creation, so this is checked per event.
  const skip = () => isAppPage(wc);

  // Full navigations triggered by the page (link clicks, form posts).
  wc.on('will-navigate', (event, url) => {
    if (skip()) { event.preventDefault(); return; }
    const file = downloadTarget(url);
    if (file) { event.preventDefault(); wc.downloadURL(file); return; }
    const kind = classify(url);
    if (kind === 'allowed') return;
    event.preventDefault();
    if (kind === 'feed') { if (isMain()) wc.loadURL(HOME_URL); }
    else openExternal(url);
  });

  // Server redirects may pass through unlisted Facebook paths (login,
  // checkpoint), but must never land on a third-party site inside the app.
  wc.on('will-redirect', (event) => {
    if (skip()) { event.preventDefault(); return; }
    if (!event.isMainFrame || event.url === 'about:blank' || isFacebookUrl(event.url)) return;
    event.preventDefault();
    const file = downloadTarget(event.url);
    if (file) wc.downloadURL(file); else openExternal(event.url);
  });

  // Last line of defence if a non-Facebook page still loads in an app window.
  wc.on('did-navigate', (_e, url) => {
    if (skip() || url === 'about:blank') return;
    if (!isFacebookUrl(url)) {
      if (isMain()) wc.loadURL(HOME_URL); else wc.close();
      return;
    }
    // Post-login redirect to "/" and similar: back to the inbox.
    if (isMain() && classify(url) === 'feed') wc.loadURL(HOME_URL);
  });

  wc.setWindowOpenHandler(({ url }) => {
    // Attachments and "Download" buttons: save the file, never render it.
    const file = downloadTarget(url);
    if (file) { wc.downloadURL(file); return { action: 'deny' }; }
    // Call windows must stay in-app to keep the session; they get the same guards.
    if (classify(url) === 'allowed') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
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
    if (kind === 'allowed') { rememberChat(url); return; }
    if (kind !== 'feed') openExternal(url);
    wc.loadURL(HOME_URL);
  });
  wc.on('did-navigate', (_e, url) => rememberChat(url));

  wc.on('dom-ready', () => applyPageCss());

  // Unread count: Facebook sets the title to "(3) Messenger" / "(3) Facebook".
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const m = title.match(/^\((\d+)\)/);
    setUnread(m ? Number(m[1]) : 0);
  });

  win.on('focus', () => setPageCss(wc, 'privacy', PRIVACY_CSS, false));
  win.on('blur', () => setPageCss(wc, 'privacy', PRIVACY_CSS, settings.get('privacyScreen')));
}

let saveBoundsTimer = null;
function saveBounds() {
  if (!mainWindow || mainWindow.isMaximized() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (mainWindow) settings.set('bounds', mainWindow.getNormalBounds());
  }, 500);
}

function createWindow({ show }) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    ...(settings.get('bounds') || {}),
    minWidth: 480,
    minHeight: 400,
    show,
    title: 'Messenger Lite',
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  attachMainWindowBehaviour(mainWindow);
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Run in background: closing the window hides it; quit from the tray or menu.
  mainWindow.on('close', (e) => {
    if (isQuitting || !settings.get('runInBackground')) return;
    e.preventDefault();
    mainWindow.hide();
    if (isWin && !settings.get('trayHintShown')) {
      tray.displayBalloon('Messenger Lite is still running', 'It keeps notifying you about new messages. Quit from the tray icon.');
      settings.set('trayHintShown', true);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlay) overlay.destroy();
    overlay = null;
  });

  let recovery = null;
  overlay = new Overlay(mainWindow, {
    unlock: (pw) => lock.tryPassword(pw),
    touchId: () => lock.tryTouchId(),
    setPassword: (pw) => lock.finishSetup(pw),
    cancel: () => lock.cancelSetup(),
    retry: () => recovery && recovery.retryNow(),
    reset: () => resetEverything(),
  });
  lock.overlay = overlay;
  recovery = new Recovery({ webContents: mainWindow.webContents, overlay, startUrl });

  mainWindow.loadURL(startUrl());
  if (lock && lock.enabled) { lock.locked = false; lock.lock(); }
}

// ---------------------------------------------------------------- session

function configureSession() {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(chromeUserAgent());

  // Granted only to Facebook's own frames, never to embedded third-party iframes.
  // Notifications are additionally withheld while paused (Do Not Disturb) or locked.
  const allowed = new Set(['notifications', 'media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(allowed.has(permission) && isFacebookUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (!allowed.has(permission) || !isFacebookUrl(requestingOrigin)) return false;
    return permission === 'notifications' ? notificationsAllowed() : true;
  });
  // Spellcheck dictionaries are downloaded from Google's CDN on Windows/Linux;
  // macOS uses the OS spellchecker. Keep the app's traffic Facebook-only.
  ses.setSpellCheckerEnabled(process.platform === 'darwin');
  // macOS 15+ shows the native system picker; elsewhere our handler asks for a source.
  ses.setDisplayMediaRequestHandler(handleDisplayMediaRequest, { useSystemPicker: true });

  // Downloads (chat attachments, saved photos): ask where to save, starting in
  // Downloads, and reveal the file when done, like a browser.
  ses.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    item.once('done', (_ev, state) => {
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
  });
}

// ---------------------------------------------------------------- actions

async function confirm(message, detail, okLabel) {
  const options = { type: 'question', message, detail, buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1 };
  const { response } = mainWindow && mainWindow.isVisible()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

// Deletes everything the app keeps for Facebook: cookies (the login session),
// local/IndexedDB storage, service workers and HTTP cache.
async function clearFacebookData(part = partition) {
  const ses = session.fromPartition(part);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  settings.set('lastChat', '');
}

async function logOutAndClearData() {
  const ok = await confirm(
    'Log out and delete all local data?',
    'This removes your Facebook session, cached messages and settings stored by Facebook in this app. You will need to sign in again.',
    'Log out and clear',
  );
  if (!ok) return;
  await clearFacebookData();
  if (mainWindow) mainWindow.loadURL(HOME_URL);
}

// "Forgot password" on the lock screen: the only way past the lock without the
// password is to wipe the Facebook session and the lock together.
async function resetEverything() {
  const ok = await confirm(
    'Log out and reset Messenger Lite?',
    'This deletes your Facebook session and data in this app and turns off the app lock. You will need to sign in to Facebook again.',
    'Log out and reset',
  );
  if (!ok) return;
  await clearFacebookData();
  lock.disable();
  if (mainWindow) mainWindow.loadURL(HOME_URL);
}

async function setEphemeral(on) {
  const ok = await confirm(
    on ? 'Turn on private mode?' : 'Turn off private mode?',
    on
      ? 'Nothing is written to disk: you are logged out whenever you quit. This also logs you out now and deletes the data stored so far. Messenger Lite will restart.'
      : 'Your login and Facebook cache will be kept between launches again. Messenger Lite will restart.',
    'Restart',
  );
  if (!ok) { rebuildMenus(); return; }
  if (on) await clearFacebookData('persist:messenger');
  settings.set('ephemeral', on);
  app.relaunch();
  isQuitting = true;
  app.exit(0);
}

function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: isWin ? ['--hidden'] : [] });
  settings.set('openAtLogin', on);
  if (isMac && on) {
    const { status } = app.getLoginItemSettings();
    if (status === 'requires-approval') {
      dialog.showMessageBox({
        type: 'info',
        message: 'Allow Messenger Lite to open at login',
        detail: 'macOS needs your approval: System Settings → General → Login Items, then turn on Messenger Lite.',
      });
    }
  }
}

function applyGlobalShortcut() {
  globalShortcut.unregisterAll();
  if (!settings.get('globalShortcut')) return;
  if (!globalShortcut.register(SHORTCUT, toggleWindow)) {
    settings.set('globalShortcut', false);
    dialog.showMessageBox({
      type: 'warning',
      message: `${SHORTCUT_LABEL} is already used by another app`,
      detail: 'The global shortcut has been turned off.',
    });
  }
}

function showUpdate(release) {
  const cmd = updateCommand();
  const buttons = cmd ? ['Copy update command', 'Open release page', 'Later'] : ['Open release page', 'Later'];
  const detail = cmd
    ? `Version ${release.version} is available (you have ${app.getVersion()}).\n\nTo update, run this in ${isWin ? 'PowerShell' : 'Terminal'}:\n${cmd}`
    : `Version ${release.version} is available (you have ${app.getVersion()}).`;
  dialog.showMessageBox({ type: 'info', message: 'Messenger Lite update available', detail, buttons, defaultId: 0, cancelId: buttons.length - 1 })
    .then(({ response }) => {
      const action = buttons[response];
      if (action === 'Copy update command') clipboard.writeText(cmd);
      if (action === 'Open release page') openExternal(release.url);
    });
}

async function checkForUpdatesNow() {
  try {
    const release = await updater.check();
    if (!release) {
      dialog.showMessageBox({ type: 'info', message: 'Messenger Lite is up to date', detail: `Version ${app.getVersion()} is the latest.` });
    } else {
      showUpdate(release);
    }
  } catch (err) {
    dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: String(err.message || err) });
  }
}

function onUpdateAvailable(release) {
  rebuildMenus();
  if (Notification.isSupported()) {
    const n = new Notification({ title: 'Messenger Lite update available', body: `Version ${release.version} is ready to install.` });
    n.on('click', () => showUpdate(release));
    n.show();
  }
}

// ---------------------------------------------------------------- menus

function pauseItems() {
  const paused = dnd.isPaused();
  return [
    ...(paused ? [{ label: dnd.label(), enabled: false }, { label: 'Resume notifications', click: () => dnd.resume() }, { type: 'separator' }] : []),
    { label: 'Pause for 1 hour', click: () => dnd.pauseFor(HOUR) },
    { label: 'Pause until tomorrow morning', click: () => dnd.pauseUntilMorning() },
    { label: 'Pause until I resume', click: () => dnd.pauseIndefinitely() },
  ];
}

function settingToggle(label, key, onChange) {
  return {
    label,
    type: 'checkbox',
    checked: settings.get(key),
    click: (item) => {
      if (onChange) { onChange(item.checked); return; }
      settings.set(key, item.checked);
      rebuildMenus();
    },
  };
}

function lockItems() {
  const locked = lock.locked;
  if (!lock.enabled) return [{ label: 'Turn on app lock…', enabled: !locked, click: () => { showWindow(); lock.startSetup(); } }];
  return [
    { label: 'Lock now', accelerator: 'CmdOrCtrl+Shift+L', enabled: !locked, click: () => lock.lock() },
    {
      label: 'Lock after inactivity',
      enabled: !locked,
      submenu: LOCK_MINUTES.map((m) => ({
        label: m === 60 ? '1 hour' : `${m} minute${m > 1 ? 's' : ''}`,
        type: 'radio',
        checked: settings.get('lockAfterMinutes') === m,
        click: () => settings.set('lockAfterMinutes', m),
      })),
    },
    { label: 'Change password…', enabled: !locked, click: () => { showWindow(); lock.startSetup(); } },
    { label: 'Turn off app lock', enabled: !locked, click: () => lock.disable() },
  ];
}

function buildAppMenu() {
  const locked = lock.locked;
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdatesNow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    ...(!isMac ? [{
      label: 'File',
      submenu: [{ label: 'Check for Updates…', click: () => checkForUpdatesNow() }, { type: 'separator' }, { role: 'quit' }],
    }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Messages', accelerator: 'CmdOrCtrl+Shift+M', enabled: !locked, click: () => mainWindow && mainWindow.loadURL(HOME_URL) },
        { role: 'reload' },
        { type: 'separator' },
        { label: 'Open current page in browser', enabled: !locked, click: () => mainWindow && openExternal(mainWindow.webContents.getURL()) },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        // DevTools would expose the page behind the lock screen.
        { role: 'toggleDevTools', enabled: !locked },
      ],
    },
    { label: 'Notifications', submenu: pauseItems() },
    {
      label: 'Settings',
      submenu: [
        settingToggle('Keep running in background when closed', 'runInBackground', (on) => { settings.set('runInBackground', on); rebuildMenus(); }),
        ...(process.platform !== 'linux' ? [settingToggle('Open at login', 'openAtLogin', setOpenAtLogin)] : []),
        settingToggle(`Global shortcut (${SHORTCUT_LABEL}) to show or hide`, 'globalShortcut', (on) => { settings.set('globalShortcut', on); applyGlobalShortcut(); rebuildMenus(); }),
        { type: 'separator' },
        settingToggle('Hide Facebook top bar', 'hideTopBar', (on) => { settings.set('hideTopBar', on); applyPageCss(); rebuildMenus(); }),
        settingToggle('Reopen last conversation', 'restoreLastChat', (on) => { settings.set('restoreLastChat', on); if (!on) settings.set('lastChat', ''); rebuildMenus(); }),
        { type: 'separator' },
        settingToggle('Privacy screen: blur when inactive', 'privacyScreen', (on) => { settings.set('privacyScreen', on); applyPageCss(); rebuildMenus(); }),
        settingToggle('Private mode: keep nothing after quitting', 'ephemeral', (on) => setEphemeral(on)),
        { label: 'App lock', submenu: lockItems() },
        { type: 'separator' },
        settingToggle('Check for updates automatically', 'checkForUpdates', (on) => { settings.set('checkForUpdates', on); if (on) updater.autoCheck(); rebuildMenus(); }),
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

function trayMenu() {
  return [
    { label: 'Open Messenger Lite', click: () => showWindow() },
    ...(unread > 0 ? [{ label: `${unread} unread`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Notifications', submenu: pauseItems() },
    ...(lock.enabled ? [{ label: 'Lock now', enabled: !lock.locked, click: () => lock.lock() }] : []),
    ...(updater && updater.available ? [{ label: `Update to ${updater.available.version}…`, click: () => showUpdate(updater.available) }] : []),
    { type: 'separator' },
    { label: 'Quit Messenger Lite', click: () => { isQuitting = true; app.quit(); } },
  ];
}

function rebuildMenus() {
  buildAppMenu();
  if (tray) tray.setUnread(unread, { paused: dnd.isPaused() });
}

// ---------------------------------------------------------------- startup

// Windows only shows notifications for apps with a Start menu shortcut that
// carries the app's AppUserModelID. The zip install has none, so the app
// creates (or refreshes) its own.
function ensureWindowsShortcut() {
  if (!isWin || !app.isPackaged) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Messenger Lite.lnk');
  shell.writeShortcutLink(lnk, 'create', {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    appUserModelId: APP_ID,
    description: 'Messenger Lite',
    icon: process.execPath,
    iconIndex: 0,
  });
}

function startedHidden() {
  if (!settings.get('runInBackground')) return false;
  if (process.argv.includes('--hidden')) return true;
  return isMac && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.on('web-contents-created', (_e, wc) => {
    // No <webview> tags anywhere: they would bypass the guards below.
    wc.on('will-attach-webview', (event) => event.preventDefault());
    if (wc.getType() === 'window') guardContents(wc);
  });

  app.whenReady().then(() => {
    if (isWin) app.setAppUserModelId(APP_ID);
    settings = new Settings(app.getPath('userData'));
    partition = settings.get('ephemeral') ? 'messenger-private' : 'persist:messenger';
    ensureWindowsShortcut();
    configureSession();

    dnd = new Dnd({ settings, onChange: () => rebuildMenus() });
    lock = new AppLock({ settings, overlay: null, onChange: () => rebuildMenus() });
    updater = new Updater({ settings, onAvailable: onUpdateAvailable });
    tray = new AppTray({ toggleWindow, buildMenu: trayMenu });

    createWindow({ show: !startedHidden() });
    rebuildMenus();
    applyGlobalShortcut();

    app.on('activate', () => showWindow());
    // macOS: clicking a notification or the app in the Dock/app switcher brings
    // back a window that was hidden to the menu bar.
    if (isMac) app.on('did-become-active', () => { if (mainWindow && !mainWindow.isVisible()) showWindow(); });
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
