# Privacy and security

**Short answer:** Thrum never sees, stores or sends your Facebook username or password. You type them into Facebook's own login page, which sends them straight to Facebook over HTTPS, exactly as in a browser. The app keeps only what a browser keeps to stay signed in (a session cookie, encrypted with your OS keychain) plus Facebook's own cache, all on your computer.

This document explains what that claim rests on and how you can check each part yourself, without trusting the author.

## What the app stores

Everything lives in one folder on your computer and nowhere else:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Thrum/` |
| Windows | `%APPDATA%\Thrum\` |
| Linux | `~/.config/Thrum/` |

| What | Where in that folder | Stored? |
|---|---|---|
| Your password | — | **No.** There is no password store: the app is built on Electron, which has no password manager, and the app adds none. |
| Your username / email | — | **No.** Not saved by the app. Like any browser, Facebook's page may remember the last account in its own storage. |
| Form autofill data | — | **No.** Electron has no autofill database. |
| Session cookie (keeps you signed in) | `Partitions/messenger/Cookies` | Yes, **encrypted** with a key in the macOS Keychain, Windows DPAPI or the Linux secret service. |
| Facebook's cache, local storage, IndexedDB | `Partitions/messenger/…` | Yes, as in a browser. Written by Facebook's web page, not by the app. Can include recent messages Facebook caches for speed. |
| Files you download | Where you choose (Downloads by default) | Only when you click download on an attachment or photo. Attachments are always saved as files, never opened inside the app. |
| App settings | `settings.json` | Yes: your choices in the Settings menu, window size/position, the names you gave your accounts in the app, and your focus schedule. Also, unless you turn it off or use private mode, the **address of the last conversation** opened in each account (e.g. `/messages/t/1234`, no names or content), so it can reopen on launch. |
| Several accounts | `Partitions/messenger`, `Partitions/messenger-<id>` | Each account has its own, separate session folder. Accounts never share cookies or storage; removing an account deletes its folder's data. |
| App lock password | `settings.json` | **Only a salted scrypt hash**, never the password itself. The hash cannot be turned back into the password; it can only check a guess, and the app slows down repeated wrong guesses. |
| Private mode | — | With *Settings → Private mode* on, Facebook's session, cache and storage are kept in memory only and vanish when you quit. Turning it on also deletes what was stored before. |

The app sends **nothing** anywhere itself: no analytics, no crash reports. The only network traffic is Facebook's web page talking to Facebook, plus links you choose to open in your browser, with one opt-in exception: if you turn on *Settings → Check for updates automatically* (off by default) or click *Check for Updates…*, the app asks `api.github.com` for the latest release of this project (automatically at most once a day). That request carries no cookies and no data about you beyond the app version in its User-Agent and your IP address, which any web request reveals. Spellcheck uses the macOS spellchecker on macOS; on Windows and Linux it is turned off, because Electron would download dictionaries from Google there.

## Why the app cannot read your password

Your login happens inside Facebook's web page. The app is deliberately built so it has no way into that page:

1. **No code runs inside the page.** The app never calls `executeJavaScript`, and Facebook's pages have no preload script and no IPC channel to the app. The only thing it injects is CSS (to hide Facebook's top bar and for the privacy-screen blur), and CSS cannot read form fields or send data. The lock and reconnect screens and the settings window are the app's own local pages; they are the only pages with an IPC channel, and each channel accepts requests from its own page alone and only for a fixed list of actions.
2. **The page is isolated from the app.** It runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`, so Facebook's page, or anything injected into it, cannot reach the app or your files either.
3. **The app does not touch cookies or traffic.** It never reads the cookie store and does not inspect, intercept or proxy network requests.
4. **The binary is hardened.** Builds enable the Electron fuses that encrypt cookies at rest and disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, the usual ways to turn an Electron app into a tool for reading its data. The app only loads its own code from its integrity-checked `app.asar`.
5. **Minimal permissions, Facebook only.** Facebook's own pages may use notifications, microphone/camera (calls), screen capture (screen sharing, after you pick a screen), clipboard write and fullscreen. Third-party content embedded in a page gets none of these, and everything else (location, USB, Bluetooth, …) is denied for everyone.
6. **No fake login windows.** App windows have no address bar, so nothing but Facebook may ever render in one. Every window, including call windows and popups, refuses `data:`, `blob:` and `file:` pages and any non-Facebook site, whether reached by a link, a script, a popup or a server redirect; those links open in your normal browser, where you can see the address. Only `http`/`https` links are handed to the browser, so a page cannot launch other programs on your computer.

