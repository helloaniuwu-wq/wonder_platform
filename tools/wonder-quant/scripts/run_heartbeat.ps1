$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:TEMP = "D:\WonderQuant\tmp"
$env:TMP = "D:\WonderQuant\tmp"

$wq = "D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\wq.exe"
$py = "D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\python.exe"
$enrich = "D:\Projects\Wonder Platform\tools\wonder-quant\scripts\enrich_holdings.py"

& $wq heartbeat
$code = $LASTEXITCODE
& $py $enrich --consume-queue
exit $code
