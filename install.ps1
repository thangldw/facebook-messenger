# Messenger Lite installer for Windows (Windows PowerShell 5.1+ or PowerShell 7).
#
#   irm https://raw.githubusercontent.com/thangldw/facebook-messenger/main/install.ps1 | iex
#
# Downloads the prebuilt app (a zip, no installer .exe) from the latest GitHub
# Release, verifies its SHA-256 against the release's SHA256SUMS.txt, extracts
# it to %LOCALAPPDATA%\Programs\Messenger Lite and adds a Start menu shortcut.
# No admin rights needed. Re-run to update; your login is kept.
#
# Environment overrides:
#   MESSENGER_LITE_VERSION   install a specific tag, e.g. v0.1.0 (default: latest)
#   MESSENGER_LITE_DIR       install directory
#   MESSENGER_LITE_ZIP       install from a local zip instead of downloading (testing)
#   MESSENGER_LITE_NO_OPEN=1 do not launch the app after installing

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'thangldw/facebook-messenger'
  $AppName = 'Messenger Lite'
  $ExeName = 'Messenger Lite.exe'

  function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
  function Die($msg) { Write-Host "Error: $msg" -ForegroundColor Red; throw $msg }

  if ($env:OS -ne 'Windows_NT') { Die 'This installer is for Windows. On macOS use install.sh.' }
  if (-not [Environment]::Is64BitOperatingSystem) { Die 'Messenger Lite needs 64-bit Windows.' }

  $dest = $env:MESSENGER_LITE_DIR
  if (-not $dest) { $dest = Join-Path $env:LOCALAPPDATA "Programs\$AppName" }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("messenger-lite-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null

  try {
    if ($env:MESSENGER_LITE_ZIP) {
      $zip = $env:MESSENGER_LITE_ZIP
      if (-not (Test-Path $zip)) { Die "No such file: $zip" }
      Say "Installing from local file $zip (checksum not verified)"
    } else {
      $tag = $env:MESSENGER_LITE_VERSION
      if (-not $tag) {
        $rel = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'messenger-lite-installer' } `
          -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $tag = $rel.tag_name
        if (-not $tag) { Die "No release found for $Repo." }
      }
      $asset = "MessengerLite-$($tag.TrimStart('v'))-win-x64.zip"
      $base = "https://github.com/$Repo/releases/download/$tag"
      $zip = Join-Path $tmp $asset

      Say "Downloading $AppName $tag"
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $zip
      $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt").Content
      if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }

      Say 'Verifying SHA-256'
      $pattern = "^([0-9a-f]{64})\s+\*?$([regex]::Escape($asset))\s*$"
      $line = ($sums -split "`n") | Where-Object { $_ -match $pattern } | Select-Object -First 1
      if (-not $line -or -not ($line -match $pattern)) { Die "$asset is not listed in SHA256SUMS.txt" }
      $expected = $Matches[1]
      $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
      if ($actual -ne $expected) { Die 'Checksum mismatch: the download is corrupt or was tampered with.' }
    }

    Say 'Extracting'
    $extract = Join-Path $tmp 'extract'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    if (-not (Test-Path (Join-Path $extract $ExeName))) { Die "Archive does not contain $ExeName" }

    $running = Get-Process -Name $AppName -ErrorAction SilentlyContinue
    if ($running) {
      Say 'Closing the running app'
      $running | Stop-Process -Force
      Start-Sleep -Seconds 2
    }

    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Move-Item -Path $extract -Destination $dest
    # Files fetched by PowerShell are not marked as downloaded from the internet,
    # but clear the mark anyway so SmartScreen does not prompt for a zip copied in by hand.
    Get-ChildItem -Path $dest -Recurse -File | Unblock-File

    $exe = Join-Path $dest $ExeName
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $startMenu "$AppName.lnk"))
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation = "$exe,0"
    $lnk.Save()

    Say "Installed to $dest (Start menu: $AppName)"
    if (-not $env:MESSENGER_LITE_NO_OPEN) { Start-Process -FilePath $exe }
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
