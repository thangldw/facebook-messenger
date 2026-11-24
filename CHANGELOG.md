# Changelog

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
