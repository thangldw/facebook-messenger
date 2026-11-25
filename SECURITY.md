# Security policy

## Supported versions

Only the latest release is supported. Each release ships the Electron (Chromium) version current at the time. Update with **Check for Updates… → Update now** in the app, or as described in the [README](README.md#updating).

## Reporting a vulnerability

Please report privately via GitHub: **Security → Report a vulnerability** on this repository ([private advisory](https://github.com/thangldw/thrum/security/advisories/new)). Do not open a public issue for security problems.

Useful to include: affected version and OS, steps to reproduce, and the impact you expect.

## Scope

In scope: this app's code (`src/`), the install scripts, and the release workflow, for example a way to show non-Facebook content in an app window, to read the session or page content from outside the page, to bypass a permission (such as getting the microphone or camera outside a call without asking), the route policy or the app lock, to make the in-app updater install something other than a genuine release, or to tamper with a release.

Out of scope: vulnerabilities in Facebook/Messenger itself (report them to [Meta](https://www.facebook.com/whitehat)) and in Electron/Chromium (report them [upstream](https://github.com/electron/electron/security)); this project picks up their fixes by updating Electron.

How the app protects your data is described in [PRIVACY.md](PRIVACY.md); fixed issues are listed in [CHANGELOG.md](CHANGELOG.md).
