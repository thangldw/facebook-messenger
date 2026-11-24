'use strict';

// Opt-in update check (off by default). When enabled, asks GitHub once a day
// for the latest release of this project. These are the only requests the app
// itself makes: the check goes to API_URL only, and an update (only when you
// click "Update") downloads this project's release files from GitHub. Both use
// the default session (no Facebook cookies) and send nothing but a User-Agent
// with the app version.

const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');

const API_URL = 'https://api.github.com/repos/thangldw/thrum/releases/latest';
const RELEASES_URL = 'https://github.com/thangldw/thrum/releases/';
const DOWNLOAD_BASE = 'https://github.com/thangldw/thrum/releases/download/';
// github.com answers release downloads with a redirect to its file storage.
// Every hop must stay on these hosts, over https.
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_REDIRECTS = 5;
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

function releaseFileUrl(version, name) {
  if (!parseVersion(version) || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('Invalid release file');
  return `${DOWNLOAD_BASE}v${version}/${name}`;
}

// "<sha256>  <file>" lines (sha256sum format), as published with every release.
function parseSums(text) {
  const sums = {};
  for (const line of String(text).split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

function allowedDownloadUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === 'https:' && DOWNLOAD_HOSTS.has(url.hostname);
}

// Requests one release file. Redirects are followed by hand so that every
// hop is checked, not just the first. No cookies are sent (useSessionCookies
// is false). Resolves with the response stream once a 200 arrives.
function getReleaseFile(url) {
  return new Promise((resolve, reject) => {
    if (!allowedDownloadUrl(url)) { reject(new Error('Download left GitHub')); return; }
    const req = net.request({ url, redirect: 'manual', useSessionCookies: false, cache: 'no-store' });
    req.setHeader('User-Agent', `Thrum/${app.getVersion()}`);
    let hops = 0;
    req.on('redirect', (_status, _method, next) => {
      hops += 1;
      if (hops > MAX_REDIRECTS || !allowedDownloadUrl(next)) {
        req.abort();
        reject(new Error('Download left GitHub'));
        return;
      }
      req.followRedirect();
    });
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        res.on('data', () => {});
        reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

async function readText(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Downloads one file of a release to dest and checks it against the release's
// SHA256SUMS.txt (the same check the install scripts make). The file is
// deleted again if anything fails. onProgress(fraction) is optional.
async function downloadReleaseFile(version, name, dest, onProgress = () => {}) {
  const sums = parseSums(await readText(await getReleaseFile(releaseFileUrl(version, 'SHA256SUMS.txt'))));
  const expected = sums[name];
  if (!expected) throw new Error(`${name} is not listed in SHA256SUMS.txt`);
  const res = await getReleaseFile(releaseFileUrl(version, name));
  const total = Number(res.headers['content-length']) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest, { mode: 0o600 });
  const closed = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
  let received = 0;
  try {
    for await (const chunk of res) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (total) onProgress(Math.min(received / total, 1));
    }
    out.end();
    await closed;
    if (hash.digest('hex') !== expected) throw new Error('Checksum mismatch: the download is corrupt or was tampered with.');
  } catch (err) {
    out.destroy();
    fs.rmSync(dest, { force: true });
    throw err;
  }
  return dest;
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

module.exports = {
  Updater, isNewer, parseRelease, updateCommand, API_URL, RELEASES_URL,
  downloadReleaseFile, releaseFileUrl, parseSums, allowedDownloadUrl, DOWNLOAD_HOSTS,
};
