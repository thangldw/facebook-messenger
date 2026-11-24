# Thrum

A quiet desktop app for your Facebook messages on macOS, Windows and Linux: chat without opening Facebook in a browser, and without the feed.

*Formerly Messenger Lite.* The app was renamed in v0.3.0 so it is not confused with Meta's own products. Updating with the install command or Homebrew replaces the old app and keeps your settings and accounts; on macOS you sign in to Facebook once more, because the cookie key in the Keychain was stored under the old name.

It wraps Facebook's own web client at `facebook.com/messages` (messenger.com was shut down in April 2026 and now redirects there). There is no reverse-engineered protocol and no unofficial API, so it behaves exactly like Messenger in a browser, minus the rest of Facebook.

> Thrum is an independent project, not affiliated with or endorsed by Meta. "Facebook" and "Messenger" are trademarks of Meta Platforms, Inc., used here only to describe what the app works with.

## Features

- **Messages only.** The News Feed, Watch, Reels, Marketplace and similar routes bounce back to your inbox. Profiles, posts and outbound links open in your default browser.
- **Photos and files** open in the app's photo viewer; attachments download to a folder you choose (Downloads by default).
- **Voice and video calls**, including the call window, which stays in-app so it shares your login.
- **Screen sharing** in calls: the native picker on macOS 15+, and a source chooser on Windows, Linux and older macOS. On Windows it can also share system audio.
- **Native notifications** and an unread count: menu bar/tray icon, dock badge (macOS), taskbar badge (Windows), window title.
- **Runs in the background.** Closing the window keeps it in the menu bar (macOS) or system tray (Windows, Linux) so you still get notifications. Optional **Open at login**.
- **Multiple accounts**, each with its own separate login. All of them keep running, so you get notifications and unread counts for every account; switch from the *Accounts* menu, the tray, or `Cmd/Ctrl + 1…9`. With one account the app runs a single Facebook page; each extra account adds roughly 200–500 MB of memory depending on how much it has loaded.
- **Pause notifications** for an hour, until tomorrow morning, or until you resume (*Notifications* menu or tray), or on a weekly **focus schedule** (e.g. weekdays 9:00–18:00, or 22:00–07:00 overnight).
- **Global shortcut** to show or hide the app from anywhere: `⌃⌥M` on macOS, `Ctrl+Alt+Shift+M` on Windows/Linux.
- **App lock** with a password (and Touch ID on macOS). Locks on launch, when the computer locks or sleeps, and after 1–60 minutes of inactivity. Notification previews are withheld while locked.
- **Privacy screen**: blur the app whenever it is not the active window (useful when screen sharing or in public).
- **Private mode**: nothing is written to disk; you are logged out whenever you quit.
- **Reopens your last conversation** on launch (only its address is remembered).
- **Recovers by itself**: reconnects when the network comes back, and reloads after a crash or hang.
- **Hide Facebook top bar**, persistent isolated login, remembered window size, single instance, spellcheck (macOS).
- `Ctrl/Cmd + Shift + M` returns to the inbox; `Ctrl/Cmd + Shift + L` locks the app.

Toggles are under the **Settings** menu; accounts and the focus schedule are edited in the settings window (`Cmd/Ctrl + ,`).

## Privacy

**The app never sees, stores or sends your Facebook username or password.** You sign in on Facebook's own page, which sends them straight to Facebook. The app keeps only an encrypted session cookie on your computer and sends nothing anywhere itself, except an optional, off-by-default check for new versions. [PRIVACY.md](PRIVACY.md) explains why, and how to verify every claim yourself.

## Install

Ready-to-run builds, nothing to compile. The one-line installers download the latest release, check its SHA-256 checksum, and install it without the "unidentified developer" (macOS) or SmartScreen (Windows) block. Run the same command again to update; your login is kept.

