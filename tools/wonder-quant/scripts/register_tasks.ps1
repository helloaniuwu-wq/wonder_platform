<#
.SYNOPSIS
  Register Wonder Quant Windows Scheduled Tasks (run only after user sign-off).
  - WQ_Daily_Data      : Mon-Sat 20:00 UTC+8
  - WQ_Vault_Writeback : Daily   21:00 UTC+8 (outside R2 blackout 23:00-00:00 / 02:00-03:00)
  - WQ_Heartbeat       : Hourly
#>
param(
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

$commonSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

$tasks = @(
  @{
    Name = "WQ_Daily_Data"
    Script = Join-Path $scriptDir "run_daily_data.ps1"
    Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At 20:00
    Desc = "Wonder Quant daily fetch -> compute -> push-d1 (Mon-Sat 20:00 UTC+8)"
  },
  @{
    Name = "WQ_Vault_Writeback"
    Script = Join-Path $scriptDir "run_vault_writeback.ps1"
    Trigger = New-ScheduledTaskTrigger -Daily -At 21:00
    Desc = "Wonder Quant atomic _quant writeback + iCloud mirror (Daily 21:00 UTC+8)"
  },
  @{
    Name = "WQ_Heartbeat"
    Script = Join-Path $scriptDir "run_heartbeat.ps1"
    Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
    Desc = "Wonder Quant hourly liveness heartbeat to Cloudflare D1"
  },
  @{
    Name = "WQ_Monthly_Factsheets"
    Script = Join-Path $scriptDir "run_monthly_factsheets.ps1"
    Trigger = New-ScheduledTaskTrigger -Daily -At 20:30
    Desc = "Wonder Quant monthly factsheet parse & enrich (Monthly on 5th 20:30 UTC+8)"
  }
)

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$($t.Script)`""
  if ($WhatIf) {
    Write-Output "[WhatIf] Would register task: $($t.Name) -> $($t.Script)"
  } else {
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Settings $commonSettings -Description $t.Desc -Force | Out-Null
    Write-Output "Registered scheduled task: $($t.Name)"
  }
}
