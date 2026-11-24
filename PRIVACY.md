# Privacy and security

**Short answer:** Messenger Lite never sees, stores or sends your Facebook username or password. You type them into Facebook's own login page, which sends them straight to Facebook over HTTPS, exactly as in a browser. The app keeps only what a browser keeps to stay signed in (a session cookie, encrypted with your OS keychain) plus Facebook's own cache, all on your computer.

This document explains what that claim rests on and how you can check each part yourself, without trusting the author.

## What the app stores

Everything lives in one folder on your computer and nowhere else:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Messenger Lite/` |
| Windows | `%APPDATA%\Messenger Lite\` |
| Linux | `~/.config/Messenger Lite/` |

| What | Where in that folder | Stored? |
|---|---|---|
| Your password | — | **No.** There is no password store: the app is built on Electron, which has no password manager, and the app adds none. |
| Your username / email | — | **No.** Not saved by the app. Like any browser, Facebook's page may remember the last account in its own storage. |
| Form autofill data | — | **No.** Electron has no autofill database. |
| Session cookie (keeps you signed in) | `Partitions/messenger/Cookies` | Yes, **encrypted** with a key in the macOS Keychain, Windows DPAPI or the Linux secret service. |
| Facebook's cache, local storage, IndexedDB | `Partitions/messenger/…` | Yes, as in a browser. Written by Facebook's web page, not by the app. Can include recent messages Facebook caches for speed. |
| App settings | `window-state.json`, `prefs.json` | Yes: window size/position and the "hide top bar" toggle. Nothing else. |

The app sends **nothing** anywhere itself: no analytics, no crash reports, no update checks. The only network traffic is Facebook's web page talking to Facebook, plus links you choose to open in your browser.

## Why the app cannot read your password

Your login happens inside Facebook's web page. The app is deliberately built so it has no way into that page:

1. **No code runs inside the page.** The app never calls `executeJavaScript`, has no preload script and no IPC channel to the page. The only thing it injects is a CSS stylesheet (to hide Facebook's top bar), and CSS cannot read form fields or send data.
2. **The page is isolated from the app.** It runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`, so Facebook's page, or anything injected into it, cannot reach the app or your files either.
3. **The app does not touch cookies or traffic.** It never reads the cookie store and does not inspect, intercept or proxy network requests.
4. **The binary is hardened.** Builds enable the Electron fuses that encrypt cookies at rest and disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, the usual ways to turn an Electron app into a tool for reading its data. The app only loads its own code from its integrity-checked `app.asar`.
5. **Minimal permissions.** The page may only use notifications, microphone/camera (calls), screen capture (screen sharing, after you pick a screen), clipboard write and fullscreen. Everything else (location, USB, Bluetooth, …) is denied.

These rules are enforced by automated tests in [`test/privacy.test.js`](test/privacy.test.js), which run on every push. If anyone adds code that runs scripts in the page, reads cookies, makes its own network requests, uploads crash reports or weakens the isolation settings, the tests fail.

The whole app is three short files in [`src/`](src/) with no runtime dependencies, so it is practical to read all of it.

## Verify it yourself

### 1. The download is built from this source code

Every release file is built by GitHub Actions from a tagged commit and comes with a signed [build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations). With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify MessengerLite-0.1.0-mac-arm64.zip --repo thangldw/facebook-messenger
```

A successful check proves the file was produced by this repository's release workflow and has not been modified since. The install scripts also check every download against the release's `SHA256SUMS.txt`.

### 2. No password or autofill store exists

After signing in, look in the `Partitions/messenger` folder listed above. A Chromium browser keeps passwords in a file called `Login Data` and autofill in `Web Data`. Neither exists here:

```bash
# macOS
ls ~/Library/Application\ Support/Messenger\ Lite/Partitions/messenger | grep -E "Login Data|Web Data" || echo "no password or autofill store"
```

```powershell
# Windows
Get-ChildItem "$env:APPDATA\Messenger Lite\Partitions\messenger" | Where-Object Name -match 'Login Data|Web Data'
```

### 3. Cookies are encrypted at rest

```bash
# macOS: count facebook.com cookies stored encrypted vs. plaintext (shows counts only)
sqlite3 "file:$HOME/Library/Application Support/Messenger Lite/Partitions/messenger/Cookies?immutable=1" \
  "select sum(length(encrypted_value)>0) as encrypted, sum(length(value)>0) as plaintext from cookies where host_key like '%facebook.com'"
```

On a fresh install, expect `plaintext` to be `0` (or empty). If you signed in with a build from before v0.1.0, cookies are encrypted as Facebook rewrites them; the login cookies (`c_user`, `xs`) are rewritten on the first launch, and Account → **Log out and clear data…** followed by signing in again encrypts all of them at once. You can also confirm the fuses on the installed app:

```bash
npx @electron/fuses read --app "$HOME/Applications/Messenger Lite.app"
# EnableCookieEncryption is Enabled, RunAsNode is Disabled, ...
```

### 4. The only network traffic is Facebook

Use a network monitor such as Little Snitch or LuLu (macOS), or Resource Monitor → Network (Windows). Connections go to Facebook's domains (`facebook.com`, `fbcdn.net`, and related Meta hosts), never to the author or any third party.

### 5. Read the code

- [`src/main.js`](src/main.js): window, isolation settings, permissions, the injected CSS.
- [`src/routes.js`](src/routes.js): which URLs stay in the app; pure URL matching.
- [`src/screen-share.js`](src/screen-share.js): asks you which screen to share during a call.

## Removing your data

- **In the app:** Account → **Log out and clear data…** deletes the session cookie, Facebook's cache and storage. You will need to sign in again.
- **Completely:** quit the app, then delete the folder from the first table above.

## What this app cannot protect against

- **Facebook itself.** Your messages and account are processed by Meta exactly as when you use facebook.com.
- **Someone with access to your user account on the computer.** Like any browser, a signed-in session on your computer can be used by anyone who can use your login. Cookie encryption protects the cookie file if it is copied off the machine or read by another user, not against malware running as you.
- **Facebook's cached data.** Facebook's web page may cache recent messages in its local storage. That data is not encrypted by the app; use full-disk encryption (FileVault, BitLocker), which you should have on anyway.

## macOS Keychain prompt

Cookie encryption stores its key in your Keychain as "Messenger Lite Safe Storage". Because builds are not signed with a paid Apple certificate, macOS may ask "Messenger Lite wants to use your confidential information…" after you install an update. Choose **Always Allow**. If you deny it, the app cannot read its cookies and you will be asked to sign in again.
