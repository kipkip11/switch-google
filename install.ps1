# ==============================================================================
# Script Cài Đặt Tự Động Switch Google Cho Windows PowerShell (1-Click Install)
# irm https://raw.githubusercontent.com/kipkip11/switch-google/main/install.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "   🚀 CÀI ĐẶT SWITCH GOOGLE - MULTI-ACCOUNT TOKEN MANAGER (WINDOWS)     " -ForegroundColor Yellow
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kiểm tra Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "✗ Lỗi: Máy tính của bạn chưa cài đặt Node.js!" -ForegroundColor Red
    Write-Host "Vui lòng tải và cài đặt Node.js (bản LTS) tại: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "Sau khi cài xong Node.js, hãy mở lại PowerShell và chạy lại lệnh này." -ForegroundColor Yellow
    exit 1
}

$nodeVer = node -v
Write-Host "ℹ Đã phát hiện Node.js phiên bản: $nodeVer" -ForegroundColor Cyan

# 2. Chuẩn bị thư mục cài đặt
$targetDir = "$env:USERPROFILE\.switch-google\app"
$zipPath = "$env:TEMP\switch-google-main.zip"
$extractTemp = "$env:TEMP\switch-google-extract"

Write-Host "⏳ Đang tải mã nguồn mới nhất từ GitHub..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://codeload.github.com/kipkip11/switch-google/zip/refs/heads/main" -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Host "✗ Lỗi tải file zip từ GitHub: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "⏳ Đang giải nén mã nguồn vào $targetDir..." -ForegroundColor Cyan
if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
Expand-Archive -Path $zipPath -DestinationPath $extractTemp -Force

if (-not (Test-Path "$env:USERPROFILE\.switch-google")) {
    New-Item -ItemType Directory -Path "$env:USERPROFILE\.switch-google" -Force | Out-Null
}
if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
Move-Item -Path "$extractTemp\switch-google-main" -Destination $targetDir -Force
Remove-Item -Force $zipPath
Remove-Item -Recurse -Force $extractTemp

# 3. Cài đặt dependencies
Write-Host "⏳ Đang cài đặt thư viện phụ thuộc (npm install)..." -ForegroundColor Cyan
Push-Location $targetDir
try {
    npm install --omit=dev --no-fund --no-audit
} catch {
    Write-Host "⚠ Cảnh báo: npm install gặp lỗi nhỏ nhưng vẫn tiếp tục." -ForegroundColor Yellow
}
Pop-Location

# 4. Tạo lệnh switch-google toàn cục vào WindowsApps (Luôn có sẵn trong PATH)
$windowsAppsDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
$npmGlobalDir = "$env:APPDATA\npm"

$cmdContent = @"
@echo off
node "%USERPROFILE%\.switch-google\app\dist\cli.js" %*
"@

$ps1Content = @"
node "`$env:USERPROFILE\.switch-google\app\dist\cli.js" `@args
"@

# Đưa vào WindowsApps (PATH mặc định của Windows 10/11)
if (Test-Path $windowsAppsDir) {
    Set-Content -Path "$windowsAppsDir\switch-google.cmd" -Value $cmdContent -Encoding ASCII
    Set-Content -Path "$windowsAppsDir\switch-google.ps1" -Value $ps1Content -Encoding UTF8
    Write-Host "✓ Đã liên kết lệnh 'switch-google' vào WindowsApps (PATH chuẩn)." -ForegroundColor Green
}

# Đưa thêm vào %APPDATA%\npm nếu có
if (-not (Test-Path $npmGlobalDir)) {
    New-Item -ItemType Directory -Path $npmGlobalDir -Force | Out-Null
}
Set-Content -Path "$npmGlobalDir\switch-google.cmd" -Value $cmdContent -Encoding ASCII
Set-Content -Path "$npmGlobalDir\switch-google.ps1" -Value $ps1Content -Encoding UTF8

# 5. Kích hoạt tự khởi động cùng Windows & Bật server ngầm
Write-Host "⏳ Đang kích hoạt tự khởi động cùng Windows và bật server ngầm..." -ForegroundColor Cyan
try {
    node "$targetDir\dist\cli.js" daemon enable
    node "$targetDir\dist\cli.js" daemon start
} catch {
    Write-Host "⚠ Không thể tự bật daemon: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 6. Mở trình duyệt Web Dashboard
Start-Sleep -Seconds 1
Start-Process "http://localhost:1909"

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "🎉 CÀI ĐẶT SWITCH GOOGLE THÀNH CÔNG RỰC RỠ TRÊN WINDOWS!                " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 Trình duyệt Web Dashboard đã được mở tại: http://localhost:1909" -ForegroundColor Cyan
Write-Host "  ⚡ Server đang chạy ngầm và sẽ tự bật lại mỗi khi bạn mở máy tính!" -ForegroundColor Yellow
Write-Host "  ⌨️ Từ nay bạn có thể mở PowerShell ở bất cứ đâu và gõ:" -ForegroundColor White
Write-Host "     • switch-google serve    : Bật Web Server" -ForegroundColor Gray
Write-Host "     • switch-google update   : Cập nhật bản mới" -ForegroundColor Gray
Write-Host "     • switch-google list     : Xem danh sách tài khoản" -ForegroundColor Gray
Write-Host ""
