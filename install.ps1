# Linear CLI Windows installer
# Usage:
#   irm https://raw.githubusercontent.com/HumanInTheLoopReal/linear/main/install.ps1 | iex
#
# Environment variable overrides:
#   LINEAR_INSTALL_SOURCE=registry           - install channel (npm registry
#                                              is the only one today)
#   LINEAR_INSTALL_VERSION=<semver>          - pin to a specific release
#   LINEAR_INSTALL_PREFIX=<dir>              - override npm prefix
#   LINEAR_INSTALL_SKIP_NODE_CHECK=1         - skip Node version check
#                                              (nvm-windows / volta users
#                                              who manage Node themselves)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

$Script:GitHubRepo        = "HumanInTheLoopReal/linear"
$Script:NpmPackage        = "@humanintheloop/linear"
$Script:RequiredNodeMajor = 22

$Script:InstallSource    = if ($env:LINEAR_INSTALL_SOURCE)    { $env:LINEAR_INSTALL_SOURCE }    else { "registry" }
$Script:InstallVersion   = if ($env:LINEAR_INSTALL_VERSION)   { $env:LINEAR_INSTALL_VERSION }   else { "latest" }
$Script:InstallPrefix    = $env:LINEAR_INSTALL_PREFIX
$Script:SkipNodeCheck    = ($env:LINEAR_INSTALL_SKIP_NODE_CHECK -eq "1")

# Resolved at runtime — recorded for PATH-precedence warnings.
$Script:LastInstallPath = $null

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

