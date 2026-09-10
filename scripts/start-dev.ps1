$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
  npm install
}

if (-not (Test-Path "apps/server/.env")) {
  Copy-Item "apps/server/.env.example" "apps/server/.env"
  Write-Host "Created apps/server/.env. Edit MARIADB_PASSWORD, then run this script again." -ForegroundColor Yellow
  exit 1
}

npm run dev
