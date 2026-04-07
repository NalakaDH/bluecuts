param(
  [ValidateSet('Register', 'Unregister', 'List')]
  [string]$Action = 'Register',
  [ValidateSet('Hourly', 'Daily', 'Both')]
  [string]$Schedule = 'Both',
  [string]$DailyAt = '2:00 AM',
  [string]$BaseUrl = 'http://127.0.0.1:4000'
)

$ErrorActionPreference = 'Stop'

$TaskHourly = 'BlueCuts Cloud Sync (hourly)'
$TaskDaily = 'BlueCuts Cloud Sync (daily)'
$ScriptPath = Join-Path $PSScriptRoot 'cloud-sync.ps1'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "cloud-sync.ps1 not found at: $ScriptPath"
}

$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -BaseUrl `"$BaseUrl`""
$TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Argument
$TaskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

if ($Action -eq 'List') {
  foreach ($tn in @($TaskHourly, $TaskDaily)) {
    $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
    if ($t) {
      $t | Format-List TaskName, State, TaskPath
      Get-ScheduledTaskInfo -InputObject $t | Format-List NextRunTime, LastRunTime, LastTaskResult
    }
    else {
      Write-Host "(not registered) $tn"
    }
  }
  exit 0
}

if ($Action -eq 'Unregister') {
  foreach ($tn in @($TaskHourly, $TaskDaily)) {
    if (Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $tn -Confirm:$false
      Write-Host "Removed: $tn"
    }
    else {
      Write-Host "(not present) $tn"
    }
  }
  exit 0
}

# Register
Write-Host "Task action:"
Write-Host "  powershell.exe $Argument"

if ($Schedule -eq 'Hourly' -or $Schedule -eq 'Both') {
  if (Get-ScheduledTask -TaskName $TaskHourly -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskHourly -Confirm:$false
  }
  $start = (Get-Date).AddMinutes(3)
  $trigger = New-ScheduledTaskTrigger -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName $TaskHourly -Action $TaskAction -Trigger $trigger `
    -User $env:UserName -Settings $TaskSettings | Out-Null
  Write-Host "Registered: $TaskHourly (every hour; first run about $($start.ToString('t')))"
}

if ($Schedule -eq 'Daily' -or $Schedule -eq 'Both') {
  if (Get-ScheduledTask -TaskName $TaskDaily -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskDaily -Confirm:$false
  }
  $at = [datetime]::Parse($DailyAt, [System.Globalization.CultureInfo]::CurrentCulture)
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  Register-ScheduledTask -TaskName $TaskDaily -Action $TaskAction -Trigger $trigger `
    -User $env:UserName -Settings $TaskSettings | Out-Null
  Write-Host "Registered: $TaskDaily (daily at $($at.ToString('HH:mm')))"
}

Write-Host ""
Write-Host "Note: Sync calls $BaseUrl. The Blue Cuts app (or npm start in backend) must be running, or the task will fail until the API is up."