function Write-Info       ($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Success    ($Message) { Write-Host "==> $Message" -ForegroundColor Green }
function Write-WarningMsg ($Message) { Write-Warning $Message }
function Write-Err        ($Message) { Write-Host "Error: $Message" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

function Get-WindowsArch {
    try {
        $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
    } catch {
        $arch = $env:PROCESSOR_ARCHITECTURE
    }

    switch ("$arch") {
        "X64"   { return "amd64" }
        "AMD64" { return "amd64" }
        "Arm64" { return "arm64" }
        "ARM64" { return "arm64" }
        default { return $null }
    }
}

# ---------------------------------------------------------------------------
# Node check
# ---------------------------------------------------------------------------

function Print-NodeInstallHints {
    Write-Host ""
    Write-Host "  Linear CLI requires Node.js >= $($Script:RequiredNodeMajor)." -ForegroundColor Cyan
    Write-Host "  Install Node, then re-run this installer:" -ForegroundColor Cyan
    Write-Host ""

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $choco  = Get-Command choco  -ErrorAction SilentlyContinue
    $scoop  = Get-Command scoop  -ErrorAction SilentlyContinue

    if ($winget) {
        Write-Host "    winget install --exact --id OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    }
    if ($choco) {
        Write-Host "    choco install nodejs-lts -y" -ForegroundColor Yellow
        Write-Host "    (requires an elevated PowerShell)" -ForegroundColor Cyan
    }
    if ($scoop) {
        Write-Host "    scoop install nodejs-lts" -ForegroundColor Yellow
    }

    if (-not $winget -and -not $choco -and -not $scoop) {
        Write-Host "    Download the official installer:" -ForegroundColor Cyan
        Write-Host "      https://nodejs.org/" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "    Or download from https://nodejs.org/" -ForegroundColor Cyan
    }

    Write-Host ""
    Write-Host "  If you manage Node via nvm-windows or volta and the check is" -ForegroundColor Cyan
    Write-Host "  mis-firing, re-run with LINEAR_INSTALL_SKIP_NODE_CHECK=1." -ForegroundColor Cyan
    Write-Host ""
}

function Test-NodeSupport {
    if ($Script:SkipNodeCheck) {
        Write-WarningMsg "LINEAR_INSTALL_SKIP_NODE_CHECK=1 set - skipping Node version check"
        return [pscustomobject]@{
            Present          = $true
            MeetsRequirement = $true
            RawVersion       = "<skipped>"
        }
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        return [pscustomobject]@{
            Present          = $false
            MeetsRequirement = $false
            RawVersion       = $null
        }
    }

    try {
        $raw = & node --version
    } catch {
        return [pscustomobject]@{
            Present          = $true
            MeetsRequirement = $false
            RawVersion       = $null
        }
    }

    # node --version emits e.g. "v22.5.1".
    $match = [regex]::Match("$raw", 'v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)')
    if (-not $match.Success) {
        return [pscustomobject]@{
            Present          = $true
            MeetsRequirement = $false
            RawVersion       = "$raw".Trim()
        }
    }

    $major = [int]$match.Groups["major"].Value
    $meets = ($major -ge $Script:RequiredNodeMajor)

    return [pscustomobject]@{
        Present          = $true
        MeetsRequirement = $meets
        RawVersion       = "$raw".Trim()
    }
}

function Test-NpmPresent {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        Write-Err "npm not found on PATH (should ship alongside Node.js)."
        Write-Host ""
        Write-Host "  Reinstall Node.js from https://nodejs.org/ - npm is bundled." -ForegroundColor Cyan
        Write-Host ""
        return $false
    }
    return $true
}

# ---------------------------------------------------------------------------
# Install paths
# ---------------------------------------------------------------------------

function Resolve-NpmBinDir {
    if ($Script:InstallPrefix) {
        return (Join-Path $Script:InstallPrefix "")
    }

    try {
        $prefix = (& npm config get prefix).Trim()
    } catch {
        $prefix = $null
    }

    if (-not $prefix -or $prefix -eq "undefined") {
        # Conservative fallback — matches npm's typical Windows default.
        $prefix = Join-Path $env:APPDATA "npm"
    }

    return $prefix
}

function Get-NpmPrefixArgs {
    if ($Script:InstallPrefix) {
        return @("--prefix=$($Script:InstallPrefix)")
    }
    return @()
}

function Warn-IfBinDirNotOnPath {
    param([string]$BinDir)

    $pathEntries = ([Environment]::GetEnvironmentVariable("PATH", "Process") -split [IO.Path]::PathSeparator) |
        ForEach-Object { $_.Trim() }

    if ($pathEntries -notcontains $BinDir) {
        Write-WarningMsg "$BinDir is not in your PATH."
        Write-Host ""
        Write-Host "  Persist it for new shells (does NOT modify the current session):" -ForegroundColor Cyan
        Write-Host "    setx PATH `"$env:PATH;$BinDir`"" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Then open a new PowerShell window." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Note: we do NOT call setx automatically - users should" -ForegroundColor Cyan
        Write-Host "  vet PATH edits themselves." -ForegroundColor Cyan
        Write-Host ""
    }
}

function Get-LinearPathsInPath {
    $pathEntries = ([Environment]::GetEnvironmentVariable("PATH", "Process") -split [IO.Path]::PathSeparator) |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne "" }

    $found = @()
    foreach ($entry in $pathEntries) {
        foreach ($leaf in @("linear.cmd", "linear.exe", "linear.ps1", "linear")) {
            try {
                $candidate = Join-Path $entry $leaf
            } catch {
                continue
            }
            if (Test-Path $candidate) {
                try {
                    $resolved = (Resolve-Path $candidate -ErrorAction SilentlyContinue).ProviderPath
                } catch {
                    $resolved = $candidate
                }
                if ($found -notcontains $resolved) { $found += $resolved }
            }
        }
    }
    return $found
}

function Warn-IfMultipleLinear {
    $paths = Get-LinearPathsInPath
    if ($paths.Count -le 1) { return }

    Write-WarningMsg "Multiple 'linear' executables found on your PATH. An older copy may shadow the one we just installed."
    Write-Host "Found the following 'linear' executables (entries earlier in PATH take precedence):" -ForegroundColor Yellow
    $i = 0
    foreach ($p in $paths) {
        $i++
        $ver = $null
        try {
            $ver = & "$p" --version 2>$null
            if ($LASTEXITCODE -ne 0) { $ver = $null }
        } catch { $ver = $null }
        if (-not $ver) { $ver = "<unknown version>" }
        Write-Host ("  {0}. {1}  -> {2}" -f $i, $p, $ver)
    }

    if ($Script:LastInstallPath) {
        Write-Host "`nWe installed to: $($Script:LastInstallPath)" -ForegroundColor Cyan
        $first = $paths[0]
        if ($first -ne $Script:LastInstallPath) {
            Write-WarningMsg "The 'linear' executable that appears first in your PATH is different from the one we installed."
            Write-Host "  - Remove the older $first from your PATH, or" -ForegroundColor Yellow
            Write-Host "  - Reorder PATH so that $([System.IO.Path]::GetDirectoryName($Script:LastInstallPath)) appears before $([System.IO.Path]::GetDirectoryName($first))" -ForegroundColor Yellow
            Write-Host "After updating PATH, open a new shell and run 'linear --version' to confirm." -ForegroundColor Yellow
        } else {
            Write-Host "The installed 'linear' is first in your PATH." -ForegroundColor Green
        }
    }
}

# ---------------------------------------------------------------------------
# Channel: npm registry
# ---------------------------------------------------------------------------

function Install-FromRegistry {
    Write-Info "Installing $($Script:NpmPackage) from the npm registry..."

    $spec = "$($Script:NpmPackage)@$($Script:InstallVersion)"
    $npmArgs = @("install", "-g") + (Get-NpmPrefixArgs) + @("--foreground-scripts=false", $spec)

    try {
        & npm @npmArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Err "npm install of $spec exited with code $LASTEXITCODE"
            return $false
        }
    } catch {
        Write-Err "npm install of ${spec} failed: $_"
        return $false
    }

    $binDir = Resolve-NpmBinDir
    $Script:LastInstallPath = Join-Path $binDir "linear.cmd"
    if (-not (Test-Path $Script:LastInstallPath)) {
        # npm on Windows produces both linear and linear.cmd shims; prefer
        # whichever exists when reporting back to the user.
        $alt = Join-Path $binDir "linear.exe"
        if (Test-Path $alt) {
            $Script:LastInstallPath = $alt
        } else {
            $Script:LastInstallPath = Join-Path $binDir "linear"
        }
    }

    Write-Success "$($Script:NpmPackage) installed to $($Script:LastInstallPath)"
    Warn-IfBinDirNotOnPath -BinDir $binDir
    return $true
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

function Verify-Install {
    Write-Info "Verifying installation..."
    try { Warn-IfMultipleLinear } catch { }

    try {
        $versionOutput = & linear --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Err "'linear --version' exited with code $LASTEXITCODE"
            return $false
        }
        Write-Success "linear is installed: $versionOutput"
        return $true
    } catch {
        Write-Err "'linear' is not on PATH in this shell."
        if ($Script:LastInstallPath) {
            Write-Host "  Open a new PowerShell window after applying the setx command above," -ForegroundColor Cyan
            Write-Host "  then run 'linear --version'." -ForegroundColor Cyan
        }
        return $false
    }
}

# ---------------------------------------------------------------------------
# Plugin marketplace pointer
# ---------------------------------------------------------------------------

function Print-PluginMarketplacePointer {
    # If the user ran us from a cloned linear-cli repo, the local-dev
    # marketplace file already exists - skip the remote-add nudge.
    if (Test-Path (Join-Path $PWD ".claude-plugin")) { return }

    Write-Host ""
    Write-Host "Using Claude Code? Register the Linear plugin marketplace:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  /plugin marketplace add $($Script:GitHubRepo)" -ForegroundColor Yellow
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Linear CLI installer" -ForegroundColor Cyan
Write-Host ""

$arch = Get-WindowsArch
if (-not $arch) {
    Write-WarningMsg "Could not detect a supported Windows architecture; continuing with npm-only path."
} else {
    Write-Info "Platform: windows_$arch"
}

$nodeSupport = Test-NodeSupport
if (-not $nodeSupport.Present) {
    Write-Err "Node.js not found on PATH."
    Print-NodeInstallHints
    exit 1
}
if (-not $nodeSupport.MeetsRequirement) {
    Write-Err "Node.js >= $($Script:RequiredNodeMajor) required (found: $($nodeSupport.RawVersion))."
    Print-NodeInstallHints
    exit 1
}
Write-Info "Node detected: $($nodeSupport.RawVersion)"

if (-not (Test-NpmPresent)) {
    exit 1
}

$installed = $false

switch ($Script:InstallSource) {
    "registry" {
        $installed = Install-FromRegistry
    }
    default {
        Write-Err "Unknown LINEAR_INSTALL_SOURCE: '$($Script:InstallSource)' (expected 'registry')"
        exit 1
    }
}

if (-not $installed) {
    Write-Err "Installation failed. See errors above."
    exit 1
}

Verify-Install | Out-Null

Print-PluginMarketplacePointer

Write-Host ""
Write-Success "Installation complete."
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  linear auth login    # one-time interactive auth" -ForegroundColor Yellow
Write-Host "  linear --help        # full command reference" -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: Windows Defender / SmartScreen may flag the unsigned npm" -ForegroundColor Cyan
Write-Host "shim on first run. Linear CLI ships unsigned for v1 - this is" -ForegroundColor Cyan
Write-Host "expected." -ForegroundColor Cyan
Write-Host ""
