'use strict';

// Installs a downloaded, checksum-verified release over the running app.
// No network here: downloads happen in updater.js. The new version is
// unpacked and checked while the app still runs, so problems are reported
// before anything is touched; the swap itself is done by a small helper
// script that waits for the app to exit, keeps the old version until the new
// one is in place (and puts it back if that fails), then relaunches it.
//
// Supported installs: the macOS app (zip / install.sh / dmg), the Windows zip
// (install.ps1) and setup.exe installs, and the Linux AppImage. Homebrew and
// .deb installs are updated with their package manager instead.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'Thrum';

function isWritable(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; }
}

const manual = (reason) => ({ kind: 'manual', reason });

/**
 * Works out how this copy of the app was installed and so how to update it.
 * Every input can be overridden for tests.
 * @returns {{kind: 'mac'|'win-zip'|'win-setup'|'appimage', target: string, asset: (v: string) => string} | {kind: 'brew'|'manual', reason?: string}}
 */
function installInfo({
  platform = process.platform,
  arch = process.arch,
  execPath = process.execPath,
  env = process.env,
  isPackaged = true,
  exists = fs.existsSync,
  writable = isWritable,
} = {}) {
  if (!isPackaged) return manual('not-packaged');
  const p = platform === 'win32' ? path.win32 : path.posix;

  if (platform === 'darwin') {
    // .../Thrum.app/Contents/MacOS/Thrum
    const target = p.resolve(execPath, '..', '..', '..');
    if (!target.endsWith('.app')) return manual('unknown-layout');
    // Homebrew installs the cask to /Applications; let `brew upgrade` own that copy.
    const brew = ['/opt/homebrew/Caskroom/thrum', '/usr/local/Caskroom/thrum'].some((c) => exists(c));
    if (brew && target === `/Applications/${APP_NAME}.app`) return { kind: 'brew' };
    if (!['arm64', 'x64'].includes(arch)) return manual('unsupported-arch');
    if (!writable(p.dirname(target)) || !writable(target)) return manual('not-writable');
    return { kind: 'mac', target, asset: (v) => `${APP_NAME}-${v}-mac-${arch}.zip` };
  }

  if (platform === 'win32') {
    const dir = p.dirname(execPath);
    if (!['arm64', 'x64'].includes(arch)) return manual('unsupported-arch');
    if (!writable(dir)) return manual('not-writable');
    // setup.exe installs carry electron-builder's uninstaller next to the app.
    if (exists(p.join(dir, `Uninstall ${APP_NAME}.exe`))) {
      return { kind: 'win-setup', target: dir, asset: (v) => `${APP_NAME}-${v}-win-${arch}-setup.exe` };
    }
    return { kind: 'win-zip', target: dir, asset: (v) => `${APP_NAME}-${v}-win-${arch}.zip` };
  }

  if (platform === 'linux') {
    const image = env.APPIMAGE;
    if (!image || arch !== 'x64') return manual('package-manager');
    if (!writable(p.dirname(image))) return manual('not-writable');
    return { kind: 'appimage', target: image, asset: (v) => `${APP_NAME}-${v}-linux-x86_64.AppImage` };
  }
  return manual('unsupported-platform');
}

// A private working folder for one update. For the AppImage it must be on the
// same filesystem as the target so the final rename is atomic.
function workDir(info) {
  const base = info.kind === 'appimage' ? path.dirname(info.target) : os.tmpdir();
  return fs.mkdtempSync(path.join(base, '.thrum-update-'));
}

