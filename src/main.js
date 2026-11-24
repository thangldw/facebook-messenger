'use strict';

const {
  app, BaseWindow, Menu, shell, session, dialog, globalShortcut, Notification, clipboard, nativeImage,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { classify, isFacebookUrl, downloadTarget, HOME_URL } = require('./routes');
const { handleDisplayMediaRequest } = require('./screen-share');
const { Settings, isChatPath, cleanName, LOCK_MINUTES, MAX_ACCOUNTS } = require('./settings');
const { AccountView, partitionFor } = require('./account-view');
const { isAppPage } = require('./app-pages');
const { AppTray } = require('./tray');
const { Overlay } = require('./overlay');
const { AppLock } = require('./lock');
const { Dnd, HOUR } = require('./dnd');
const { normalizeRules, MAX_RULES } = require('./focus');
const { Updater, updateCommand } = require('./updater');
const { SettingsWindow } = require('./settings-window');

// Must match build.appId: Windows ties notifications to this ID.
const APP_ID = 'io.github.thangldw.thrum';
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

// Up to v0.2 the app was called "Messenger Lite". Move its data folder
// (settings, accounts, app-lock hash, sessions) to the new name before
// anything creates the new one. On Windows and Linux the cookie key moves
// with the folder, so logins survive; on macOS it is in the Keychain under the
// old name, so Facebook asks you to sign in once.
// Electron creates the (empty) new folder before this code runs, so "empty"
// counts as unused; Chromium only writes into it later in startup.
function migrateFromMessengerLite() {
  try {
    const target = app.getPath('userData');
    const legacy = path.join(app.getPath('appData'), 'Messenger Lite');
    if (!fs.existsSync(legacy)) return;
    if (fs.existsSync(target)) {
      if (fs.readdirSync(target).length > 0) return; // already in use: keep it
      fs.rmdirSync(target);
    }
    fs.renameSync(legacy, target);
  } catch { /* start with a fresh profile */ }
}
migrateFromMessengerLite();

let settings;
let ephemeral = false;
// The shell window has no page (and no renderer process) of its own;
// Facebook runs in one view per account inside it.
let mainWindow = null;
const accounts = new Map(); // id -> AccountView
let activeId = null;
let tray = null;
let overlay = null;
let lock = null;
let dnd = null;
let updater = null;
let settingsWin = null;
let isQuitting = false;
const configuredPartitions = new Set();

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

const active = () => accounts.get(activeId);
const accountFor = (wc) => [...accounts.values()].find((a) => a.wc === wc);
const totalUnread = () => [...accounts.values()].reduce((n, a) => n + a.unread, 0);

function startUrlFor(acc) {
  const last = settings.get('lastChats')[acc.id];
  if (settings.get('restoreLastChat') && !ephemeral && isChatPath(last)) return FB_ORIGIN + last;
  return HOME_URL;
}

const saveChatTimers = new Map();
function rememberChat(acc, url) {
  if (!settings.get('restoreLastChat') || ephemeral) return;
  let p;
  try { p = new URL(url).pathname; } catch { return; }
  if (!isChatPath(p) || settings.get('lastChats')[acc.id] === p) return;
  clearTimeout(saveChatTimers.get(acc.id));
  saveChatTimers.set(acc.id, setTimeout(() => {
    if (!accounts.has(acc.id)) return;
    settings.set('lastChats', { ...settings.get('lastChats'), [acc.id]: p });
  }, 2000));
}

function notificationsAllowed() {
  return !dnd.isPaused() && !(lock && lock.locked);
}

function applyCss(acc) {
  acc.setCss('topbar', HIDE_TOPBAR_CSS, settings.get('hideTopBar'));
  acc.setCss('privacy', PRIVACY_CSS, settings.get('privacyScreen') && !(mainWindow && mainWindow.isFocused()));
}

function applyCssAll() {
  for (const acc of accounts.values()) applyCss(acc);
}

function confirmParent() {
  return mainWindow && mainWindow.isVisible() ? mainWindow : null;
}

async function confirm(message, detail, okLabel) {
  const options = { type: 'question', message, detail, buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1 };
  const parent = confirmParent();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return response === 0;
}

// ---------------------------------------------------------------- window

function focusActive() {
  if (overlay && overlay.visible) overlay.focus();
  else if (active()) active().wc.focus();
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  focusActive();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

function layout() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  for (const acc of accounts.values()) acc.view.setBounds({ x: 0, y: 0, width, height });
  if (overlay) overlay.layout();
}

function updateTitle() {
  if (!mainWindow) return;
  const total = totalUnread();
  const name = accounts.size > 1 && active() ? ` — ${active().name}` : '';
  mainWindow.setTitle(`${total > 0 ? `(${total}) ` : ''}Thrum${name}`);
}

function onUnread() {
  const total = totalUnread();
  app.setBadgeCount(total); // macOS dock, supported Linux launchers
  if (isWin && mainWindow) {
    const badge = nativeImage.createFromPath(path.join(__dirname, 'assets', 'badge.png'));
    mainWindow.setOverlayIcon(total > 0 ? badge : null, total > 0 ? `${total} unread` : '');
  }
  updateTitle();
  if (lock && dnd) buildAppMenu(); // unread counts in the Accounts menu
  if (tray) tray.setUnread(total, { paused: dnd.isPaused() });
  if (settingsWin) settingsWin.push();
}

// Show the offline/crashed screen for the account being viewed only.
function refreshStatus() {
  const acc = active();
  if (!overlay || !acc) return;
  overlay.setLayer('offline', acc.status.offline);
  overlay.setLayer('crashed', acc.status.crashed);
}

// ---------------------------------------------------------------- guards

// Navigation and window-creation policy, applied to every window the app
// creates: account views, call windows and any popup they open. App windows
// have no address bar, so nothing but Facebook may ever render in one.
function guardContents(wc) {
  const account = () => accountFor(wc);
  // The app's own pages register themselves after creation, so this is checked per event.
  const skip = () => isAppPage(wc);

  // Full navigations triggered by the page (link clicks, form posts).
  wc.on('will-navigate', (event, url) => {
    if (skip()) { event.preventDefault(); return; }
    const file = downloadTarget(url);
    if (file) { event.preventDefault(); wc.downloadURL(file); return; }
    const kind = classify(url);
    if (kind === 'allowed') return;
    event.preventDefault();
    if (kind === 'feed') { if (account()) wc.loadURL(HOME_URL); }
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
      if (account()) wc.loadURL(HOME_URL); else wc.close();
      return;
    }
    // Post-login redirect to "/" and similar: back to the inbox.
    if (account() && classify(url) === 'feed') wc.loadURL(HOME_URL);
  });

  wc.setWindowOpenHandler(({ url }) => {
    // Attachments and "Download" buttons: save the file, never render it.
    const file = downloadTarget(url);
    if (file) { wc.downloadURL(file); return { action: 'deny' }; }
    // Call windows must stay in-app to keep the account's session; they get the same guards.
    if (classify(url) === 'allowed') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { session: wc.session, contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

function attachAccountBehaviour(acc) {
  const { wc } = acc;
  // Facebook is an SPA: clicking the logo or a profile name is a pushState.
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const kind = classify(url);
    if (kind === 'allowed') { rememberChat(acc, url); return; }
    if (kind !== 'feed') openExternal(url);
    wc.loadURL(HOME_URL);
  });
  wc.on('did-navigate', (_e, url) => rememberChat(acc, url));
  wc.on('dom-ready', () => applyCss(acc));
}

// ---------------------------------------------------------------- sessions

function configureSession(partition) {
  if (configuredPartitions.has(partition)) return;
  configuredPartitions.add(partition);
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

// Deletes everything the app keeps for an account: cookies (the login session),
// local/IndexedDB storage, service workers and HTTP cache.
async function clearPartition(partition) {
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
}

// ---------------------------------------------------------------- accounts

function addAccountView({ id, name }) {
  // Before the view exists: a webContents takes its user agent from the session
  // when it is created, so a later setUserAgent would not reach the page.
  configureSession(partitionFor(id, ephemeral));
  const acc = new AccountView({
    id,
    name,
    ephemeral,
    startUrl: startUrlFor,
    onUnread,
    onStatus: (a) => { if (a.id === activeId) refreshStatus(); },
  });
  attachAccountBehaviour(acc);
  accounts.set(id, acc);
  mainWindow.contentView.addChildView(acc.view);
  acc.view.setVisible(id === activeId && !(lock && lock.locked));
  layout();
  if (overlay) overlay.raise();
  acc.load();
  return acc;
}

// Only the active account is shown, and none while locked: the views are
// hidden before the lock screen has even loaded, so nothing shows through.
function applyVisibility() {
  const locked = Boolean(lock && lock.locked);
  for (const acc of accounts.values()) acc.view.setVisible(!locked && acc.id === activeId);
}

function switchAccount(id) {
  if (!accounts.has(id) || (lock && lock.locked)) return;
  activeId = id;
  if (settings.get('activeAccount') !== id) settings.set('activeAccount', id);
  applyVisibility();
  refreshStatus();
  updateTitle();
  rebuildMenus();
  if (settingsWin) settingsWin.push();
  if (mainWindow && mainWindow.isVisible()) focusActive();
}

async function addAccount() {
  const list = settings.get('accounts');
  if (list.length >= MAX_ACCOUNTS) return { ok: false, error: `You can add up to ${MAX_ACCOUNTS} accounts.` };
  let id;
  do { id = crypto.randomBytes(4).toString('hex'); } while (list.some((a) => a.id === id));
  let n = list.length + 1;
  while (list.some((a) => a.name === `Account ${n}`)) n += 1;
  const name = `Account ${n}`;
  settings.set('accounts', [...list, { id, name }]);
  addAccountView({ id, name });
  switchAccount(id);
  showWindow();
  return { ok: true };
}

function renameAccount({ id, name } = {}) {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: 'Enter a name.' };
  const list = settings.get('accounts');
  if (!list.some((a) => a.id === id)) return { ok: false, error: 'Unknown account.' };
  settings.set('accounts', list.map((a) => (a.id === id ? { ...a, name: clean } : a)));
  accounts.get(id).name = clean;
  updateTitle();
  rebuildMenus();
  return { ok: true };
}

async function removeAccount({ id } = {}) {
  const acc = accounts.get(id);
  const list = settings.get('accounts');
  if (!acc) return { ok: false, error: 'Unknown account.' };
  if (list.length === 1) return { ok: false, error: 'You need at least one account.' };
  const ok = await confirm(`Remove "${acc.name}"?`, 'This logs the account out and deletes its data in this app. Your Facebook account itself is not affected.', 'Remove');
  if (!ok) return { ok: false };
  const remaining = list.filter((a) => a.id !== id);
  settings.set('accounts', remaining);
  const chats = settings.get('lastChats');
  delete chats[id];
  settings.set('lastChats', chats);
  mainWindow.contentView.removeChildView(acc.view);
  acc.destroy();
  accounts.delete(id);
  if (!ephemeral) await clearPartition(acc.partition);
  if (activeId === id) switchAccount(remaining[0].id); else rebuildMenus();
  onUnread();
  return { ok: true };
}

// ---------------------------------------------------------------- actions

async function logOutActive() {
  const acc = active();
  const ok = await confirm(
    accounts.size > 1 ? `Log out of "${acc.name}" and delete its data?` : 'Log out and delete all local data?',
    'This removes the Facebook session, cached messages and settings stored by Facebook in this app. You will need to sign in again.',
    'Log out and clear',
  );
  if (!ok) return;
  await clearPartition(acc.partition);
  const chats = settings.get('lastChats');
  delete chats[acc.id];
  settings.set('lastChats', chats);
  acc.wc.loadURL(HOME_URL);
}

// "Forgot password" on the lock screen: the only way past the lock without the
// password is to wipe every account's session and the lock together.
async function resetEverything() {
  const ok = await confirm(
    'Log out and reset Thrum?',
    'This deletes the Facebook sessions and data of all accounts in this app and turns off the app lock. You will need to sign in to Facebook again.',
    'Log out and reset',
  );
  if (!ok) return;
  for (const acc of accounts.values()) await clearPartition(acc.partition);
  settings.set('lastChats', {});
  lock.disable();
  for (const acc of accounts.values()) acc.wc.loadURL(HOME_URL);
}

async function setEphemeral(on) {
  const ok = await confirm(
    on ? 'Turn on private mode?' : 'Turn off private mode?',
    on
      ? 'Nothing is written to disk: all accounts are logged out whenever you quit. This also logs them out now and deletes the data stored so far. Thrum will restart.'
      : 'Logins and Facebook cache will be kept between launches again. Thrum will restart.',
    'Restart',
  );
  if (!ok) { rebuildMenus(); return; }
  if (on) {
    for (const { id } of settings.get('accounts')) await clearPartition(partitionFor(id, false));
    settings.set('lastChats', {});
  }
  settings.set('ephemeral', on);
  app.relaunch();
  isQuitting = true;
  app.exit(0);
}

function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: isWin ? ['--hidden'] : [] });
  settings.set('openAtLogin', on);
  if (isMac && on && app.getLoginItemSettings().status === 'requires-approval') {
    dialog.showMessageBox({
      type: 'info',
      message: 'Allow Thrum to open at login',
      detail: 'macOS needs your approval: System Settings → General → Login Items, then turn on Thrum.',
    });
  }
  rebuildMenus();
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

