# Nhật Ký Thay Đổi (Changelog)

Tất cả các thay đổi đáng chú ý của dự án **Switch-Google** sẽ được ghi chép chi tiết tại file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/) và tuân thủ [Semantic Versioning](https://semver.org/).

---

## [1.3.1] - 2026-11-19

### 🚀 Tính Năng Mới (Features)
- **Tự Động Cập Nhật Ngầm Qua Bộ Lọc CI/CD (Zero-Touch Client Auto-Update)**:
  - Tích hợp `AutoUpdateWorker` chạy nền trong daemon trên các máy client, định kỳ kiểm tra phiên bản mới từ GitHub.
  - **Bộ lọc kiểm định CI/CD (Quality Gate Verification)**: Gọi GitHub Checks API xác thực trạng thái các bài kiểm thử (`Build, Lint & Unit Tests` trên ma trận Node.js 20, 22, 24).
  - Chỉ tự động tải và cập nhật khi toàn bộ pipeline CI/CD đạt trạng thái `status: completed` và `conclusion: success` 100%. Nếu bản cập nhật đang test dở hoặc bị lỗi, hệ thống sẽ bỏ qua để bảo vệ máy trạm.
  - **Graceful Self-Restart**: Tự động sao lưu database an toàn trước khi nâng cấp, tải code, build và khởi động lại server ngầm êm ái mà không gây xung đột socket/port.
  - **Quản lý linh hoạt trên Web Dashboard & CLI**:
    - Nút công tắc Bật/Tắt `Tự Động Cập Nhật (Auto-Update)` trực tiếp trên thanh Header của Dashboard.
    - Huy hiệu `CI: Verified ✅` hiển thị trực quan trạng thái kiểm định của bản cập nhật.
    - Lệnh CLI: `switch-google autoupdate [on|off|status]` và `switch-google daemon restart`.

---

## [1.3.0] - 2026-11-19

### 🚀 Tính Năng Mới (Features)
- **Gemini Web Mode 1-Click (Chrome CDP Bridge)**:
  - Tự động hóa đăng nhập Google và trích xuất session cookies (`__Secure-1PSID`, `__Secure-1PSIDTS`) trực tiếp qua Chrome DevTools Protocol (CDP) kết nối WebSocket nội bộ (`0 external dependency`).
  - Không cần người dùng phải mở DevTools (F12) copy cookie thủ công.
  - Vượt qua 100% rào cản chặn CloudCode/Antigravity API của Google đối với các tài khoản cá nhân.
- **Cơ Chế Tự Động Chữa Lành Ngầm (Zero-Touch Self-Healing)**:
  - Tự động nhận diện tài khoản bị Google chặn Antigravity (`403 PERMISSION_DENIED` do TOS hoặc SUBSCRIPTION_REQUIRED).
  - Tự động kích hoạt chuyển đổi sang Web Mode trong nền và tự gỡ chặn khi hoàn tất.
  - **Transparent Failover (0s downtime)**: Tự động chuyển tiếp câu hỏi sang các tài khoản khỏe mạnh trong pool, đảm bảo người dùng đang code trên Cursor / Cline / Hermes không bao giờ bị gián đoạn.
- **Bộ Lệnh CLI Mở Rộng**:
  - `switch-google login-web [tên_profile]`: Đăng nhập Google Web Mode tự động 1-click.
  - `switch-google upgrade-web <tên_profile>`: Chuyển đổi một tài khoản OAuth sang Web Mode.
  - `switch-google auto-heal`: Tự động rà soát và phục hồi toàn bộ tài khoản bị chặn sang Web Mode.
  - `switch-google list`: Hiển thị nhãn cảnh báo trực quan `⚠️ Bị chặn Antigravity (Cần Web Mode)`.
- **Giao Diện Web Dashboard**:
  - Bổ sung tab **⚡ Web Mode Tự Động** trong popup thêm cổng.
  - Thêm huy hiệu cảnh báo và nút bấm **⚡ Chuyển sang Web Mode** trực tiếp trên từng card cổng mạng RJ45 và sơ đồ mạng (Topology View).
  - Đèn LED trạng thái hiển thị động: `🔄 Đang tự chuyển Web Mode...`.
  - Hiển thị bảng lịch sử sử dụng token chi tiết và biểu đồ lưu lượng realtime.

### 🛡️ Cải Tiến & Độ Bền Dữ Liệu (Enhancements & Storage)
- **Hệ Thống Lưu Trữ SQLite Nhị Phân & Fallback**:
  - Lưu trữ cơ sở dữ liệu `switch_google.sqlite` hỗ trợ cả Node.js Native SQLite (`node:sqlite`) và `FallbackSqliteDb` tương thích 100% với Node.js 20.x, 22.x, 24+.
  - Cơ chế tự động phát hiện và migrate dữ liệu từ file JSON cũ sang SQLite nhị phân an toàn.
  - Tự động sao lưu dữ liệu (`.backup.sqlite`) trước mỗi lần update, chống mất mát tài khoản.
  - Cách ly hoàn toàn môi trường Unit Test sang thư mục tạm, bảo vệ 100% dữ liệu người dùng thật.
- **An Toàn Đa Luồng & Bộ Nhớ**:
  - Bổ sung Mutex `isWebLoginInProgress` chống race condition và ngăn chặn mở nhiều cửa sổ Chrome gây tràn RAM/CPU.
  - Vòng đời Sandbox: Tự động giải phóng tiến trình Chrome (`SIGTERM`) và dọn dẹp thư mục tạm trong khối `finally`.

### 🐛 Sửa Lỗi (Bug Fixes)
- Sửa lỗi PowerShell `install.ps1`:
  - Loại bỏ ký tự UTF-8 BOM gây lỗi parse lệnh `'#'`.
  - Sửa lỗi cú pháp biến chuỗi `$targetDir:` (`InvalidVariableReferenceWithDrive`).
  - Thêm cơ chế giải phóng tiến trình cũ và chống lỗi file lock (`The process cannot access the file because it is being used by another process`).
- Triệt tiêu hoàn toàn hiện tượng nháy cửa sổ đen CMD khi chạy daemon ngầm trên Windows.
- Khắc phục lỗi `Invalid API Key` trên `/v1/models` và bổ sung danh sách model tiêu chuẩn.

---

## [1.1.0] - 2026-10-18
- Bổ sung script cài đặt 1 chạm cho Windows PowerShell (`install.ps1`).
- Hỗ trợ chạy ngầm dưới dạng tiến trình Daemon (`switch-google daemon start`).
- Hỗ trợ tự động khởi động cùng máy tính trên Windows (Startup Folder) và macOS (Launchd plist).
- Tích hợp tính năng tự cập nhật bản mới từ GitHub (`switch-google update`).

---

## [1.0.0] - 2026-10-01
- Bản phát hành đầu tiên của Switch-Google.
- Hỗ trợ quản lý đa tài khoản Google OAuth2.
- Local token server cung cấp Access Token và OpenAI-compatible adapter (`/v1/chat/completions`).
- Cơ chế xoay vòng tải Round-Robin và Fallback.
- Web Dashboard trực quan mô phỏng Switch mạng RJ45.
