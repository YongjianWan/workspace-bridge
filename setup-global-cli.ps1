# Setup script to use workspace-bridge-cli globally
# Run this in a NEW PowerShell window after Node.js PATH is set

Write-Host "Checking Node.js availability..." -ForegroundColor Cyan
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js not found in PATH. Please restart PowerShell." -ForegroundColor Red
    exit 1
}

Write-Host "`nChecking workspace-bridge-cli availability..." -ForegroundColor Cyan
$wbVersion = workspace-bridge-cli --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ workspace-bridge-cli found" -ForegroundColor Green
} else {
    Write-Host "✗ workspace-bridge-cli not found. Linking now..." -ForegroundColor Yellow
    npm link
}

Write-Host "`nTesting workspace-bridge-cli..." -ForegroundColor Cyan
workspace-bridge-cli audit-summary --cwd . --json --quiet | Select-Object -First 20

Write-Host "`n✅ Setup complete! You can now use 'workspace-bridge-cli' in any terminal." -ForegroundColor Green
Write-Host "   Example: workspace-bridge-cli audit-summary --cwd <project> --json --quiet" -ForegroundColor Gray
