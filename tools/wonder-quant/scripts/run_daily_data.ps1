$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:UV_CACHE_DIR = "D:\WonderQuant\uv-cache"
$env:PIP_CACHE_DIR = "D:\WonderQuant\pip-cache"
$env:TEMP = "D:\WonderQuant\tmp"
$env:TMP = "D:\WonderQuant\tmp"

$logDir = "D:\WonderQuant\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("daily_" + (Get-Date -Format "yyyyMMdd") + ".log")

$wq = "D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\wq.exe"
"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Daily_Data START ===" | Out-File -FilePath $logFile -Append -Encoding utf8
& $wq run-daily *>> $logFile
$code = $LASTEXITCODE
"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Daily_Data EXIT=$code ===" | Out-File -FilePath $logFile -Append -Encoding utf8

# Prune logs older than 60 days
Get-ChildItem -Path $logDir -Filter "*.log" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
