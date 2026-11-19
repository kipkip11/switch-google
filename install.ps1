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

# 2. Chuẩn bị thư mục cài đặt và giải phóng tiến trình cũ
$targetDir = "$env:USERPROFILE\.switch-google\app"
$zipPath = "$env:TEMP\switch-google-main.zip"
$extractTemp = "$env:TEMP\switch-google-extract"

Write-Host "⏳ Đang kiểm tra và giải phóng các tiến trình cũ (nếu đang chạy)..." -ForegroundColor Cyan
# Thử tắt daemon nếu đã có phiên bản cũ
if (Test-Path "$targetDir\dist\cli.js") {
    try {
        & node "$targetDir\dist\cli.js" daemon stop *>$null
    } catch {}
}

# Tắt triệt để bất kỳ tiến trình node nào đang chạy switch-google để tránh khóa file (file lock) trên Windows
try {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*switch-google*" -or $_.CommandLine -like "*1909*" -or $_.CommandLine -like "*dist\cli.js*"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
    try {
        Get-WmiObject Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*switch-google*" -or $_.CommandLine -like "*1909*" -or $_.CommandLine -like "*dist\cli.js*"
        } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
Start-Sleep -Milliseconds 800

Write-Host "⏳ Đang tải mã nguồn mới nhất từ GitHub..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://codeload.github.com/kipkip11/switch-google/zip/refs/heads/main" -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Host "✗ Lỗi tải file zip từ GitHub: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "⏳ Đang giải nén mã nguồn vào $targetDir..." -ForegroundColor Cyan
if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp -ErrorAction SilentlyContinue }
Expand-Archive -Path $zipPath -DestinationPath $extractTemp -Force

if (-not (Test-Path "$env:USERPROFILE\.switch-google")) {
    New-Item -ItemType Directory -Path "$env:USERPROFILE\.switch-google" -Force | Out-Null
}

# Tự động sao lưu dữ liệu an toàn trước khi cập nhật
$backupDir = "$env:USERPROFILE\.switch-google\backups\pre_update_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}
@("switch_google.sqlite", "profiles.enc.json", "master.key", "usage_logs.json") | ForEach-Object {
    $filePath = "$env:USERPROFILE\.switch-google\$_"
    if (Test-Path $filePath) {
        Copy-Item -Path $filePath -Destination "$backupDir\$_" -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "🛡️  Đã tự động sao lưu dữ liệu hiện tại vào: $backupDir" -ForegroundColor DarkGray

if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

# Sao chép đè file với cơ chế retry thông minh
$sourcePath = "$extractTemp\switch-google-main\*"
$maxRetries = 3
$copied = $false

for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    try {
        Copy-Item -Path $sourcePath -Destination $targetDir -Recurse -Force -ErrorAction Stop
        $copied = $true
        break
    } catch {
        if ($attempt -lt $maxRetries) {
            Write-Host "⚠ File đang được giải phóng, thử lại lần $attempt..." -ForegroundColor Yellow
            Start-Sleep -Seconds 1
        } else {
            Write-Host "✗ Không thể sao chép file vào: $($targetDir) - $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }
}

Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $extractTemp -ErrorAction SilentlyContinue

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

# 5. Cấu hình Windows Firewall cho cổng 1909 (để máy khác trong LAN kết nối mượt mà)
Write-Host "⏳ Đang kiểm tra và cấu hình Windows Defender Firewall (Port 1909)..." -ForegroundColor Cyan
try {
    $existingRule = Get-NetFirewallRule -DisplayName "Switch Google Port 1909" -ErrorAction SilentlyContinue
    if (-not $existingRule) {
        New-NetFirewallRule -DisplayName "Switch Google Port 1909" -Direction Inbound -LocalPort 1909 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
        Write-Host "✓ Đã mở cổng 1909 trong Windows Firewall cho các máy khác kết nối." -ForegroundColor Green
    } else {
        Write-Host "✓ Quy tắc tường lửa Windows Firewall cho cổng 1909 đã sẵn sàng." -ForegroundColor Green
    }
} catch {
    # Thử qua netsh dự phòng nếu cmdlet NetSecurity không có quyền
    try {
        netsh advfirewall firewall add rule name="Switch Google Port 1909" dir=in action=allow protocol=TCP localport=1909 *>$null
    } catch {}
}

# 6. Kích hoạt tự khởi động cùng Windows & Bật server ngầm
Write-Host "⏳ Đang kích hoạt tự khởi động cùng Windows và bật server ngầm..." -ForegroundColor Cyan
try {
    node "$targetDir\dist\cli.js" daemon enable
    node "$targetDir\dist\cli.js" daemon start
} catch {
    Write-Host "⚠ Không thể tự bật daemon: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 7. Mở trình duyệt Web Dashboard
Start-Sleep -Seconds 1
Start-Process "http://localhost:1909"

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "🎉 CÀI ĐẶT SWITCH GOOGLE THÀNH CÔNG RỰC RỠ TRÊN WINDOWS!                " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 Trình duyệt Web Dashboard đã được mở tại: http://localhost:1909" -ForegroundColor Cyan
Write-Host "  ⚡ Server đang chạy ngầm và sẽ tự bật lại mỗi khi bạn mở máy tính!" -ForegroundColor Yellow
Write-Host "  🔌 Kết nối từ máy khác qua mạng LAN: http://<IP_MÁY_WINDOWS>:1909/v1" -ForegroundColor Green
Write-Host "  ⌨️ Từ nay bạn có thể mở PowerShell ở bất cứ đâu và gõ:" -ForegroundColor White
Write-Host "     • switch-google serve    : Bật Web Server" -ForegroundColor Gray
Write-Host "     • switch-google update   : Cập nhật bản mới" -ForegroundColor Gray
Write-Host "     • switch-google list     : Xem danh sách tài khoản" -ForegroundColor Gray
Write-Host ""
