$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:SYSEVAL_PORT = '8010'
$env:SYSEVAL_DATABASE_URL = 'sqlite:///' + (Join-Path $PSScriptRoot '.syseval/assessment.db').Replace('\', '/')
& (Join-Path $PSScriptRoot 'backend/.venv/Scripts/python.exe') (Join-Path $PSScriptRoot 'run.py')
exit $LASTEXITCODE
