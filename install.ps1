# songsterr-pdf installer for Windows (PowerShell 5.1+ or PowerShell 7).
#
#   irm https://raw.githubusercontent.com/j4ckxyz/songsterr-pdf/main/install.ps1 | iex
#
# Environment overrides:
#   SONGSTERR_PDF_INSTALL_DIR  where to put the exe  (default: %LOCALAPPDATA%\Programs\songsterr-pdf)
#   SONGSTERR_PDF_VERSION      e.g. 1.0.0            (default: latest)
#   SONGSTERR_PDF_REPO         owner/repo on GitHub  (default: j4ckxyz/songsterr-pdf)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow on PS 5.1

function Install-SongsterrPdf {
  $Repo = if ($env:SONGSTERR_PDF_REPO) { $env:SONGSTERR_PDF_REPO } else { 'j4ckxyz/songsterr-pdf' }
  $InstallDir = if ($env:SONGSTERR_PDF_INSTALL_DIR) { $env:SONGSTERR_PDF_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\songsterr-pdf' }
  $Version = if ($env:SONGSTERR_PDF_VERSION) { $env:SONGSTERR_PDF_VERSION } else { 'latest' }

  # -- Detect platform --------------------------------------------------------
  $build = [Environment]::OSVersion.Version.Build
  if ($build -lt 17763) {
    throw "Windows 10 version 1809 (build 17763) or newer is required; this is build $build."
  }
  $osArch = try { [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch { $env:PROCESSOR_ARCHITECTURE }
  $arch = switch -Regex ($osArch) {
    'Arm64' { 'arm64' }
    'X64|AMD64' { 'x64' }
    default { throw "Unsupported CPU architecture: $osArch (need x64 or ARM64)." }
  }
  $asset = "songsterr-pdf-windows-$arch.exe"

  if ($Version -eq 'latest') {
    $base = "https://github.com/$Repo/releases/latest/download"
    $tag = $null
  } else {
    $tag = 'v' + $Version.TrimStart('v')
    $base = "https://github.com/$Repo/releases/download/$tag"
  }

  Write-Host "Installing songsterr-pdf " -NoNewline -ForegroundColor White
  Write-Host "(windows-$arch)" -ForegroundColor DarkGray

  # -- Download ---------------------------------------------------------------
  # PowerShell 5.1 defaults to TLS 1.0; GitHub needs 1.2+.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("songsterr-pdf-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $exeTmp = Join-Path $tmp $asset
    $sumsTmp = Join-Path $tmp 'SHA256SUMS'
    Write-Host "> Downloading $asset" -ForegroundColor DarkGray
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $exeTmp
      Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sumsTmp
    } catch {
      # Private repositories aren't downloadable anonymously; fall back to the GitHub CLI's login.
      $gh = Get-Command gh -ErrorAction SilentlyContinue
      if (-not $gh) {
        throw "Couldn't download $base/$asset. If the repository is private, install the GitHub CLI (https://cli.github.com), run 'gh auth login', and try again."
      }
      Write-Host "> Public download unavailable, using your GitHub CLI login" -ForegroundColor DarkGray
      $ghArgs = @('release', 'download')
      if ($tag) { $ghArgs += $tag }
      $ghArgs += @('--repo', $Repo, '--pattern', $asset, '--pattern', 'SHA256SUMS', '--dir', $tmp, '--clobber')
      & gh @ghArgs
      if ($LASTEXITCODE -ne 0) { throw "Couldn't download $asset from $Repo with gh." }
    }

    # -- Verify ---------------------------------------------------------------
    $line = Get-Content $sumsTmp | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $line) { throw "SHA256SUMS has no entry for $asset." }
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $exeTmp).Hash.ToLower()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset - download corrupted?" }
    Write-Host "> Checksum verified" -ForegroundColor DarkGray

    # -- Install --------------------------------------------------------------
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $target = Join-Path $InstallDir 'songsterr-pdf.exe'
    if (Test-Path $target) {
      # A running exe can't be overwritten, but it can be renamed out of the way.
      Remove-Item "$target.old" -Force -ErrorAction SilentlyContinue
      Move-Item $target "$target.old" -Force
    }
    Move-Item $exeTmp $target -Force
    Remove-Item "$target.old" -Force -ErrorAction SilentlyContinue

    $installed = & $target --version
    if ($LASTEXITCODE -ne 0) { throw "The installed program failed to run." }
    Write-Host "> Installed $installed to $target" -ForegroundColor DarkGray
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }

  # -- PATH -------------------------------------------------------------------
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @($userPath -split ';' | Where-Object { $_ })
  if ($entries -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable('Path', (($entries + $InstallDir) -join ';'), 'User')
    Write-Host "> Added $InstallDir to your PATH" -ForegroundColor DarkGray
  }
  if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path = "$env:Path;$InstallDir" }

  Write-Host ""
  Write-Host "[ok] songsterr-pdf is installed!" -ForegroundColor Green
  Write-Host "  Run it with: songsterr-pdf" -ForegroundColor White
  Write-Host "  (new terminal windows will find it automatically)" -ForegroundColor DarkGray
}

Install-SongsterrPdf
