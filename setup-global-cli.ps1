# Setup script to use workspace-bridge-cli globally
# Run this in a NEW PowerShell window after Node.js PATH is set
# Every step is checked; the script exits non-zero at the first failed step.

function Stop-Setup($message, $code) {
    Write-Host "[FAIL] $message" -ForegroundColor Red
    exit $code
}

Write-Host "Checking Node.js availability..." -ForegroundColor Cyan
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Stop-Setup "Node.js not found in PATH. Please restart PowerShell." 1
}
Write-Host "[OK] Node.js found: $nodeVersion" -ForegroundColor Green

Write-Host "`nChecking workspace-bridge-cli availability..." -ForegroundColor Cyan
$null = workspace-bridge-cli --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] workspace-bridge-cli found" -ForegroundColor Green
} else {
    Write-Host "workspace-bridge-cli not found. Linking now..." -ForegroundColor Yellow
    npm link
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "npm link failed (exit code $LASTEXITCODE)." 1
    }
}

Write-Host "`nTesting workspace-bridge-cli..." -ForegroundColor Cyan
$summary = workspace-bridge-cli audit-summary --cwd . --json --quiet
if ($LASTEXITCODE -ne 0) {
    Stop-Setup "workspace-bridge-cli audit-summary failed (exit code $LASTEXITCODE)." 1
}
$summary | Select-Object -First 20

Write-Host "`n[OK] Setup complete! You can now use 'workspace-bridge-cli' in any terminal." -ForegroundColor Green
Write-Host "     Example: workspace-bridge-cli audit-summary --cwd <project> --json --quiet" -ForegroundColor Gray
