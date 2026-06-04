# install.ps1 - Fully automatic setup. No user input needed.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

$hostName = "com.zoho.comment_writer"
$extensionName = "Zoho Desk Comment Tracker"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$manifestPath = Join-Path $scriptDir "$hostName.json"
$batPath = Join-Path $scriptDir "host.bat"
$defaultSavePath = Join-Path $env:USERPROFILE "Documents\ZohoComments"

Write-Host ""
Write-Host "=== Zoho Comment Tracker - Auto Setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "(ERROR) Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "(OK) Node.js: $nodeVersion" -ForegroundColor Green

# 2. Find extension ID from Chrome Preferences
$chromeUserData = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$extensionId = $null

# Scan all profile folders that contain a Secure Preferences file
if (Test-Path $chromeUserData) {
    $profileDirs = Get-ChildItem -Path $chromeUserData -Directory | Where-Object {
        Test-Path (Join-Path $_.FullName "Secure Preferences")
    }

    foreach ($profileDir in $profileDirs) {
        $secPrefsFile = Join-Path $profileDir.FullName "Secure Preferences"

        try {
            $secContent = Get-Content $secPrefsFile -Raw -Encoding UTF8
            $secPrefs = $secContent | ConvertFrom-Json
            $extensions = $secPrefs.extensions.settings

            foreach ($prop in $extensions.PSObject.Properties) {
                $ext = $prop.Value
                # Match by name
                if ($ext.manifest -and $ext.manifest.name -eq $extensionName) {
                    $extensionId = $prop.Name
                    break
                }
                # Match by path (for unpacked extensions loaded from our dist folder)
                if ($ext.path -and $ext.path -like "*Ticket tracker*") {
                    $extensionId = $prop.Name
                    break
                }
            }
        } catch {
            # Skip profiles we cannot read
        }

        if ($extensionId) {
            Write-Host "(OK) Found extension ID: $extensionId (profile: $($profileDir.Name))" -ForegroundColor Green
            break
        }
    }
}

if (-not $extensionId) {
    Write-Host "(!) Could not auto-detect extension ID." -ForegroundColor Yellow
    Write-Host "  Open chrome://extensions, enable Developer mode, and copy the ID." -ForegroundColor Yellow
    Write-Host ""
    $extensionId = Read-Host "  Paste extension ID here"
    $extensionId = $extensionId.Trim()
    if (-not $extensionId -or $extensionId.Length -ne 32) {
        Write-Host "(ERROR) Invalid extension ID. It should be 32 lowercase letters." -ForegroundColor Red
        exit 1
    }
    Write-Host "(OK) Using extension ID: $extensionId" -ForegroundColor Green
}

# 3. Write native messaging manifest
$manifestObj = @{
    name = $hostName
    description = "Writes captured Zoho Desk comments to local txt files"
    path = $batPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
}
$manifestObj | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
Write-Host "(OK) Native manifest configured" -ForegroundColor Green

# 4. Create registry key
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
if (Test-Path $regPath) {
    Remove-Item $regPath -Force
}
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath
Write-Host "(OK) Registry key set" -ForegroundColor Green

# 5. Create default save folder
if (-not (Test-Path $defaultSavePath)) {
    New-Item -ItemType Directory -Path $defaultSavePath -Force | Out-Null
}
Write-Host "(OK) Save folder: $defaultSavePath" -ForegroundColor Green

# 6. Save config
$configPath = Join-Path $scriptDir "config.json"
@{ savePath = $defaultSavePath } | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

$todayFile = Get-Date -Format "yyyy-MM-dd"
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "  -> Reload the extension at chrome://extensions/" -ForegroundColor White
Write-Host "  -> Open any Zoho Desk ticket" -ForegroundColor White
Write-Host "  -> Comments will be saved to: $defaultSavePath\$todayFile.txt" -ForegroundColor White
Write-Host ""