// Unpacks and checks the downloaded file. Throws if it is not a usable build.
// Returns what apply() needs.
function prepare(info, file, dir) {
  if (info.kind === 'mac') {
    const extract = path.join(dir, 'extract');
    execFileSync('/usr/bin/ditto', ['-x', '-k', file, extract]);
    const app = path.join(extract, `${APP_NAME}.app`);
    if (!fs.existsSync(app)) throw new Error(`The download does not contain ${APP_NAME}.app`);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' });
    try { execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app], { stdio: 'ignore' }); } catch { /* not set */ }
    return { ...info, dir, source: app };
  }
  if (info.kind === 'win-zip') {
    const extract = path.join(dir, 'extract');
    fs.mkdirSync(extract);
    // tar.exe (bsdtar) ships with Windows 10 1803+ and reads zip files.
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', extract], { windowsHide: true });
    if (!fs.existsSync(path.join(extract, `${APP_NAME}.exe`))) throw new Error(`The download does not contain ${APP_NAME}.exe`);
    return { ...info, dir, source: extract };
  }
  if (info.kind === 'win-setup') return { ...info, dir, source: file };
  if (info.kind === 'appimage') {
    fs.chmodSync(file, 0o755);
    return { ...info, dir, source: file };
  }
  throw new Error('This install cannot update itself');
}

const MAC_HELPER = `#!/bin/sh
# Thrum updater: swap the app bundle once the old version has exited.
PID="$1"; NEW="$2"; APP="$3"; WORK="$4"; RELAUNCH="$5"
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done
sleep 1
OLD="$APP.previous-version"
rm -rf "$OLD"
if mv "$APP" "$OLD"; then
  if mv "$NEW" "$APP"; then rm -rf "$OLD"; else mv "$OLD" "$APP"; fi
fi
rm -rf "$WORK"
if [ "$RELAUNCH" = 1 ]; then open "$APP"; fi
`;

const WIN_HELPER = `# Thrum updater: replace the app once the old version has exited.
param([int]$AppPid, [string]$Kind, [string]$Source, [string]$Target, [string]$Work, [int]$Relaunch)
$ErrorActionPreference = 'Stop'
try { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 1
$exe = Join-Path $Target 'Thrum.exe'
try {
  if ($Kind -eq 'win-setup') {
    Start-Process -FilePath $Source -ArgumentList '/S' -Wait
  } else {
    $old = "$Target.previous-version"
    if (Test-Path $old) { Remove-Item -Recurse -Force $old }
    $moved = $false
    for ($i = 0; $i -lt 20 -and -not $moved; $i++) {
      try { Rename-Item -Path $Target -NewName (Split-Path $old -Leaf); $moved = $true } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($moved) {
      try { Move-Item -Path $Source -Destination $Target; Remove-Item -Recurse -Force $old }
      catch { if (-not (Test-Path $exe)) { Rename-Item -Path $old -NewName (Split-Path $Target -Leaf) } }
    }
  }
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
  if ($Relaunch -eq 1 -and (Test-Path $exe)) { Start-Process -FilePath $exe }
}
`;

/**
 * Installs a prepared update. Call it while quitting: the helper waits for
 * this process to exit. For the AppImage the file is replaced right away
 * (the running copy stays mounted) and Electron relaunches it.
 * @param {object} prepared from prepare()
 * @param {{relaunch: boolean, relaunchApp: (opts: object) => void}} opts
 */
function apply(prepared, { relaunch, relaunchApp }) {
  const { kind, source, target, dir } = prepared;
  if (kind === 'appimage') {
    fs.renameSync(source, target);
    fs.rmSync(dir, { recursive: true, force: true });
    if (relaunch) relaunchApp({ execPath: target, args: [] });
    return;
  }
  if (kind === 'mac') {
    const script = path.join(dir, 'update.sh');
    fs.writeFileSync(script, MAC_HELPER, { mode: 0o700 });
    spawn('/bin/sh', [script, String(process.pid), source, target, dir, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (kind === 'win-zip' || kind === 'win-setup') {
    const script = path.join(dir, 'update.ps1');
    fs.writeFileSync(script, WIN_HELPER);
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    spawn(ps, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
      '-AppPid', String(process.pid), '-Kind', kind, '-Source', source, '-Target', target, '-Work', dir, '-Relaunch', relaunch ? '1' : '0',
    ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  throw new Error('This install cannot update itself');
}

module.exports = { installInfo, workDir, prepare, apply, MAC_HELPER, WIN_HELPER };
