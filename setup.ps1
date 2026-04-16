# Hey Tailor - automated Windows setup
#
# Invoked by setup.bat. Does everything that can be automated:
#   1. Checks Node.js (installs v22 LTS via winget if missing/outdated)
#   2. Installs Shopify CLI globally (if missing)
#   3. Installs project dependencies (web + widget)
#   4. Creates web\.env from .env.example
#   5. Runs database migrations + seeds + widget build
#
# After this runs, double-click start.bat to launch the backend and Shopify CLI.

$ErrorActionPreference = 'Stop'

function Write-Step($text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}

function Write-OK($text) {
  Write-Host "    $text" -ForegroundColor Green
}

function Write-Warn($text) {
  Write-Host "    $text" -ForegroundColor Yellow
}

function Write-Err($text) {
  Write-Host "    $text" -ForegroundColor Red
}

# Reload PATH from registry so newly installed tools are visible in this shell.
function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host " Hey Tailor - Windows setup"               -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot
Write-OK "Working in: $projectRoot"

# Wipe any pre-existing node_modules folders. The project scaffold was built on
# Linux and shipped with Linux-binary native modules; we need Windows binaries.
Write-Step "Cleaning pre-built dependencies"
$toNuke = @("node_modules", "web\node_modules", "widget\node_modules")
foreach ($dir in $toNuke) {
  $full = Join-Path $projectRoot $dir
  if (Test-Path $full) {
    try {
      Remove-Item -Recurse -Force -LiteralPath $full -ErrorAction Stop
      Write-OK "Removed $dir"
    } catch {
      $msg = $_.Exception.Message
      Write-Warn ("Could not remove " + $dir + ": " + $msg)
      Write-Warn "Continuing anyway - npm will overwrite what it can."
    }
  }
}

# --- Step 1: Node.js ---
Write-Step "Checking Node.js"

$nodeOK = $false
try {
  $v = & node --version 2>$null
  if ($LASTEXITCODE -eq 0 -and $v -match 'v(\d+)\.(\d+)') {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 5)) {
      Write-OK "Node $v is installed and new enough."
      $nodeOK = $true
    } else {
      Write-Warn "Found Node $v, but we need v22.5 or newer."
    }
  }
} catch {
  Write-Warn "Node is not installed."
}

if (-not $nodeOK) {
  Write-Step "Installing Node.js 22 LTS via winget"
  $wingetAvailable = $false
  try {
    & winget --version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $wingetAvailable = $true }
  } catch {}

  if (-not $wingetAvailable) {
    Write-Err "winget is not available on this machine."
    Write-Err "Install Node 22 LTS manually from https://nodejs.org/en/download"
    Write-Err "(pick the Windows Installer .msi, accept defaults), then re-run setup.bat."
    exit 1
  }

  & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Err "winget install failed. Try installing Node manually from https://nodejs.org"
    exit 1
  }

  Refresh-Path

  try {
    $v = & node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-OK "Installed Node $v"
    } else {
      Write-Warn "Node installed but this shell cannot see it yet."
      Write-Warn "Close this window, open a new one, and double-click setup.bat again."
      exit 0
    }
  } catch {
    Write-Warn "Node installed but this shell cannot see it yet."
    Write-Warn "Close this window, open a new one, and double-click setup.bat again."
    exit 0
  }
}

# --- Step 2: Shopify CLI ---
Write-Step "Checking Shopify CLI"

$shopifyOK = $false
try {
  & shopify version 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $shopifyOK = $true
    Write-OK "Shopify CLI is installed."
  }
} catch {}

if (-not $shopifyOK) {
  Write-Step "Installing Shopify CLI globally (this takes about 60 seconds)"
  & npm install -g "@shopify/cli@latest"
  if ($LASTEXITCODE -ne 0) {
    Write-Err "npm install -g @shopify/cli failed."
    Write-Err "If you see an EACCES / permission error, close this window, right-click"
    Write-Err "setup.bat, and pick 'Run as administrator'."
    exit 1
  }
  Refresh-Path
  Write-OK "Shopify CLI installed."
}

# --- Step 3: Project dependencies ---
Write-Step "Installing project dependencies (web + widget)"
& npm run setup
if ($LASTEXITCODE -ne 0) { Write-Err "npm run setup failed."; exit 1 }
Write-OK "Dependencies installed."

# --- Step 4: .env ---
Write-Step "Creating web\.env"
$envPath = Join-Path $projectRoot "web\.env"
if (-not (Test-Path $envPath)) {
  Copy-Item "web\.env.example" $envPath
  Write-OK "Created web\.env (copied from .env.example)."
} else {
  Write-OK "web\.env already exists - leaving it alone."
}

# --- Step 5: Database migrations + seed ---
Write-Step "Running database migrations"
& npm run db:migrate
if ($LASTEXITCODE -ne 0) { Write-Err "Migration failed."; exit 1 }

Write-Step "Seeding the database"
& npm run db:seed
if ($LASTEXITCODE -ne 0) { Write-Err "Seed failed."; exit 1 }

# --- Step 6: Widget build ---
Write-Step "Building the sizing widget bundle"
& npm run widget:build
if ($LASTEXITCODE -ne 0) { Write-Err "Widget build failed."; exit 1 }

Write-Host ""
Write-Host "========================================"  -ForegroundColor Green
Write-Host " SETUP COMPLETE"                           -ForegroundColor Green
Write-Host "========================================"  -ForegroundColor Green
Write-Host ""
Write-Host "Next step: double-click start.bat in this folder."
Write-Host "That will open two windows - one for the backend, one for Shopify CLI."
Write-Host ""