**macOS** (Apple Silicon and Intel), in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/thangldw/thrum/main/install.sh | bash
```

Installs to `~/Applications/Thrum.app`.

Or with **Homebrew**:

```bash
brew tap thangldw/thrum https://github.com/thangldw/thrum
brew install --cask thangldw/thrum/thrum
# update later: brew upgrade --cask thangldw/thrum/thrum
```

**Windows 10/11** (x64 and ARM), in PowerShell (no admin needed, no installer `.exe`):

```powershell
irm https://raw.githubusercontent.com/thangldw/thrum/main/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\Programs\Thrum` and adds a Start menu shortcut. Once the package is accepted into the winget repository you can also use `winget install ThangLDW.Thrum`.

**Linux** (Debian/Ubuntu), download the `.deb` from the [latest release](https://github.com/thangldw/thrum/releases/latest) and run `sudo apt install ./Thrum-<ver>-linux-amd64.deb`; other distributions can use the AppImage.

The scripts are short; read [install.sh](install.sh) / [install.ps1](install.ps1) before running them if you like.

### Manual download

Or download a file from the [latest release](https://github.com/thangldw/thrum/releases/latest):

| System | File |
|---|---|
| macOS (Apple Silicon) | `Thrum-<ver>-mac-arm64.dmg` or `.zip` |
| macOS (Intel) | `Thrum-<ver>-mac-x64.dmg` or `.zip` |
| Windows (x64 / ARM) | `Thrum-<ver>-win-x64.zip` / `-win-arm64.zip` (unzip, run `Thrum.exe`) or `Thrum-<ver>-win-x64-setup.exe` / `-win-arm64-setup.exe` (installer) |
| Linux | `Thrum-<ver>-linux-amd64.deb` or `Thrum-<ver>-linux-x86_64.AppImage` (`chmod +x`, then run) |

Files downloaded with a browser are flagged by the OS because the builds are not signed with a paid certificate:

- **macOS 15 and later:** open the app once (it is blocked), then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. Alternatively run `xattr -dr com.apple.quarantine "/Applications/Thrum.app"`.
- **Windows SmartScreen:** click **More info → Run anyway**. For the zip, right-click it → Properties → **Unblock** before extracting.

`SHA256SUMS.txt` in each release lists the checksums, and every file has a GitHub build attestation; see [PRIVACY.md](PRIVACY.md#1-the-download-is-built-from-this-source-code) for how to verify them.

### First launch

Sign in to Facebook in the app window. If you use end-to-end encrypted chats, Messenger may ask for your PIN to restore your history, the same as in a browser. On macOS, allow the Keychain prompt for "Thrum Safe Storage" (used to encrypt the session cookie) with **Always Allow**.

### Uninstall

Quit the app, then delete:

- **macOS:** `~/Applications/Thrum.app` and `~/Library/Application Support/Thrum` (Homebrew: `brew uninstall --zap --cask thangldw/thrum/thrum`)
- **Windows:** `%LOCALAPPDATA%\Programs\Thrum`, `%APPDATA%\Thrum` and the Start menu shortcut (or use *Apps & features* if you used the setup `.exe`)
- **Linux:** `sudo apt remove thrum` and `~/.config/Thrum`

### Calls on macOS

macOS asks for microphone and camera access the first time you join a call. Screen sharing additionally needs **System Settings → Privacy & Security → Screen & System Audio Recording** enabled for Thrum; restart the app after granting it.

## Build from source

Requires Node.js 22 or newer.

```bash
npm install
npm start          # run from source
npm test           # route policy and privacy tests
npm run dist:mac   # or dist:win / dist:linux, output in dist/ (Windows: add --x64 or --arm64)
npm run app:mac    # macOS: just the .app, fastest for local use
```

Build each platform on that platform. Cross-building macOS from another OS is not supported, and the Windows installer needs Wine when built from Linux or macOS.

## Releasing

Releases are built on native GitHub runners by `.github/workflows/release.yml`:

```bash
npm version patch          # bumps package.json and creates tag vX.Y.Z
git push --follow-tags     # CI builds mac/win/linux and publishes the release
```

The workflow fails if the tag does not match the `version` in `package.json`. It smoke-tests the installers on each OS, publishes the release with `SHA256SUMS.txt` and build attestations, updates the Homebrew cask in `Casks/`, then installs from the published release every supported way (install.sh, Homebrew, install.ps1 on x64 and on a Windows ARM runner, apt) to confirm they work. Running it manually from the Actions tab builds and smoke-tests the installers as workflow artifacts without publishing.

**winget:** each release includes `Thrum-<ver>-winget-manifests.zip`. The first submission to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) is manual (`wingetcreate submit <manifest folder>`); after it is accepted, add a repository secret `WINGET_TOKEN` (a GitHub token with `public_repo` scope) and every later release is submitted automatically.

## How it works

| File | Purpose |
|---|---|
| `src/main.js` | Window, sessions, permissions, accounts, menus, wiring |
| `src/account-view.js` | One Facebook account: a view with its own session |
| `src/routes.js` | Route policy: which URLs stay in-app, bounce to the inbox, download, or open externally |
| `src/settings.js` | Settings, validated against a schema on every read |
| `src/tray.js`, `src/dnd.js`, `src/focus.js` | Menu bar/tray icon, pause notifications, focus schedule |
| `src/lock.js`, `src/password.js` | App lock: scrypt password hash, Touch ID, auto-lock |
| `src/overlay.js`, `src/settings-window.js`, `src/ui/` | The app's own pages: lock/recovery screen, settings window |
| `src/recovery.js` | Reconnect after network failures, reload after crashes/hangs |
| `src/updater.js` | Opt-in update check (GitHub releases API only) |
| `src/screen-share.js` | Screen-share source picker for `getDisplayMedia()` |
| `test/` | Route, module and privacy tests; `privacy.test.js` enforces [PRIVACY.md](PRIVACY.md) |
| `install.sh`, `install.ps1`, `Casks/`, `scripts/packaging.js` | Installers and package-manager files |

Security issues: see [SECURITY.md](SECURITY.md).

The page runs with `contextIsolation`, `sandbox` and no Node integration; the app injects only CSS. Permissions are limited to notifications, microphone/camera, screen capture, clipboard write and fullscreen. Builds enable cookie encryption and disable Electron's Node/inspector entry points via fuses. The user agent drops the `Electron` token so Facebook serves its normal web client.

### Adjusting the route policy

All rules live in `src/routes.js`:

- `ALLOWED_PREFIXES`: paths that stay in-app (messaging, calls, login, checkpoint, 2FA, recovery).
- `FEED_PATHS` / `FEED_PREFIXES`: paths that bounce back to the inbox.
- Anything else on facebook.com opens in your browser.

If a login, security or call step ever gets sent to your browser, add its path prefix to `ALLOWED_PREFIXES` and run `npm test`.

## Known limitations

- Depends on Facebook's web client: if Meta changes it, the top-bar hiding (`div[role="banner"]`) or a route may need updating.
- **A Facebook account is required.** Since messenger.com closed, Meta only offers Messenger on desktop through facebook.com, so this app cannot be used with a deactivated Facebook account without reactivating it (signing in to facebook.com reactivates a deactivated account), nor with a Messenger-only account. Meta's mobile Messenger app is the only option for those.
- On Windows and Linux, clicking a notification may not bring a hidden window to the front; use the tray icon or the global shortcut.
- With several accounts, notifications do not say which account they belong to, and clicking one does not switch accounts: the app does not read Facebook's pages, so it cannot see the account name. The tray and *Accounts* menu show unread counts per account.
- Spellcheck is macOS-only: on Windows and Linux Electron would download dictionaries from Google, so it is off to keep traffic Facebook-only.
- No automatic installs of updates; turn on *Settings → Check for updates automatically* to be told about new versions, then re-run the install command (or `brew upgrade --cask thangldw/thrum/thrum`).
- Builds are not signed with paid Apple/Microsoft certificates; the install scripts avoid the resulting warnings, browser downloads do not.

## License

[MIT](LICENSE)
