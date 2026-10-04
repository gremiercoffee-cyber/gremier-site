# Chief of Staff - one-shot setup and deploy to Cloudflare.
# Run from PowerShell:   cd <repo>\chief-of-staff ; powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# Safe to re-run: it skips steps that are already done.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed. Install the LTS version from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}
node --version

Step "Installing dependencies"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Step "Logging in to Cloudflare (a browser window may open)"
npx wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) { npx wrangler login; if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed" } }

Step "Setting up the D1 database"
$toml = Get-Content wrangler.toml -Raw
if ($toml -match "REPLACE_WITH_YOUR_D1_DATABASE_ID") {
    $existing = (npx wrangler d1 list --json | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq "chief-of-staff" }
    if (-not $existing) {
        npx wrangler d1 create chief-of-staff
        if ($LASTEXITCODE -ne 0) { throw "Could not create the D1 database" }
        $existing = (npx wrangler d1 list --json | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq "chief-of-staff" }
    }
    $dbId = $existing.uuid
    if (-not $dbId) { throw "Could not find the chief-of-staff database id" }
    $toml = $toml -replace "REPLACE_WITH_YOUR_D1_DATABASE_ID", $dbId
    Set-Content -Path wrangler.toml -Value $toml -NoNewline
    Write-Host "Database id $dbId written to wrangler.toml"
} else {
    Write-Host "Database already configured."
}

Step "Secrets"
$secretList = npx wrangler secret list 2>$null | Out-String
function Put-Secret($name, $prompt) {
    if ($secretList -match "`"$name`"") {
        $answer = Read-Host "$name is already set. Replace it? (y/N)"
        if ($answer -ne "y") { return }
    }
    $secure = Read-Host $prompt -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $plain) { throw "$name cannot be empty" }
    $plain | npx wrangler secret put $name
    if ($LASTEXITCODE -ne 0) { throw "Could not set $name" }
}
# The Worker must exist before secrets can be attached to it.
if (-not ($secretList -match "COS_ACCESS_TOKEN")) {
    Step "First deploy (creates the Worker)"
    npm run deploy
    if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }
    $secretList = npx wrangler secret list 2>$null | Out-String
}
Put-Secret "COS_ACCESS_TOKEN" "Choose a passcode for the app (long, you'll type it once per device)"
Put-Secret "OPENAI_API_KEY" "Paste your OpenAI API key"

Step "Building, migrating the database and deploying"
npm run deploy
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

Write-Host "`nDone! Open the https://chief-of-staff.<your-subdomain>.workers.dev URL shown above," -ForegroundColor Green
Write-Host "unlock it with your passcode, then set your name and time zone in Settings." -ForegroundColor Green
