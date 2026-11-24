#!/usr/bin/env node
'use strict';

// Generates package-manager files from a release's SHA256SUMS.txt.
//
//   node scripts/packaging.js cask   <version> <SHA256SUMS.txt>            -> rewrites Casks/thrum.rb
//   node scripts/packaging.js winget <version> <SHA256SUMS.txt> <out-dir>  -> writes winget manifests
//
// Run by the release workflow; can also be run by hand.

const fs = require('fs');
const path = require('path');

const REPO = 'thangldw/thrum';
const ROOT = path.join(__dirname, '..');

function readSums(file) {
  const sums = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

function need(sums, name) {
  if (!sums[name]) throw new Error(`${name} not found in SHA256SUMS`);
  return sums[name];
}

function checkVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Bad version: ${version}`);
}

function cask(version, sumsFile) {
  const sums = readSums(sumsFile);
  const arm = need(sums, `Thrum-${version}-mac-arm64.zip`);
  const intel = need(sums, `Thrum-${version}-mac-x64.zip`);
  const file = path.join(ROOT, 'Casks', 'thrum.rb');
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^ {2}version "[^"]*"$/m, `  version "${version}"`)
    .replace(/^ {2}sha256 arm: {3}"[0-9a-f]*",$/m, `  sha256 arm:   "${arm}",`)
    .replace(/^ {9}intel: "[0-9a-f]*"$/m, `         intel: "${intel}"`);
  if (!src.includes(arm) || !src.includes(intel) || !src.includes(`version "${version}"`)) {
    throw new Error('Cask template did not match; not updated');
  }
  fs.writeFileSync(file, src);
  console.log(`Updated ${path.relative(ROOT, file)} to ${version}`);
}

function winget(version, sumsFile, outDir) {
  const sums = readSums(sumsFile);
  const id = 'ThangLDW.Thrum';
  const dir = path.join(outDir, 'manifests', 't', 'ThangLDW', 'Thrum', version);
  fs.mkdirSync(dir, { recursive: true });
  const base = `https://github.com/${REPO}/releases/download/v${version}`;
  const header = (kind) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.1.6.0.schema.json\n`;
  const installer = (arch) => {
    const name = `Thrum-${version}-win-${arch}-setup.exe`;
    return [
      `  - Architecture: ${arch}`,
      `    InstallerUrl: ${base}/${name}`,
      `    InstallerSha256: ${need(sums, name).toUpperCase()}`,
    ].join('\n');
  };
  const files = {
    [`${id}.yaml`]: `${header('version')}PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`,
    [`${id}.installer.yaml`]: `${header('installer')}PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
  - silent
UpgradeBehavior: install
Installers:
${installer('x64')}
${installer('arm64')}
ManifestType: installer
ManifestVersion: 1.6.0
`,
    [`${id}.locale.en-US.yaml`]: `${header('defaultLocale')}PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Thang
PublisherUrl: https://github.com/thangldw
PackageName: Thrum
PackageUrl: https://github.com/${REPO}
License: Apache-2.0
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
ShortDescription: Desktop app for Facebook Messenger with the News Feed blocked.
Description: Thrum wraps Facebook's own web client at facebook.com/messages in a desktop app, without the News Feed, Watch or Marketplace. It never sees or stores your password and sends no data anywhere but Facebook.
Tags:
  - chat
  - facebook
  - messenger
  - messaging
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  console.log(`Wrote winget manifests to ${dir}`);
}

const [cmd, version, sumsFile, outDir] = process.argv.slice(2);
checkVersion(version || '');
if (cmd === 'cask') cask(version, sumsFile);
else if (cmd === 'winget' && outDir) winget(version, sumsFile, outDir);
else {
  console.error('usage: packaging.js cask <version> <sums> | winget <version> <sums> <out-dir>');
  process.exit(2);
}