function setFocusSchedule({ enabled, rules } = {}) {
  const clean = normalizeRules(rules);
  if (!clean) return { ok: false, error: 'Each time range needs at least one day and different start and end times.' };
  settings.set('focusRules', clean);
  settings.set('focusEnabled', Boolean(enabled));
  settings.set('focusOverrideUntil', 0);
  dnd.changed(true);
  return { ok: true };
}

function openSettings(section) {
  if (lock.locked) return;
  settingsWin.open(mainWindow, section);
}

function settingsState() {
  const end = dnd.focusUntil();
  return {
    accounts: settings.get('accounts').map((a) => ({ ...a, active: a.id === activeId, unread: accounts.has(a.id) ? accounts.get(a.id).unread : 0 })),
    maxAccounts: MAX_ACCOUNTS,
    maxRules: MAX_RULES,
    focus: {
      enabled: settings.get('focusEnabled'),
      rules: settings.get('focusRules'),
      status: dnd.focusPaused() ? `Focus time now, until ${new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '',
    },
  };
}

// ---------------------------------------------------------------- updates

function showUpdate(release) {
  const cmd = updateCommand();
  const buttons = cmd ? ['Copy update command', 'Open release page', 'Later'] : ['Open release page', 'Later'];
  const detail = cmd
    ? `Version ${release.version} is available (you have ${app.getVersion()}).\n\nTo update, run this in ${isWin ? 'PowerShell' : 'Terminal'}:\n${cmd}`
    : `Version ${release.version} is available (you have ${app.getVersion()}).`;
  dialog.showMessageBox({ type: 'info', message: 'Thrum update available', detail, buttons, defaultId: 0, cancelId: buttons.length - 1 })
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
      dialog.showMessageBox({ type: 'info', message: 'Thrum is up to date', detail: `Version ${app.getVersion()} is the latest.` });
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
    const n = new Notification({ title: 'Thrum update available', body: `Version ${release.version} is ready to install.` });
    n.on('click', () => showUpdate(release));
    n.show();
  }
}

// ---------------------------------------------------------------- menus

function pauseItems() {
  const label = dnd.label();
  return [
    ...(label ? [{ label, enabled: false }, { label: 'Resume notifications', click: () => dnd.resume() }, { type: 'separator' }] : []),
    { label: 'Pause for 1 hour', click: () => dnd.pauseFor(HOUR) },
    { label: 'Pause until tomorrow morning', click: () => dnd.pauseUntilMorning() },
    { label: 'Pause until I resume', click: () => dnd.pauseIndefinitely() },
    { type: 'separator' },
    {
      label: 'Use focus schedule',
      type: 'checkbox',
      checked: settings.get('focusEnabled'),
      click: (item) => { settings.set('focusEnabled', item.checked); settings.set('focusOverrideUntil', 0); dnd.changed(true); },
    },
    { label: 'Edit focus schedule…', enabled: !lock.locked, click: () => { showWindow(); openSettings('focus'); } },
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
  const { locked } = lock;
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

function accountSwitchItems({ withShortcuts }) {
  return settings.get('accounts').map((a, i) => {
    const acc = accounts.get(a.id);
    const unread = acc && acc.unread ? ` (${acc.unread})` : '';
    return {
      label: `${a.name}${unread}`,
      type: 'radio',
      checked: a.id === activeId,
      enabled: !lock.locked,
      ...(withShortcuts && i < 9 ? { accelerator: `CmdOrCtrl+${i + 1}` } : {}),
      click: () => { switchAccount(a.id); showWindow(); },
    };
  });
}

function zoom(delta) {
  const acc = active();
  if (!acc) return;
  acc.wc.setZoomLevel(delta === 0 ? 0 : acc.wc.getZoomLevel() + delta);
}

function buildAppMenu() {
  const { locked } = lock;
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdatesNow() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', enabled: !locked, click: () => openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : [{
      label: 'File',
      submenu: [
        { label: 'Settings…', accelerator: 'Ctrl+,', enabled: !locked, click: () => openSettings() },
        { label: 'Check for Updates…', click: () => checkForUpdatesNow() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Messages', accelerator: 'CmdOrCtrl+Shift+M', enabled: !locked, click: () => active() && active().wc.loadURL(HOME_URL) },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => active() && active().wc.reload() },
        { type: 'separator' },
        { label: 'Open current page in browser', enabled: !locked, click: () => active() && openExternal(active().wc.getURL()) },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        // DevTools would expose the page behind the lock screen.
        { label: 'Toggle Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', enabled: !locked, click: () => active() && active().wc.toggleDevTools() },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        ...accountSwitchItems({ withShortcuts: true }),
        { type: 'separator' },
        { label: 'Add account', enabled: !locked && accounts.size < MAX_ACCOUNTS, click: () => addAccount() },
        { label: 'Manage accounts…', enabled: !locked, click: () => openSettings('accounts') },
        { type: 'separator' },
        { label: accounts.size > 1 && active() ? `Log out of "${active().name}"…` : 'Log out and clear data…', enabled: !locked, click: () => logOutActive() },
      ],
    },
    { label: 'Notifications', submenu: pauseItems() },
    {
      label: 'Settings',
      submenu: [
        settingToggle('Keep running in background when closed', 'runInBackground'),
        ...(process.platform !== 'linux' ? [settingToggle('Open at login', 'openAtLogin', setOpenAtLogin)] : []),
        settingToggle(`Global shortcut (${SHORTCUT_LABEL}) to show or hide`, 'globalShortcut', (on) => { settings.set('globalShortcut', on); applyGlobalShortcut(); rebuildMenus(); }),
        { type: 'separator' },
        settingToggle('Hide Facebook top bar', 'hideTopBar', (on) => { settings.set('hideTopBar', on); applyCssAll(); rebuildMenus(); }),
        settingToggle('Reopen last conversation', 'restoreLastChat', (on) => { settings.set('restoreLastChat', on); if (!on) settings.set('lastChats', {}); rebuildMenus(); }),
        { type: 'separator' },
        settingToggle('Privacy screen: blur when inactive', 'privacyScreen', (on) => { settings.set('privacyScreen', on); applyCssAll(); rebuildMenus(); }),
        settingToggle('Private mode: keep nothing after quitting', 'ephemeral', (on) => setEphemeral(on)),
        { label: 'App lock', submenu: lockItems() },
        { type: 'separator' },
        settingToggle('Check for updates automatically', 'checkForUpdates', (on) => { settings.set('checkForUpdates', on); if (on) updater.autoCheck(); rebuildMenus(); }),
        { type: 'separator' },
        { label: 'More settings…', enabled: !locked, click: () => openSettings() },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function trayMenu() {
  if (!lock || !dnd) return [{ label: 'Open Thrum', click: () => showWindow() }];
  const total = totalUnread();
  return [
    { label: 'Open Thrum', click: () => showWindow() },
    ...(accounts.size > 1
      ? [{ type: 'separator' }, ...accountSwitchItems({ withShortcuts: false })]
      : total > 0 ? [{ label: `${total} unread`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Notifications', submenu: pauseItems() },
    ...(lock.enabled ? [{ label: 'Lock now', enabled: !lock.locked, click: () => lock.lock() }] : []),
    ...(updater && updater.available ? [{ label: `Update to ${updater.available.version}…`, click: () => showUpdate(updater.available) }] : []),
    { type: 'separator' },
    { label: 'Quit Thrum', click: () => { isQuitting = true; app.quit(); } },
  ];
}

function rebuildMenus() {
  if (!lock || !dnd) return;
  buildAppMenu();
  if (tray) tray.setUnread(totalUnread(), { paused: dnd.isPaused() });
}

// ---------------------------------------------------------------- startup

// Windows only shows notifications for apps with a Start menu shortcut that
// carries the app's AppUserModelID. The zip install has none, so the app
// creates (or refreshes) its own.
function ensureWindowsShortcut() {
  if (!isWin || !app.isPackaged) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Thrum.lnk');
  shell.writeShortcutLink(lnk, 'create', {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    appUserModelId: APP_ID,
    description: 'Thrum',
    icon: process.execPath,
    iconIndex: 0,
  });
}

function startedHidden() {
  if (!settings.get('runInBackground')) return false;
  if (process.argv.includes('--hidden')) return true;
  return isMac && app.getLoginItemSettings().wasOpenedAtLogin === true;
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
  mainWindow = new BaseWindow({
    width: 1100,
    height: 780,
    ...(settings.get('bounds') || {}),
    minWidth: 480,
    minHeight: 400,
    show,
    title: 'Thrum',
    backgroundColor: '#111214',
    autoHideMenuBar: true,
  });
  mainWindow.on('resize', () => { layout(); saveBounds(); });
  mainWindow.on('move', saveBounds);
  mainWindow.on('focus', () => { applyCssAll(); focusActive(); });
  mainWindow.on('blur', () => applyCssAll());

  // Run in background: closing the window hides it; quit from the tray or menu.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (!settings.get('runInBackground')) { isQuitting = true; app.quit(); return; }
    e.preventDefault();
    mainWindow.hide();
    if (isWin && !settings.get('trayHintShown')) {
      tray.displayBalloon('Thrum is still running', 'It keeps notifying you about new messages. Quit from the tray icon.');
      settings.set('trayHintShown', true);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  overlay = new Overlay(mainWindow, {
    unlock: (pw) => lock.tryPassword(pw),
    touchId: () => lock.tryTouchId(),
    setPassword: (pw) => lock.finishSetup(pw),
    cancel: () => lock.cancelSetup(),
    retry: () => active() && active().recovery.retryNow(),
    reset: () => resetEverything(),
  }, () => { if (active()) active().wc.focus(); });
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
    ephemeral = settings.get('ephemeral');
    ensureWindowsShortcut();

    dnd = new Dnd({ settings, onChange: () => { rebuildMenus(); if (settingsWin) settingsWin.push(); } });
    updater = new Updater({ settings, onAvailable: onUpdateAvailable });
    tray = new AppTray({ toggleWindow, buildMenu: trayMenu });
    settingsWin = new SettingsWindow({
      getState: settingsState,
      handlers: { addAccount, renameAccount, removeAccount, setFocus: setFocusSchedule },
    });

    createWindow({ show: !startedHidden() });
    lock = new AppLock({
      settings,
      overlay,
      onChange: () => {
        applyVisibility();
        if (lock.locked && settingsWin) settingsWin.close();
        if (!lock.locked) focusActive();
        rebuildMenus();
      },
    });

    activeId = settings.get('activeAccount');
    for (const a of settings.get('accounts')) addAccountView(a);
    switchAccount(activeId);
    if (lock.enabled) lock.lock();
    rebuildMenus();
    applyGlobalShortcut();

    app.on('activate', () => showWindow());
    // macOS: clicking a notification or the app in the Dock/app switcher brings
    // back a window that was hidden to the menu bar.
    if (isMac) app.on('did-become-active', () => { if (mainWindow && !mainWindow.isVisible()) showWindow(); });
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