These rules are enforced by automated tests in [`test/privacy.test.js`](test/privacy.test.js), which run on every push. If anyone adds code that runs scripts in the page, reads cookies, makes its own network requests, uploads crash reports or weakens the isolation settings, the tests fail.

The whole app is three short files in [`src/`](src/) with no runtime dependencies, so it is practical to read all of it.

## Verify it yourself

### 1. The download is built from this source code

Every release file is built by GitHub Actions from a tagged commit and comes with a signed [build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations). With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify Thrum-0.1.0-mac-arm64.zip --repo thangldw/thrum
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
Get-ChildItem "$env:APPDATA\Thrum\Partitions\messenger" | Where-Object Name -match 'Login Data|Web Data'
```

### 3. Cookies are encrypted at rest

```bash
# macOS: count facebook.com cookies stored encrypted vs. plaintext (shows counts only)
sqlite3 "file:$HOME/Library/Application Support/Thrum/Partitions/messenger/Cookies?immutable=1" \
  "select sum(length(encrypted_value)>0) as encrypted, sum(length(value)>0) as plaintext from cookies where host_key like '%facebook.com'"
```

On a fresh install, expect `plaintext` to be `0` (or empty). If you signed in with a build from before v0.1.0, cookies are encrypted as Facebook rewrites them; the login cookies (`c_user`, `xs`) are rewritten on the first launch, and Account → **Log out and clear data…** followed by signing in again encrypts all of them at once. You can also confirm the fuses on the installed app:

```bash
npx @electron/fuses read --app "$HOME/Applications/Thrum.app"
# EnableCookieEncryption is Enabled, RunAsNode is Disabled, ...
```

### 4. The only network traffic is Facebook

Use a network monitor such as Little Snitch or LuLu (macOS), or Resource Monitor → Network (Windows). Connections go to Facebook's domains (`facebook.com`, `fbcdn.net`, and related Meta hosts), never to the author or any third party.

### 5. Read the code

- [`src/main.js`](src/main.js): window, isolation settings, permissions, the injected CSS.
- [`src/routes.js`](src/routes.js): which URLs stay in the app; pure URL matching.
- [`src/screen-share.js`](src/screen-share.js): asks you which screen to share during a call.

## Removing your data

- **In the app:** Account → **Log out and clear data…** deletes the session cookie, Facebook's cache and storage, and the remembered conversation. You will need to sign in again.
- **Forgot the app-lock password:** *Forgot password? Log out and reset…* on the lock screen does the same and turns the lock off. There is no other way past the lock.
- **Completely:** quit the app, then delete the folder from the first table above.

## About the app lock

The lock hides the app's window behind the lock screen, withholds notifications (whose previews would show message text) and disables DevTools until you unlock. It is a privacy screen for a shared or unattended computer, not encryption: Facebook's session stays on disk as described above, so someone with full access to your user account and enough skill could still extract it. Use your operating system's account password and full-disk encryption for that threat.

## What this app cannot protect against

- **Facebook itself.** Your messages and account are processed by Meta exactly as when you use facebook.com.
- **Someone with access to your user account on the computer.** Like any browser, a signed-in session on your computer can be used by anyone who can use your login. Cookie encryption protects the cookie file if it is copied off the machine or read by another user, not against malware running as you.
- **Facebook's cached data.** Facebook's web page may cache recent messages in its local storage. That data is not encrypted by the app; use full-disk encryption (FileVault, BitLocker), which you should have on anyway.

## macOS Keychain prompt

Cookie encryption stores its key in your Keychain as "Thrum Safe Storage". Because builds are not signed with a paid Apple certificate, macOS may ask "Thrum wants to use your confidential information…" after you install an update. Choose **Always Allow**. If you deny it, the app cannot read its cookies and you will be asked to sign in again.
