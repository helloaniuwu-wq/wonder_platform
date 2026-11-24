$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:TEMP = "D:\WonderQuant\tmp"
$env:TMP = "D:\WonderQuant\tmp"

$logDir = "D:\WonderQuant\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("writeback_" + (Get-Date -Format "yyyyMMdd") + ".log")

$wq = "D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\wq.exe"
"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Vault_Writeback START ===" | Out-File -FilePath $logFile -Append -Encoding utf8
& $wq writeback *>> $logFile
$code = $LASTEXITCODE

if ($code -eq 0) {
  # Mirror newly written _quant files to iCloud read-only Obsidian (NO git operations, strictly R1/R7)
  & "C:\Python314\python.exe" "D:\Claude_Agent_Workspace\derek-obsidian-sync\scripts\sync_to_icloud.py" *>> $logFile
  $syncCode = $LASTEXITCODE
  "=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] sync_to_icloud EXIT=$syncCode ===" | Out-File -FilePath $logFile -Append -Encoding utf8
}

"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Vault_Writeback EXIT=$code ===" | Out-File -FilePath $logFile -Append -Encoding utf8
exit $code
