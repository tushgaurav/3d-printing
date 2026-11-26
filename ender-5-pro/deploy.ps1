<#
.SYNOPSIS
  Copy Layer1 to the OctoPi and install it (from Windows).

.DESCRIPTION
  Uses the ssh/scp that ship with Windows. You'll be asked for the Pi's password
  unless you've set up an SSH key.

.EXAMPLE
  .\deploy.ps1                          # update the OctoPrint plugin only
.EXAMPLE
  .\deploy.ps1 -Kiosk                   # plugin + kiosk (X11 + Chromium on the Pi's screen)
.EXAMPLE
  .\deploy.ps1 -PiHost 192.168.1.50 -User pi -Kiosk
#>
param(
  [string]$PiHost = "octopi.local",
  [string]$User = "pi",
  [switch]$Kiosk
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = "$User@$PiHost"
$remote = "layer1"

function Invoke-Remote([string]$command, [switch]$Tty) {
  if ($Tty) { ssh -t $target $command } else { ssh $target $command }
  if ($LASTEXITCODE -ne 0) { throw "Remote command failed ($LASTEXITCODE): $command" }
}

Write-Host "==> Copying to ${target}:~/$remote" -ForegroundColor Cyan
Invoke-Remote "rm -rf ~/$remote && mkdir -p ~/$remote"
scp -r -q "$here\touch-ui" "$here\pi-setup" "$here\docs" "${target}:~/$remote/"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
# Windows editors may have saved CRLF line endings; bash needs LF.
Invoke-Remote "find ~/$remote/pi-setup -type f -exec sed -i 's/\r$//' {} +"

Write-Host "==> Installing the OctoPrint plugin" -ForegroundColor Cyan
Invoke-Remote "bash ~/$remote/pi-setup/install-plugin.sh" -Tty

if ($Kiosk) {
  Write-Host "==> Installing the kiosk (asks for your sudo password)" -ForegroundColor Cyan
  Invoke-Remote "sudo bash ~/$remote/pi-setup/install-kiosk.sh" -Tty
}

Write-Host ""
Write-Host "Done. Open http://$PiHost/plugin/layer1/ to see the UI in a browser." -ForegroundColor Green
if (-not $Kiosk) { Write-Host "Run again with -Kiosk to put it on the Pi's own screen." }
