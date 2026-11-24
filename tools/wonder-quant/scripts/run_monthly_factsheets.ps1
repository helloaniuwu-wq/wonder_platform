param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# 默认每月 5 号自动运行（各大发行人通常在次月 3-5 号前公布上月月报）；若带 -Force 则随时运行
if (-not $Force -and (Get-Date).Day -ne 5) {
  exit 0
}

$logDir = "D:\WonderQuant\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("monthly_factsheets_" + (Get-Date -Format "yyyyMM") + ".log")

$py = "D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\python.exe"
$script = "D:\Projects\Wonder Platform\tools\wonder-quant\scripts\enrich_holdings.py"

"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Monthly_Factsheets START ===" | Out-File -FilePath $logFile -Append -Encoding utf8
& $py $script *>> $logFile
$code = $LASTEXITCODE
"=== [$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WQ_Monthly_Factsheets EXIT=$code ===" | Out-File -FilePath $logFile -Append -Encoding utf8

exit $code
