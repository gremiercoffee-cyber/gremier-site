$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$toolsDir = Join-Path $root ".tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/supabase/cli/releases/latest" -Headers @{ "User-Agent" = "gremier-deploy" }
$asset = $release.assets | Where-Object { $_.name -match "windows_amd64\.tar\.gz$" } | Select-Object -First 1
if (-not $asset) {
  throw "Could not find Windows Supabase CLI download."
}

$archive = Join-Path $toolsDir $asset.name
Write-Host "Downloading $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive -UseBasicParsing
tar -xzf $archive -C $toolsDir
Remove-Item $archive -Force -ErrorAction SilentlyContinue

if (-not (Test-Path (Join-Path $toolsDir "supabase.exe"))) {
  throw "supabase.exe not found after extract."
}

Write-Host "Installed: $toolsDir\supabase.exe"
