# Rebuilds the TakeNote APK (signed release) and copies it to TakeNote\TakeNote.apk
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $env:LOCALAPPDATA 'TakeNoteBuild'
$env:JAVA_HOME = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $tools 'sdk'

function Run($what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { Write-Host "ERROR during: $what (exit code $LASTEXITCODE)"; exit $LASTEXITCODE }
}

Push-Location $root
try {
  Run 'build web' { npx vite build }
  Run 'sync Capacitor' { npx cap sync android }
  Push-Location (Join-Path $root 'android')
  try { Run 'build Android' { .\gradlew.bat assembleRelease --no-daemon --console=plain } } finally { Pop-Location }
  $apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
  Copy-Item $apk (Join-Path $root 'TakeNote.apk') -Force
  Write-Host "APK ready: $(Join-Path $root 'TakeNote.apk')"
} finally {
  Pop-Location
}
