# 🚀 Switch-Google v1.3.0: Gemini Web Mode & Zero-Touch Self-Healing

Bản cập nhật lớn **v1.3.0** mang đến khả năng **vượt rào cản chặn Antigravity của Google hoàn toàn tự động**, hệ thống lưu trữ bền vững **SQLite Binary Resilience**, và cơ chế **Zero-Touch Self-Healing** không cần người dùng can thiệp thủ công!

---

### 🌟 Điểm Nhấn Cốt Lõi (Highlights)

1. **🔥 Gemini Web Mode 1-Click (Chrome DevTools Protocol Bridge)**
   - Tự động hóa trích xuất cookie phiên (`__Secure-1PSID`, `__Secure-1PSIDTS`) và token `SNlM0e` từ giao diện Gemini Web (`gemini.google.com/app`).
   - Không cần mở F12 DevTools copy cookie thủ công.
   - Hoàn toàn 0 thư viện bên ngoài (`0 external dependencies`), tương thích 100% mọi phiên bản Node.js (20.x, 22.x, 24.x).
   - Vượt qua 100% rào cản lỗi `403 PERMISSION_DENIED / SUBSCRIPTION_REQUIRED / TOS_VIOLATION` từ Google CloudCode API.

2. **🤖 Cơ Chế Tự Động Phục Hồi Ngầm (Zero-Touch Self-Healing)**
   - Khi một tài khoản bị Google chặn, hệ thống tự động phát hiện và **lập tức failover sang tài khoản sống khác trong pool (0s downtime)**.
   - Đồng thời trong nền, hệ thống tự động kích hoạt tiến trình chuyển đổi tài khoản đó sang Web Mode và tự gỡ chặn khi hoàn tất.
   - Thêm lệnh CLI: `switch-google auto-heal` để tự động phục hồi tất cả tài khoản bị chặn.

3. **🛡️ Lưu Trữ SQLite Bền Vững & Tự Động Sao Lưu**
   - Hỗ trợ cả Native SQLite và `FallbackSqliteDb`.
   - Cơ chế tự động sao lưu dữ liệu trước mỗi lần cập nhật, bảo toàn tuyệt đối danh sách tài khoản của bạn.
   - Cách ly hoàn toàn môi trường Unit Test, không phá hoại database thật.

4. **⚡ Sửa Lỗi Cài Đặt 1-Click Trên Windows PowerShell**
   - Khắc phục lỗi UTF-8 BOM `'#'`, lỗi cú pháp `$targetDir:` và lỗi file lock trên Windows.
   - Cài đặt mượt mà chỉ qua 1 dòng lệnh:
     ```powershell
     irm https://raw.githubusercontent.com/kipkip11/switch-google/main/install.ps1 | iex
     ```

---

### 📦 Hướng Dẫn Cập Nhật Lên v1.3.0

- **Qua CLI**:
  ```bash
  switch-google update
  ```
- **Hoặc chạy lại lệnh cài đặt nhanh**:
  - **Windows (PowerShell)**:
    ```powershell
    irm https://raw.githubusercontent.com/kipkip11/switch-google/main/install.ps1 | iex
    ```
  - **macOS / Linux**:
    ```bash
    curl -fsSL https://raw.githubusercontent.com/kipkip11/switch-google/main/install.sh | bash
    ```
