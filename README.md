# Messenger Lite

A personal desktop app for Facebook Messenger on macOS, Windows and Linux, so you can chat without opening Facebook in a browser.

It wraps Facebook's own web client at `facebook.com/messages` (messenger.com was shut down in April 2026 and now redirects there). There is no reverse-engineered protocol and no unofficial API, so it behaves exactly like Messenger in a browser, minus the rest of Facebook.

> Not affiliated with or endorsed by Meta. "Facebook" and "Messenger" are trademarks of Meta Platforms, Inc.

## Features

- **Messages only.** The News Feed, Watch, Reels, Marketplace and similar routes bounce back to your inbox. Profiles, posts and outbound links open in your default browser.
- **Voice and video calls**, including the call window, which stays in-app so it shares your login.
- **Screen sharing** in calls: the native picker on macOS 15+, and a source chooser on Windows, Linux and older macOS. On Windows it can also share system audio.
- **Native notifications** and an unread count (dock badge on macOS and on Linux launchers that support it; the window title everywhere).
- Persistent login in an isolated session, remembered window size, single instance, spellcheck.
- **View → Hide Facebook top bar** to remove the global Facebook header (on by default).
- `Ctrl/Cmd + Shift + M` returns to the inbox from anywhere.

## Install

Download the file for your system from the [latest release](https://github.com/thangldw/facebook-messenger/releases/latest).

| System | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `MessengerLite-<ver>-mac-arm64.dmg` | See *macOS first launch* below |
| macOS (Intel) | `MessengerLite-<ver>-mac-x64.dmg` | |
| Windows | `MessengerLite-<ver>-win-setup.exe` | Installs per user, adds Start menu entry |
| Windows (no install) | `MessengerLite-<ver>-win-portable.exe` | Run directly, e.g. from a USB drive |
| Linux | `MessengerLite-<ver>-linux-x86_64.AppImage` | `chmod +x` then run |

The builds are not code-signed by a paid certificate, so each OS warns on first launch:

- **macOS first launch:** open the `.dmg`, drag the app to Applications, then right-click the app → **Open** → **Open**. If macOS says the app "is damaged", run `xattr -dr com.apple.quarantine "/Applications/Messenger Lite.app"` once.
- **Windows SmartScreen:** click **More info → Run anyway**.

On first launch, sign in to Facebook in the app window. If you use end-to-end encrypted chats, Messenger may ask for your PIN to restore your history, the same as in a browser.

### Calls on macOS

macOS asks for microphone and camera access the first time you join a call. Screen sharing additionally needs **System Settings → Privacy & Security → Screen & System Audio Recording** enabled for Messenger Lite; restart the app after granting it.

## Build from source

Requires Node.js 22 or newer.

```bash
npm install
npm start          # run from source
npm test           # route policy tests
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

The workflow fails if the tag does not match the `version` in `package.json`. Running it manually from the Actions tab builds the installers as workflow artifacts without publishing a release.

## How it works

| File | Purpose |
|---|---|
| `src/main.js` | Window, session, permissions, menu, unread badge |
| `src/routes.js` | Route policy: which URLs stay in-app, bounce to the inbox, or open externally |
| `src/screen-share.js` | Screen-share source picker for `getDisplayMedia()` |
| `test/routes.test.js` | Route policy tests |

The page runs with `contextIsolation`, `sandbox` and no Node integration; the app injects only CSS. Permissions are limited to notifications, microphone/camera, screen capture, clipboard write and fullscreen. The user agent drops the `Electron` token so Facebook serves its normal web client.

### Adjusting the route policy

All rules live in `src/routes.js`:

- `ALLOWED_PREFIXES`: paths that stay in-app (messaging, calls, login, checkpoint, 2FA, recovery).
- `FEED_PATHS` / `FEED_PREFIXES`: paths that bounce back to the inbox.
- Anything else on facebook.com opens in your browser.

If a login, security or call step ever gets sent to your browser, add its path prefix to `ALLOWED_PREFIXES` and run `npm test`.

## Known limitations

- Depends on Facebook's web client: if Meta changes it, the top-bar hiding (`div[role="banner"]`) or a route may need updating.
- Windows shows the unread count in the window title only, not as a taskbar badge.
- No auto-update; download a new release to upgrade.

## License

[MIT](LICENSE)
