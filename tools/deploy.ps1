<#
.SYNOPSIS
  Copy Layer1 to the OctoPi and install it (from Windows).

.DESCRIPTION
  Uses the ssh/scp that ship with Windows. You'll be asked for the Pi's password
  unless you've set up an SSH key.

.EXAMPLE
  .\tools\deploy.ps1                    # update the OctoPrint plugin only
.EXAMPLE
  .\tools\deploy.ps1 -Kiosk             # plugin + kiosk (X11 + Chromium on the Pi's screen)
.EXAMPLE
  .\tools\deploy.ps1 -PiHost 192.168.1.50 -User pi -Kiosk
#>
param(
  [string]$PiHost = "octopi.local",
  [string]$User = "pi",
  [switch]$Kiosk
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # this script is in tools/
$target = "$User@$PiHost"
$remote = "layer1"

function Invoke-Remote([string]$command, [switch]$Tty) {
  if ($Tty) { ssh -t $target $command } else { ssh $target $command }
  if ($LASTEXITCODE -ne 0) { throw "Remote command failed ($LASTEXITCODE): $command" }
}

Write-Host "==> Copying to ${target}:~/$remote" -ForegroundColor Cyan
Invoke-Remote "rm -rf ~/$remote && mkdir -p ~/$remote"
# The plugin source (pyproject.toml needs README.md and LICENSE to build), the Pi scripts, the docs.
$items = "octoprint_layer1", "pyproject.toml", "README.md", "LICENSE", "pi-setup", "docs" |
  ForEach-Object { Join-Path $root $_ }
scp -r -q @items "${target}:~/$remote/"
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
