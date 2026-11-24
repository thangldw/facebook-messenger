# Thrum

A quiet desktop app for Facebook Messenger on macOS, Windows and Linux. Chat without opening Facebook in a browser, and without the feed.

Thrum runs Facebook's own web client (`facebook.com/messages`) in a dedicated window. There is no reverse-engineered protocol and no unofficial API: it behaves like Messenger in a browser tab, minus the rest of Facebook.

> Thrum is an independent project, not affiliated with or endorsed by Meta. "Facebook" and "Messenger" are trademarks of Meta Platforms, Inc., used here only to describe what the app works with.

## Features

**Messaging**
- Messages only: the News Feed, Watch, Reels and Marketplace bounce back to your inbox; profiles, posts and links open in your browser.
- Voice and video calls, with screen sharing (the native picker on macOS 15+, a source chooser elsewhere; system audio on Windows).
- Photos open in the app's viewer; attachments download to a folder you choose.
- Several accounts, each with its own login, all running at once. Switch with `Cmd/Ctrl + 1…9`, the *Accounts* menu or the tray.
- Reopens your last conversation on launch.

**Staying in touch, on your terms**
- Native notifications and an unread count on the menu bar/tray icon, the dock (macOS) and the taskbar (Windows).
- Keeps running in the background when you close the window; optional *Open at login*.
- Pause notifications for an hour, until tomorrow morning, until you resume, or on a weekly focus schedule.
- Global shortcut to show or hide Thrum: `⌃⌥M` on macOS, `Ctrl+Alt+Shift+M` on Windows and Linux.

**Privacy**
- App lock with a password (and Touch ID on macOS): on launch, when the computer locks or sleeps, or after a period of inactivity.
- Privacy screen: blurs the window whenever it is not in front.
- Private mode: nothing is written to disk; you are logged out when you quit.

**Maintenance-free**
- Updates itself: *Check for Updates…*, then **Update now**. The download is checked against the release's SHA-256 checksums and swapped in on restart.
- Reconnects after network drops and reloads after a crash or hang.

Settings live in the **Settings** menu; accounts and the focus schedule are edited in the settings window (`Cmd/Ctrl + ,`).

## Privacy in one paragraph

Thrum never sees, stores or sends your Facebook username or password: you sign in on Facebook's own page, which talks straight to Facebook. The app keeps only what a browser keeps to stay signed in (a session cookie, encrypted with your OS keychain) and sends nothing anywhere itself, apart from an update check that is off by default. [PRIVACY.md](PRIVACY.md) explains how this is enforced and how to verify it yourself.

## Install

The one-line installers download the latest release, verify its SHA-256 checksum and install it without the "unidentified developer" (macOS) or SmartScreen (Windows) warnings. No admin rights are needed.

**macOS** (Apple Silicon and Intel), in Terminal. Installs to `~/Applications/Thrum.app`:

```bash
curl -fsSL https://raw.githubusercontent.com/thangldw/thrum/main/install.sh | bash
```

Or with Homebrew:

```bash
brew tap thangldw/thrum https://github.com/thangldw/thrum
brew install --cask thangldw/thrum/thrum
```

**Windows 10/11** (x64 and ARM), in PowerShell. Installs to `%LOCALAPPDATA%\Programs\Thrum` with a Start menu shortcut:

```powershell
irm https://raw.githubusercontent.com/thangldw/thrum/main/install.ps1 | iex
```

**Linux** (x64): download the `.deb` from the [latest release](https://github.com/thangldw/thrum/releases/latest) and run `sudo apt install ./Thrum-<version>-linux-amd64.deb`, or use the AppImage on other distributions.

Both scripts are short; read [install.sh](install.sh) and [install.ps1](install.ps1) first if you like.

### Manual download

Every [release](https://github.com/thangldw/thrum/releases/latest) has:

| System | File |
|---|---|
| macOS | `Thrum-<version>-mac-arm64` (Apple Silicon) or `-mac-x64` (Intel), as `.dmg` or `.zip` |
| Windows | `Thrum-<version>-win-x64` or `-win-arm64`, as `.zip` (unzip and run `Thrum.exe`) or `-setup.exe` |
| Linux | `Thrum-<version>-linux-amd64.deb` or `Thrum-<version>-linux-x86_64.AppImage` |

Builds are not signed with paid Apple or Microsoft certificates, so files downloaded with a browser are flagged:

- **macOS:** open the app once, then **System Settings → Privacy & Security → Open Anyway**.
- **Windows:** in SmartScreen click **More info → Run anyway**; for the zip, right-click → Properties → **Unblock** before extracting.

Each release also has `SHA256SUMS.txt` and a GitHub build attestation for every file; [PRIVACY.md](PRIVACY.md#1-the-download-is-built-from-this-source-code) shows how to check them.

### First launch

Sign in to Facebook in the window. If you use end-to-end encrypted chats, Messenger may ask for your PIN to restore your history, as in a browser. On macOS, answer the Keychain prompt for "Thrum Safe Storage" (the key that encrypts your session cookie) with **Always Allow**.

For calls, macOS asks for microphone and camera access the first time. Screen sharing also needs **System Settings → Privacy & Security → Screen & System Audio Recording** turned on for Thrum; restart Thrum afterwards.

### Updating

Use **Check for Updates…** (in the *Thrum* menu on macOS, the *File* menu elsewhere), or turn on *Settings → Check for updates automatically* to be told about new versions. **Update now** downloads the release for your system from GitHub, checks its checksum and installs it when Thrum restarts, keeping your logins and settings. Nothing is downloaded or installed until you click it.

Homebrew installs update with `brew upgrade --cask thangldw/thrum/thrum`, and `.deb` installs with a newer `.deb`. Re-running the install command also works.

### Uninstall

Quit Thrum, then delete:

- **macOS:** `~/Applications/Thrum.app` and `~/Library/Application Support/Thrum` (Homebrew: `brew uninstall --zap --cask thangldw/thrum/thrum`).
- **Windows:** `%LOCALAPPDATA%\Programs\Thrum`, `%APPDATA%\Thrum` and the Start menu shortcut, or use *Apps & features* if you installed with `setup.exe`.
- **Linux:** `sudo apt remove thrum` and `~/.config/Thrum`.

## Known limitations

- **A Facebook account is required.** Meta offers Messenger on the desktop only through facebook.com (messenger.com closed in April 2026), so Thrum cannot be used with a Messenger-only account, or with a deactivated Facebook account without reactivating it.
- **The unread count is Facebook's.** Thrum reads the number Facebook puts in the page title, which can include Facebook notifications as well as unread chats.
- **Notifications do not name the account** when you have several, because Thrum does not read Facebook's pages. The tray and *Accounts* menu show unread counts per account.
- On Windows and Linux, clicking a notification may not bring a hidden window to the front; use the tray icon or the global shortcut.
- Spellcheck is macOS-only: on Windows and Linux, Electron would download dictionaries from Google.
- After an update on macOS, the Keychain may ask again for "Thrum Safe Storage" (choose **Always Allow**), because builds are not signed with a paid certificate.
- If Meta changes its web client, hiding the top bar or a navigation rule may need an update.

## Contributing

Building from source, tests, the release process and how the code is organised are in [CONTRIBUTING.md](CONTRIBUTING.md). Changes per version are in [CHANGELOG.md](CHANGELOG.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
