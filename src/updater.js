'use strict';

// Opt-in update check (off by default). When enabled, asks GitHub once a day
// for the latest release of this project. This is the only request the app
// itself makes: it goes to API_URL only, from the default session (no
// Facebook cookies), and sends nothing but a User-Agent with the app version.

const { app, net } = require('electron');
const fs = require('fs');

const API_URL = 'https://api.github.com/repos/thangldw/thrum/releases/latest';
const RELEASES_URL = 'https://github.com/thangldw/thrum/releases/';
const DAY = 24 * 60 * 60 * 1000;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? m.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Validate the API response before using any of it.
function parseRelease(json) {
  if (!json || typeof json !== 'object') return null;
  const { tag_name: tag, html_url: url } = json;
  if (typeof tag !== 'string' || !parseVersion(tag)) return null;
  if (typeof url !== 'string' || !url.startsWith(RELEASES_URL)) return null;
  return { version: tag.replace(/^v/, ''), url };
}

function updateCommand() {
  if (process.platform === 'darwin') {
    const brew = ['/opt/homebrew/Caskroom/thrum', '/usr/local/Caskroom/thrum'].some((p) => fs.existsSync(p));
    return brew
      ? 'brew upgrade --cask thangldw/thrum/thrum'
      : 'curl -fsSL https://raw.githubusercontent.com/thangldw/thrum/main/install.sh | bash';
  }
  if (process.platform === 'win32') {
    return 'irm https://raw.githubusercontent.com/thangldw/thrum/main/install.ps1 | iex';
  }
  return null;
}

class Updater {
  constructor({ settings, onAvailable }) {
    this.settings = settings;
    this.onAvailable = onAvailable;
    this.available = null;
    this.timer = setInterval(() => this.autoCheck(), 60 * 60 * 1000);
    setTimeout(() => this.autoCheck(), 60 * 1000);
  }

  async autoCheck() {
    if (!this.settings.get('checkForUpdates')) return;
    if (Date.now() - this.settings.get('lastUpdateCheck') < DAY) return;
    await this.check().catch(() => null);
  }

  // Returns { version, url } if a newer release exists, null otherwise.
  // Throws on network/HTTP errors (shown to the user for manual checks).
  async check() {
    const res = await net.fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Thrum/${app.getVersion()}` },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
    this.settings.set('lastUpdateCheck', Date.now());
    const release = parseRelease(await res.json());
    if (!release) throw new Error('Unexpected response from GitHub');
    const wasKnown = this.available && this.available.version === release.version;
    this.available = isNewer(release.version, app.getVersion()) ? release : null;
    if (this.available && !wasKnown) this.onAvailable(this.available);
    return this.available;
  }
}

module.exports = { Updater, isNewer, parseRelease, updateCommand, API_URL, RELEASES_URL };
