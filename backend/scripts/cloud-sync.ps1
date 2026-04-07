param(
  [string]$BaseUrl = "http://localhost:4000",
  [int]$Year = (Get-Date).Year,
  [int]$Month = (Get-Date).Month
)

$ErrorActionPreference = "Stop"

$dotenvPath = Join-Path $PSScriptRoot "..\.env"
if ((-not $env:BLUECUTS_CLOUD_SYNC_SECRET) -and (Test-Path $dotenvPath)) {
  # Minimal .env loader for this script (KEY=VALUE, ignores comments/blank lines).
  Get-Content $dotenvPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith("#")) { return }
    $m = [regex]::Match($line, "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")
    if (-not $m.Success) { return }
    $k = $m.Groups[1].Value
    $v = $m.Groups[2].Value
    if ($v.Length -ge 2) {
      $q = $v.Substring(0,1)
      if (($q -eq '"' -or $q -eq "'") -and $v.EndsWith($q)) {
        $v = $v.Substring(1, $v.Length - 2)
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($k) -and $null -eq (Get-Item -Path "Env:$k" -ErrorAction SilentlyContinue)) {
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

$secret = $env:BLUECUTS_CLOUD_SYNC_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
  throw "Missing env var BLUECUTS_CLOUD_SYNC_SECRET"
}

$headers = @{ "x-bluecuts-sync-secret" = $secret }
$body = @{ year = $Year; month = $Month } | ConvertTo-Json

Write-Host "Syncing snapshots to Firestore..."
Write-Host "POST $BaseUrl/api/cloud/sync (year=$Year month=$Month)"

$res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/cloud/sync" -Headers $headers -ContentType "application/json" -Body $body
$res | ConvertTo-Json -Depth 6

