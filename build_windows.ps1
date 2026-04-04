# Build Script for Windows

$ProjectRoot = Get-Location
$ApiDir = Join-Path $ProjectRoot "api"
$AppDir = Join-Path $ProjectRoot "app"

Write-Host "--- 1. Cleaning previous builds ---" -ForegroundColor Cyan
if (Test-Path (Join-Path $ApiDir "dist")) { Remove-Item -Recurse -Force (Join-Path $ApiDir "dist") }
if (Test-Path (Join-Path $ApiDir "build")) { Remove-Item -Recurse -Force (Join-Path $ApiDir "build") }
if (Test-Path (Join-Path $AppDir "dist")) { Remove-Item -Recurse -Force (Join-Path $AppDir "dist") }
if (Test-Path (Join-Path $AppDir "dist-built")) { Remove-Item -Recurse -Force (Join-Path $AppDir "dist-built") }

Write-Host "`n--- 2. Packaging Python Backend (api.exe) ---" -ForegroundColor Cyan
Set-Location $ApiDir
# Ensure pyinstaller is installed in the venv
& ".\.venv\Scripts\python.exe" -m pip install pyinstaller
& ".\.venv\Scripts\pyinstaller.exe" api.spec

Write-Host "`n--- 3. Building React Frontend ---" -ForegroundColor Cyan
Set-Location $AppDir
npm run build

Write-Host "`n--- 4. Packaging Electron Application ---" -ForegroundColor Cyan
# Run electron-builder from the app directory
npx electron-builder build --windows

Write-Host "`n--- Build Complete! ---" -ForegroundColor Green
Write-Host "Installer located in: $(Join-Path $AppDir 'dist-built')"
Set-Location $ProjectRoot
