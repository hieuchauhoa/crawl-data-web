$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== Crawl Data Web Phase 0 - Environment Check ===" -ForegroundColor Cyan

function Check-Command($Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    Write-Host "[OK] $Name -> $($cmd.Source)" -ForegroundColor Green
    & $Name --version
    return $true
  }
  Write-Host "[MISS] $Name" -ForegroundColor Yellow
  return $false
}

$nodeOk = Check-Command "node"
$npmOk = Check-Command "npm"
$mariaOk = Check-Command "mariadb"
if (-not $mariaOk) { $mariaOk = Check-Command "mysql" }

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Write-Host "[OK] Chrome -> $chrome" -ForegroundColor Green }
else { Write-Host "[MISS] Chrome executable not found in common paths" -ForegroundColor Yellow }

$envFile = Join-Path $PSScriptRoot "..\apps\server\.env"
if (Test-Path $envFile) { Write-Host "[OK] apps/server/.env exists" -ForegroundColor Green }
else { Write-Host "[MISS] apps/server/.env - copy .env.example and set MariaDB password" -ForegroundColor Yellow }

Write-Host ""
if ($nodeOk -and $npmOk -and $mariaOk -and $chrome) {
  Write-Host "Core environment looks ready." -ForegroundColor Green
} else {
  Write-Host "Install/fix the missing items above before Phase 0 acceptance testing." -ForegroundColor Yellow
}
