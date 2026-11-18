# ==============================================================================
# Script Khởi Chạy & Quản Lý Switch Google Trên Windows PowerShell
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "Switch Google - Control Center"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-Header {
    Clear-Host
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "       🚀 SWITCH GOOGLE - TRUNG TÂM ĐIỀU KHIỂN & KHỞI CHẠY HỆ THỐNG     " -ForegroundColor Yellow
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host " Cổng Web Server mặc định: http://localhost:1909" -ForegroundColor Gray
    Write-Host ""
}

function Check-Build {
    if (-not (Test-Path "$PSScriptRoot\dist\cli.js")) {
        Write-Host "Chưa biên dịch mã nguồn. Đang chạy 'npm run build'..." -ForegroundColor Yellow
        npm run build
    }
}

function Run-Silent-Background {
    Check-Build
    Write-Host "`nĐang thiết lập chế độ chạy ngầm và tự khởi động cùng Windows..." -ForegroundColor Cyan
    
    # 1. Kích hoạt tự khởi động cùng Windows Startup
    node "$PSScriptRoot\dist\cli.js" daemon enable
    
    # 2. Khởi chạy ngầm không hiện cửa sổ console
    node "$PSScriptRoot\dist\cli.js" daemon start
    
    Write-Host "`n========================================================================" -ForegroundColor Green
    Write-Host "✓ HOÀN TẤT: Server đã chạy ngầm và sẽ tự bật lại mỗi khi bạn mở máy!" -ForegroundColor Green
    Write-Host "✓ Trình duyệt Web Dashboard đang được mở tại: http://localhost:1909" -ForegroundColor Green
    Write-Host "✓ Bạn có thể ĐÓNG CỬA SỔ POWERSHELL NÀY thoải mái, server vẫn hoạt động!" -ForegroundColor Yellow
    Write-Host "========================================================================`n" -ForegroundColor Green
    
    Start-Sleep -Seconds 3
}

function Run-Foreground-Console {
    Check-Build
    Write-Host "`nĐang khởi chạy server có cửa sổ để xem log trực tiếp..." -ForegroundColor Cyan
    Write-Host "Mở trình duyệt tại http://localhost:1909..." -ForegroundColor Gray
    Start-Process "http://localhost:1909"
    node "$PSScriptRoot\dist\cli.js" serve
}

function Stop-Background-Daemon {
    Write-Host "`nĐang dừng tiến trình chạy ngầm..." -ForegroundColor Yellow
    node "$PSScriptRoot\dist\cli.js" daemon stop
    Pause
}

function Open-Web-Dashboard {
    Write-Host "`nĐang mở Web Dashboard http://localhost:1909 trên trình duyệt..." -ForegroundColor Cyan
    Start-Process "http://localhost:1909"
}

function Update-System {
    Write-Host "`nĐang kết nối GitHub và kiểm tra bản cập nhật mới..." -ForegroundColor Cyan
    node "$PSScriptRoot\dist\cli.js" update
    Pause
}

function Disable-Boot-Start {
    Write-Host "`nĐang gỡ bỏ chế độ tự khởi động cùng Windows..." -ForegroundColor Yellow
    node "$PSScriptRoot\dist\cli.js" daemon disable
    Pause
}

do {
    Show-Header
    Write-Host " [1] ⚡ Chạy ngầm (Ẩn cửa sổ) + Mở Web + Tự khởi động cùng Windows" -ForegroundColor Green
    Write-Host " [2] 🖥️  Chạy có cửa sổ PowerShell (Để xem trực tiếp log)" -ForegroundColor White
    Write-Host " [3] 🌐 Mở Web Dashboard (http://localhost:1909)" -ForegroundColor Cyan
    Write-Host " [4] 🛑 Dừng tiến trình chạy ngầm (Stop Background Daemon)" -ForegroundColor Red
    Write-Host " [5] 🔄 Cập nhật hệ thống lên phiên bản mới nhất từ GitHub" -ForegroundColor Magenta
    Write-Host " [6] ❌ Tắt tính năng tự khởi động cùng máy tính" -ForegroundColor DarkYellow
    Write-Host " [0] Thoát" -ForegroundColor Gray
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Cyan
    
    $choice = Read-Host "Nhập lựa chọn của bạn [0-6]"

    switch ($choice) {
        "1" { Run-Silent-Background; break }
        "2" { Run-Foreground-Console; break }
        "3" { Open-Web-Dashboard }
        "4" { Stop-Background-Daemon }
        "5" { Update-System }
        "6" { Disable-Boot-Start }
        "0" { Write-Host "`nTạm biệt!`n" -ForegroundColor Gray; break }
        default { Write-Host "`nLựa chọn không hợp lệ, vui lòng chọn lại." -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
} while ($choice -ne "0" -and $choice -ne "1" -and $choice -ne "2")
