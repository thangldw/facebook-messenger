# Messenger Lite

A personal desktop app for Facebook Messenger on macOS, Windows and Linux, so you can chat without opening Facebook in a browser.

It wraps Facebook's own web client at `facebook.com/messages` (messenger.com was shut down in April 2026 and now redirects there). There is no reverse-engineered protocol and no unofficial API, so it behaves exactly like Messenger in a browser, minus the rest of Facebook.

> Not affiliated with or endorsed by Meta. "Facebook" and "Messenger" are trademarks of Meta Platforms, Inc.

## Features

- **Messages only.** The News Feed, Watch, Reels, Marketplace and similar routes bounce back to your inbox. Profiles, posts and outbound links open in your default browser.
- **Photos and files** open in the app's photo viewer; attachments download to a folder you choose (Downloads by default).
- **Voice and video calls**, including the call window, which stays in-app so it shares your login.
- **Screen sharing** in calls: the native picker on macOS 15+, and a source chooser on Windows, Linux and older macOS. On Windows it can also share system audio.
- **Native notifications** and an unread count (dock badge on macOS and on Linux launchers that support it; the window title everywhere).
- Persistent login in an isolated session, remembered window size, single instance, spellcheck (macOS).
- **View → Hide Facebook top bar** to remove the global Facebook header (on by default).
- `Ctrl/Cmd + Shift + M` returns to the inbox from anywhere.

## Privacy

**The app never sees, stores or sends your Facebook username or password.** You sign in on Facebook's own page, which sends them straight to Facebook. The app keeps only an encrypted session cookie on your computer and sends nothing anywhere itself. [PRIVACY.md](PRIVACY.md) explains why, and how to verify every claim yourself.

## Install

Ready-to-run builds, nothing to compile. The one-line installers download the latest release, check its SHA-256 checksum, and install it without the "unidentified developer" (macOS) or SmartScreen (Windows) block. Run the same command again to update; your login is kept.

**macOS** (Apple Silicon and Intel), in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/thangldw/facebook-messenger/main/install.sh | bash
```

Installs to `~/Applications/Messenger Lite.app`.

**Windows 10/11**, in PowerShell (no admin needed, no installer `.exe`):

```powershell
irm https://raw.githubusercontent.com/thangldw/facebook-messenger/main/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\Programs\Messenger Lite` and adds a Start menu shortcut.

Both scripts are short; read [install.sh](install.sh) / [install.ps1](install.ps1) before running them if you like.

### Manual download

Or download a file from the [latest release](https://github.com/thangldw/facebook-messenger/releases/latest):

| System | File |
|---|---|
| macOS (Apple Silicon) | `MessengerLite-<ver>-mac-arm64.dmg` or `.zip` |
| macOS (Intel) | `MessengerLite-<ver>-mac-x64.dmg` or `.zip` |
| Windows | `MessengerLite-<ver>-win-x64.zip` (unzip, run `Messenger Lite.exe`) or `MessengerLite-<ver>-win-setup.exe` (installer) |
| Linux | `MessengerLite-<ver>-linux-x86_64.AppImage` (`chmod +x`, then run) |

Files downloaded with a browser are flagged by the OS because the builds are not signed with a paid certificate:

- **macOS 15 and later:** open the app once (it is blocked), then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. Alternatively run `xattr -dr com.apple.quarantine "/Applications/Messenger Lite.app"`.
- **Windows SmartScreen:** click **More info → Run anyway**. For the zip, right-click it → Properties → **Unblock** before extracting.

`SHA256SUMS.txt` in each release lists the checksums, and every file has a GitHub build attestation; see [PRIVACY.md](PRIVACY.md#1-the-download-is-built-from-this-source-code) for how to verify them.

### First launch

Sign in to Facebook in the app window. If you use end-to-end encrypted chats, Messenger may ask for your PIN to restore your history, the same as in a browser. On macOS, allow the Keychain prompt for "Messenger Lite Safe Storage" (used to encrypt the session cookie) with **Always Allow**.

### Uninstall

Quit the app, then delete:

- **macOS:** `~/Applications/Messenger Lite.app` and `~/Library/Application Support/Messenger Lite`
- **Windows:** `%LOCALAPPDATA%\Programs\Messenger Lite`, `%APPDATA%\Messenger Lite` and the Start menu shortcut (or use *Apps & features* if you used the setup `.exe`)

### Calls on macOS

macOS asks for microphone and camera access the first time you join a call. Screen sharing additionally needs **System Settings → Privacy & Security → Screen & System Audio Recording** enabled for Messenger Lite; restart the app after granting it.

## Build from source

Requires Node.js 22 or newer.

```bash
npm install
npm start          # run from source
npm test           # route policy and privacy tests
npm run dist:mac   # or dist:win / dist:linux, output in dist/
npm run app:mac    # macOS: just the .app, fastest for local use
```

Build each platform on that platform. Cross-building macOS from another OS is not supported, and the Windows installer needs Wine when built from Linux or macOS.

## Releasing

Releases are built on native GitHub runners by `.github/workflows/release.yml`:

```bash
npm version patch          # bumps package.json and creates tag vX.Y.Z
git push --follow-tags     # CI builds mac/win/linux and publishes the release
```

The workflow fails if the tag does not match the `version` in `package.json`. It smoke-tests both install scripts on macOS and Windows runners, publishes the release with `SHA256SUMS.txt` and build attestations, then installs from the published release with the one-line commands to confirm they work. Running it manually from the Actions tab builds and smoke-tests the installers as workflow artifacts without publishing.

## How it works

| File | Purpose |
|---|---|
| `src/main.js` | Window, session, permissions, menu, unread badge |
| `src/routes.js` | Route policy: which URLs stay in-app, bounce to the inbox, or open externally |
| `src/screen-share.js` | Screen-share source picker for `getDisplayMedia()` |
| `test/routes.test.js` | Route policy tests |
| `test/privacy.test.js` | Enforces the guarantees in [PRIVACY.md](PRIVACY.md) |
| `install.sh`, `install.ps1` | One-line installers for macOS and Windows |

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
- Windows shows the unread count in the window title only, not as a taskbar badge.
- Spellcheck is macOS-only: on Windows and Linux Electron would download dictionaries from Google, so it is off to keep traffic Facebook-only.
- No auto-update; re-run the install command to upgrade.
- Builds are not signed with paid Apple/Microsoft certificates; the install scripts avoid the resulting warnings, browser downloads do not.

## License

[MIT](LICENSE)
