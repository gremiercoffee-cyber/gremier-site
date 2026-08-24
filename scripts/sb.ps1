# Run the Supabase CLI against the Gremier project using a personal access token
# instead of the shared `supabase login` session (which other projects overwrite).
#
# Setup (once): create a token at https://supabase.com/dashboard/account/tokens
# while signed in as the Gremier account, then save it to the file below.
# The file lives OUTSIDE the repo so it can never be committed.
#
# Usage:  .\scripts\sb.ps1 functions deploy create-payment
#         .\scripts\sb.ps1 db push

$tokenFile = if ($env:SUPABASE_TOKEN_FILE) { $env:SUPABASE_TOKEN_FILE } else { Join-Path $HOME '.gremier-supabase-token' }

if (-not (Test-Path $tokenFile)) {
  Write-Error "No Supabase token found at: $tokenFile`nCreate one at https://supabase.com/dashboard/account/tokens (as the Gremier account), then save just the token (starts with sbp_) into that file."
  exit 1
}

$token = (Get-Content $tokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Error "Token file $tokenFile is empty."
  exit 1
}

$env:SUPABASE_ACCESS_TOKEN = $token
Set-Location (Split-Path $PSScriptRoot -Parent)
& npx supabase @args
