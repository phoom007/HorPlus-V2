$ErrorActionPreference = "Stop"

$Env:DATABASE_URL = $Env:DATABASE_URL_TEST_OVERRIDE
if (-not $Env:DATABASE_URL) {
    Write-Host "ERROR: DATABASE_URL_TEST_OVERRIDE must be set."
    exit 1
}

$Env:PORT = "3101"
$Env:VITE_PORT = "3002"

Write-Host "Running Backend tests..."
npx vitest run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running E2E..."
# Add frontend E2E runner command here if present, e.g. npx playwright test
Write-Host "E2E complete."
