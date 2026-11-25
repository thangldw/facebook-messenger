# Changelog

## 0.4.1

Security hardening, from a review of the app and its release process.

- **App lock** now also hides call windows and other popups, and no new window opens while locked. Before, a call window stayed visible and usable above the lock.
- **App lock** wrong-password slowdown survives quitting and relaunching. New passwords need at least 6 characters; an existing shorter password keeps working.
- **Microphone and camera** are granted without asking only to call windows. Anywhere else (for example recording a voice clip in a chat) Thrum asks first, and can remember the answer until it quits.
- **Popups** opened by a non-Facebook frame embedded in a page are closed before they are shown, so they cannot display a fake login page in a window with no address bar.
- **Command-line switches** that would let another program intercept the Facebook session are refused: `--proxy-server`, `--proxy-pac-url`, `--host-resolver-rules`, `--host-rules`, `--ignore-certificate-errors`, `--ignore-certificate-errors-spki-list` and `--disable-web-security`, as well as the remote-debugging switches already refused. If you need a proxy, set it in your system's proxy settings, which Thrum uses.
- **macOS:** the app runs with the hardened runtime, so other programs cannot inject code into it through `DYLD_*` variables or a debugger. After updating, macOS may ask once more for the Keychain ("Thrum Safe Storage") and for microphone/camera access.
- **Release process:** release builds no longer fetch `@electron/fuses` or `wingetcreate` unpinned at build time, launch the signed macOS app as a smoke test, and no longer fail at random on Windows while downloading Electron for the tests.
- PRIVACY.md now says plainly that someone who can edit your files can turn the app lock off, and that releases are verified against GitHub, not a separate signing key.

## 0.4.0

- **Updates itself.** *Check for Updates…* → **Update now** downloads the release for your system from GitHub, verifies it against the release's SHA-256 checksums, and installs it on restart, keeping the old version until the new one is in place. *Later* installs it the next time you quit. Works for the macOS app, the Windows zip and setup installs, and the Linux AppImage; Homebrew and `.deb` installs keep using their package manager.
- Tests now run on Linux, macOS and Windows.

## 0.3.1

- Fix: Facebook saw "Electron" in the user agent since 0.2.0, because account views were created before their session was configured.
- Fix: the *Accounts* menu did not update its unread counts.
- Fix: updating from Messenger Lite could start with an empty profile instead of moving the old data folder.
- LICENSE now contains the full Apache License 2.0 text.

## 0.3.0

- Renamed from Messenger Lite to **Thrum**. Updating keeps settings and accounts; on macOS you sign in once more, because the cookie key in the Keychain was stored under the old name.
- License changed from MIT to Apache License 2.0.
- Homebrew 6: install the cask by its fully qualified name, `thangldw/thrum/thrum`.

## 0.2.0

- Several accounts, each with its own login, all running in the background.
- Focus schedule for pausing notifications, edited in a new settings window.
- Runs in the background with a menu bar/tray icon; optional *Open at login*.
- Pause notifications, global shortcut, app lock with Touch ID, privacy screen, private mode, reopen last conversation.
- Recovers from network drops, crashes and hangs.
- Opt-in check for new versions.
- Homebrew cask, winget manifests, Windows ARM builds and a `.deb` for Linux.
- Lower memory use with a single account.

## 0.1.2

- Photos open in the app's viewer; chat attachments download instead of opening in the browser.
- New app icon.

## 0.1.1

- First public release: Facebook Messenger in a desktop window with the News Feed blocked.
- One-line installers for macOS and Windows that verify checksums.
- Hardened build: cookie encryption, Electron fuses, strict navigation and permission policy.
- [PRIVACY.md](PRIVACY.md) with tests that enforce it.
