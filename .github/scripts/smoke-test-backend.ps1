<#
Smoke-tests the frozen backend before it is packaged: starts api.exe the way the app does, waits
for an authorized GET /models to return 200, then checks that a request without the token gets
401. On failure it prints the backend's output and exits 1. Runs in Windows PowerShell 5.1 and 7,
so it can be run locally against a PyInstaller build too:
  powershell -NoProfile -ExecutionPolicy Bypass -File .github\scripts\smoke-test-backend.ps1 -ExePath api\dist\api\api.exe
#>
param(
    [string]$ExePath = "api/dist/api/api.exe",
    # The cold start imports torch and transformers
    [int]$TimeoutSec = 240
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Invoke-WebRequest's progress bar is very slow in 5.1

$exe = (Resolve-Path $ExePath).Path
$distDir = Split-Path $exe
$url = "http://127.0.0.1:8000/models"
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$work = Join-Path $tempRoot ("vblis-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$outLog = Join-Path $work "stdout.log"
$errLog = Join-Path $work "stderr.log"
New-Item -ItemType Directory -Path $work | Out-Null

if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "::error::Port 8000 is already in use; close VBLIS or the dev backend first"
    exit 1
}

$token = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
if ($env:GITHUB_ACTIONS) { Write-Output "::add-mask::$token" }

# Inherited by api.exe. VBLIS_DATA_DIR is essential: unset, the frozen backend keeps its data in
# the dist folder itself, which electron-builder packages next.
$env:VBLIS_DATA_DIR = Join-Path $work "data"
$env:VBLIS_API_TOKEN = $token
$env:HF_HUB_OFFLINE = "1"
# When set, parent_watch.py exits the backend as soon as its stdin is at EOF
Remove-Item Env:VBLIS_EXIT_WITH_PARENT -ErrorAction SilentlyContinue

function Invoke-Models([hashtable]$Headers) {
    try {
        $r = Invoke-WebRequest -Uri $url -Headers $Headers -UseBasicParsing -TimeoutSec 10
        return @{ Status = [int]$r.StatusCode; Body = [string]$r.Content }
    } catch {
        # An HTTP error carries a response; "not listening yet" doesn't (status 0)
        $response = $_.Exception.Response
        $status = if ($response) { [int]$response.StatusCode } else { 0 }
        return @{ Status = $status; Body = $_.Exception.Message }
    }
}

$filesBefore = @(Get-ChildItem $distDir -Recurse -File | ForEach-Object FullName)
$startArgs = @{
    FilePath = $exe; WorkingDirectory = $distDir; NoNewWindow = $true; PassThru = $true
    RedirectStandardOutput = $outLog; RedirectStandardError = $errLog
}
$proc = Start-Process @startArgs
$null = $proc.Handle  # without it, ExitCode reads empty once the process has exited
$clock = [Diagnostics.Stopwatch]::StartNew()
$failure = $null
Write-Output "Started api.exe (PID $($proc.Id)); waiting up to $TimeoutSec s for $url"

try {
    while ($true) {
        if ($proc.HasExited) { $failure = "api.exe exited with code $($proc.ExitCode) before it answered"; break }
        $authorized = Invoke-Models @{ "X-VBLIS-Token" = $token }
        if ($authorized.Status -eq 200) { break }
        if ($authorized.Status -ne 0) { $failure = "GET /models with the token returned $($authorized.Status)"; break }
        if ($clock.Elapsed.TotalSeconds -ge $TimeoutSec) { $failure = "no answer within $TimeoutSec s"; break }
        Start-Sleep -Seconds 2
    }
    if (-not $failure) {
        Write-Output ("GET /models with the token: 200 after {0:N0} s" -f $clock.Elapsed.TotalSeconds)
        if (-not ($authorized.Body | ConvertFrom-Json).models) { $failure = "GET /models listed no models" }
    }
    if (-not $failure) {
        $anonymous = Invoke-Models @{}
        if ($anonymous.Status -eq 401) { Write-Output "GET /models without the token: 401" }
        else { $failure = "GET /models without the token returned $($anonymous.Status), expected 401" }
    }
} finally {
    # Always: a backend that outlives the step keeps the step from finishing (inherited handles)
    if (-not $proc.HasExited) {
        taskkill.exe /PID $proc.Id /T /F | Out-Null
        $null = $proc.WaitForExit(30000)
    }
}

# The run must not change what gets packaged
$filesAfter = @(Get-ChildItem $distDir -Recurse -File | ForEach-Object FullName)
$changed = @(Compare-Object $filesBefore $filesAfter)
if (-not $failure -and $changed) {
    $failure = "the run added or removed files under $distDir"
    $changed | ForEach-Object { Write-Output "$($_.SideIndicator) $($_.InputObject)" }
}

Write-Output $(if ($failure) { "Backend output:" } else { "::group::Backend output" })
foreach ($log in $outLog, $errLog) {
    Write-Output "----- $(Split-Path $log -Leaf) -----"
    if (Test-Path $log) { Get-Content $log -Encoding UTF8 }
}
if (-not $failure) { Write-Output "::endgroup::" }

if ($failure) {
    Write-Output "::error::Backend smoke test failed: $failure"
    exit 1
}
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "Backend smoke test passed"
exit 0
