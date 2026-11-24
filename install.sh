#!/usr/bin/env bash
# Messenger Lite installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/thangldw/facebook-messenger/main/install.sh | bash
#
# Downloads the prebuilt app from the latest GitHub Release, verifies its
# SHA-256 against the release's SHA256SUMS.txt, and installs it into
# ~/Applications. Re-run to update; your login is kept.
#
# Environment overrides:
#   MESSENGER_LITE_VERSION   install a specific tag, e.g. v0.1.0 (default: latest)
#   MESSENGER_LITE_DIR       install directory (default: ~/Applications)
#   MESSENGER_LITE_ZIP       install from a local zip instead of downloading (testing)
#   MESSENGER_LITE_NO_OPEN=1 do not launch the app after installing

set -euo pipefail

REPO="thangldw/facebook-messenger"
APP_NAME="Messenger Lite"
TMP_DIR=""
# Global, not local: the EXIT trap runs after main() has returned.
trap 'if [ -n "${TMP_DIR:-}" ]; then rm -rf "$TMP_DIR"; fi' EXIT

main() {
  say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
  die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

  [ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. On Windows use install.ps1."

  local arch
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64)
      # An Apple Silicon Mac running this shell under Rosetta still wants arm64.
      if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then arch="arm64"; else arch="x64"; fi ;;
    *) die "Unsupported CPU: $(uname -m)" ;;
  esac

  local dest="${MESSENGER_LITE_DIR:-$HOME/Applications}"
  TMP_DIR="$(mktemp -d)"
  local tmp="$TMP_DIR"

  local zip
  if [ -n "${MESSENGER_LITE_ZIP:-}" ]; then
    zip="$MESSENGER_LITE_ZIP"
    [ -f "$zip" ] || die "No such file: $zip"
    say "Installing from local file $zip (checksum not verified)"
  else
    local tag="${MESSENGER_LITE_VERSION:-}"
    if [ -z "$tag" ]; then
      # /releases/latest redirects to /releases/tag/<tag>; no API token needed.
      tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
      tag="${tag##*/}"
      case "$tag" in v*) ;; *) die "No release found for $REPO." ;; esac
    fi
    local asset="MessengerLite-${tag#v}-mac-${arch}.zip"
    local base="https://github.com/$REPO/releases/download/$tag"

    say "Downloading $APP_NAME $tag ($arch)"
    curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || die "Download failed: $base/$asset"
    curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt" || die "Could not download SHA256SUMS.txt"

    say "Verifying SHA-256"
    grep -E "  $asset\$" "$tmp/SHA256SUMS.txt" > "$tmp/expected.txt" || die "$asset is not listed in SHA256SUMS.txt"
    (cd "$tmp" && shasum -a 256 -c expected.txt >/dev/null) || die "Checksum mismatch: the download is corrupt or was tampered with."
    zip="$tmp/$asset"
  fi

  say "Extracting"
  ditto -x -k "$zip" "$tmp/extract"
  local app="$tmp/extract/$APP_NAME.app"
  [ -d "$app" ] || die "Archive does not contain $APP_NAME.app"
  codesign --verify --deep --strict "$app" 2>/dev/null || die "App signature is invalid."
  # curl does not set the quarantine flag; clear it anyway in case the zip came from a browser.
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

  if pgrep -f "$APP_NAME.app/Contents/MacOS/" >/dev/null 2>&1; then
    say "Closing the running app"
    osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$APP_NAME.app/Contents/MacOS/" >/dev/null 2>&1 || break; sleep 1; done
  fi

  mkdir -p "$dest"
  rm -rf "$dest/$APP_NAME.app"
  mv "$app" "$dest/$APP_NAME.app"
  say "Installed to $dest/$APP_NAME.app"

  if [ -z "${MESSENGER_LITE_NO_OPEN:-}" ]; then
    open "$dest/$APP_NAME.app"
  fi
}

main "$@"
