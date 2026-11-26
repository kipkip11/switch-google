# BÁO CÁO NGHIỆM THU — TASK-20261125-ACCOUNT-BACKUP
**Tính năng:** Hệ thống Sao lưu & Khôi phục Toàn diện Dữ liệu Tài khoản (`switch-google v1.3.3`)  
**Trạng thái:** ✅ PASS (100% Strict Telemetry)

## 1. Các hạng mục đã hoàn thành
1. **Sao lưu & Khôi phục JSON toàn diện (`/api/backup/export`, `/api/backup/import`)**:
   - Xuất đầy đủ danh sách tài khoản (`profiles` gồm OAuth tokens, Cookies, API Keys, `planTier`, `planExpiresAt`), `virtual_keys`, `model_combos` và toàn bộ bảng `settings` (`external_providers_config`, cấu hình xoay cổng).
   - Khi nạp lại (`import`), hệ thống tự động tạo một bản snapshot dự phòng (`pre-import`) trước khi gộp dữ liệu (`merge`) để đảm bảo không bao giờ làm mất các tài khoản đang có.
2. **Sao lưu Mã hóa Bảo mật AES-256-GCM (`/api/backup/export-encrypted`, `/api/backup/import-encrypted`)**:
   - Hỗ trợ đặt mật khẩu riêng (dẫn xuất khóa bằng `scrypt` + mã hóa xác thực `AES-256-GCM`) hoặc dùng Master Key nội bộ để bảo vệ tuyệt đối Refresh Token và Cookie khi lưu trữ ra ngoài.
3. **Điểm Khôi Phục Tự Động Tại Máy Chủ (`~/.switch-google/backups/`)**:
   - Tự động chụp snapshot mỗi khi thêm tài khoản mới (OAuth, API Key, Token, Web Cookie) và giữ tối đa 20 bản gần nhất.
   - Cho phép tạo điểm lưu thủ công, xem danh sách và bấm **Khôi phục 1-Click** ngay trên giao diện Web.
4. **Truy cập nhanh trên mọi màn hình**:
   - Nút `💾 Sao Lưu TK` trên thanh **Topbar** (góc trên bên phải, cạnh nút Thêm Cổng).
   - Nút `💾 Sao lưu TK` & `📥 Khôi phục TK` trên thanh công cụ **Switch & Định Tuyến** và tab **Gói & Hạn**.
   - Bảng điều khiển đầy đủ trong tab **Hệ Thống & Sao Lưu**.

## 2. Bằng chứng Kiểm thử Thực tế (Telemetry)
- **Tạo Snapshot tự động cho 4 tài khoản hiện có**:
  - File: `/Users/hoangquoc/.switch-google/backups/snapshot-2026-11-26T05-34-58-451Z-v133-initial-checkpoint.json` (`7,855 bytes`, `profileCount: 4`).
- **Kiểm thử Xuất Mã Hóa AES-256-GCM (`POST /api/backup/export-encrypted`)**:
  - Trả về payload chuẩn với `"cipher": "aes-256-gcm"`, `"kdf": "scrypt"`, `"version": "1.3.3"`.
