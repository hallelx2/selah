# Installs Selah on Windows from the GitHub release.
#
#   irm https://selah.hallelx2.com/install.ps1 | iex
#
# Environment:
#   SELAH_VERSION        a release tag such as v0.3.1 (default: the latest release)
#   SELAH_INSTALL_DIR    where to put selah.exe (default: %LOCALAPPDATA%\Programs\selah)
#   SELAH_DOWNLOAD_BASE  override the download URL prefix (used by tests)
#   SELAH_NO_PATH        set to 1 to leave PATH alone
#
# It runs inside the caller's own shell when piped to iex, so it never calls exit: errors are
# thrown, which stops the install and leaves the window open.

function Install-Selah {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell 5.1 shows a byte-by-byte progress bar that makes downloads crawl.
  $ProgressPreference = 'SilentlyContinue'
  # ...and may not offer TLS 1.2 by default, which GitHub requires.
  if ($PSVersionTable.PSEdition -ne 'Core') {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }

  $repo = 'hallelx2/selah'
  $version = if ($env:SELAH_VERSION) { $env:SELAH_VERSION } else { 'latest' }
  $onWindows = ($PSVersionTable.PSEdition -ne 'Core') -or $IsWindows
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData/Local' }
  $dir = if ($env:SELAH_INSTALL_DIR) { $env:SELAH_INSTALL_DIR } else { Join-Path $localAppData 'Programs\selah' }

  # The operating system's architecture, not this PowerShell's: an x64 shell on ARM64 Windows
  # still gets the native ARM64 build.
  $arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw "Selah has no Windows build for a $_ processor. Build it from source with bun (see the README)." }
  }
  $asset = "selah-windows-$arch.exe"

  $base = if ($env:SELAH_DOWNLOAD_BASE) { $env:SELAH_DOWNLOAD_BASE.TrimEnd('/') }
          elseif ($version -eq 'latest') { "https://github.com/$repo/releases/latest/download" }
          else { "https://github.com/$repo/releases/download/$version" }

  Write-Host ''
  Write-Host '  Selah, a Bible for the terminal'
  Write-Host ''
  Write-Host "  downloading $asset ($version)"

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("selah-" + [System.Guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $exe = Join-Path $tmp 'selah.exe'
    $sums = Join-Path $tmp 'SHA256SUMS'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $exe
      Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
    } catch {
      throw "Could not download $base/$asset ($($_.Exception.Message))"
    }

    $line = Get-Content $sums | Where-Object { $_ -match "^([0-9a-fA-F]{64})\s+$([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $line) { throw "No checksum is listed for $asset" }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset (expected $expected, got $actual)" }
    Write-Host '  checksum ok'

    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir 'selah.exe'
    Move-Item -Force -Path $exe -Destination $target
    # Downloaded files carry a Mark of the Web; unblock so SmartScreen does not stop it.
    if ($onWindows) { Unblock-File -Path $target -ErrorAction SilentlyContinue }
    Write-Host "  installed to $target"
  } finally {
    Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
  }

  if ($env:SELAH_NO_PATH -ne '1') {
    if ($onWindows) {
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $parts = @($userPath -split ';' | Where-Object { $_ })
      if ($parts -notcontains $dir) {
        [Environment]::SetEnvironmentVariable('Path', (@($parts) + $dir) -join ';', 'User')
        Write-Host "  added $dir to your PATH"
      }
      # this window too, so selah works without opening a new one
      if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$env:Path;$dir" }
    } else {
      Write-Host "  add $dir to your PATH to run selah from anywhere"
    }
  }

  Write-Host ''
  Write-Host '  Run  selah  to start. The first launch downloads the KJV and BSB once (about 16 MB).'
  Write-Host '  Windows Terminal shows Selah best; the classic console works with fewer colours.'
  Write-Host ''
}

Install-Selah
