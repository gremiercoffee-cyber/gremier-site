# Test your Google Apps Script webhook the same way Supabase calls it.
# Usage: powershell -File scripts\test-google-webhook.ps1 -Url "https://script.google.com/.../exec" -Secret "your-secret"

param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$Secret = ""
)

$Url = $Url.Trim().Trim('"').Trim("'")
$Secret = $Secret.Trim().Trim('"').Trim("'")
$normalizedUrl = $Url -replace '/dev(\?|$)', '/exec$1'

$payload = @{
  secret = $Secret
  paid_at = (Get-Date).ToUniversalTime().ToString("o")
  order_number = 9998
  order_id = "local-test"
  order_label = "LOCAL-TEST"
  customer_name = "Test Customer"
  customer_phone = "050-0000000"
  customer_email = "test@example.com"
  delivery_address = "Test"
  items_summary = "1x Test Coffee - 1 NIS"
  subtotal = 1
  discount = 0
  total = 1
  source = "local-test"
  notes = "test-google-webhook.ps1"
  admin_url = "https://gremier-site.vercel.app/admin.html"
}

$json = $payload | ConvertTo-Json -Compress
Write-Host "POST $normalizedUrl"
Write-Host ""

function Invoke-GoogleWebhookPost {
  param([string]$TargetUrl, [string]$Body)
  try {
    $resp = Invoke-WebRequest -Uri $TargetUrl -Method POST -ContentType "application/json" -Body $Body -MaximumRedirection 0 -ErrorAction Stop
    return @{ Status = [int]$resp.StatusCode; Body = $resp.Content }
  } catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      if ($status -ge 300 -and $status -lt 400) {
        $loc = $_.Exception.Response.Headers["Location"]
        Write-Host "Redirect to: $loc"
        Write-Host "Re-POSTing..."
        $resp2 = Invoke-WebRequest -Uri $loc -Method POST -ContentType "application/json" -Body $Body -UseBasicParsing
        return @{ Status = [int]$resp2.StatusCode; Body = $resp2.Content }
      }
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      return @{ Status = $status; Body = $reader.ReadToEnd() }
    }
    throw
  }
}

try {
  $result = Invoke-GoogleWebhookPost -TargetUrl $normalizedUrl -Body $json
  Write-Host "Status:" $result.Status
  Write-Host "Body:" $result.Body
} catch {
  Write-Host "Error:" $_.Exception.Message
}

Write-Host ""
Write-Host 'If you see {"ok":true} and a row on Web Orders, use this exact URL + secret in set-google-webhook-secrets.bat'
