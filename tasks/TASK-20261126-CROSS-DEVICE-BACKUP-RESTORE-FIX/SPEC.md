# SPEC — TASK-20261126-CROSS-DEVICE-BACKUP-RESTORE-FIX
**Task ID:** TASK-20261126-CROSS-DEVICE-BACKUP-RESTORE-FIX  
**Mục tiêu:** Khắc phục triệt để lỗi sao lưu tài khoản chuyển sang máy khác không nhận hết tài khoản hoặc thất bại.  
**Trạng thái phê duyệt:** Chờ @phan-bac đánh giá và cấp `AUTO_PASS_TOKEN`.

---

## 1. Nguyên nhân gốc rễ (Root Cause Analysis - RCA)
1. **Khóa Master Key cục bộ (`master.key`) không tương thích giữa các máy**:
   - Khi người dùng chọn "Xuất Mã Hóa" mà không điền mật khẩu (`passphrase`), hệ thống sử dụng `master.key` được sinh ngẫu nhiên trên máy gốc để mã hóa AES-256-GCM.
   - Khi mang file `.enc.json` này sang máy khác, máy đích có `master.key` khác hoàn toàn, dẫn đến giải mã ném lỗi `Unsupported state or unable to authenticate data`, khiến 0 tài khoản nào được nhập sang máy mới.
2. **Xung đột định dạng Payload & Thiếu cờ cưỡng bức ghi đè (`merge vs replace`)**:
   - `/api/backup/import` hỗ trợ cả 3 định dạng: `{ storage: { profiles } }`, `{ data: { profiles } }`, hoặc `{ profiles }`. Tuy nhiên nếu một số tài khoản trên máy mới có trùng email nhưng khác tên profile hoặc ngược lại, việc gộp theo `name` có thể bị ẩn hoặc ghi đè không mong muốn.
   - Khi import xong qua SQLite, danh sách cổng (`rotator.ports`) trên bộ nhớ máy đích chưa được reset/refresh tức thì khiến giao diện UI vẫn hiển thị số cổng cũ cho đến khi khởi động lại server.
3. **Cơ chế Phục hồi Toàn vẹn (Universal Cross-Machine Format)**:
   - File JSON tiêu chuẩn (`/api/backup/export`) chứa toàn bộ `refresh_token`, `access_token`, `cookies`, `api_key` dưới dạng plaintext JSON nội bộ để chuyển máy an toàn mà không phụ thuộc vào `master.key`.
   - Cần bổ sung tùy chọn **"Ghi đè hoàn toàn (Clean Import)"** hoặc **"Gộp tài khoản (Smart Merge)"** trên giao diện để người dùng chủ động quyết định thay thế toàn bộ hay cộng dồn.
   - Cần ép buộc reload `rotator` và xóa sạch RAM cache ngay trong endpoint import.

---

## 2. Kế hoạch triển khai (Implementation Plan)
1. **Backend (`src/server/api.ts` & `src/auth/storage.ts`)**:
   - Trong `exportEncryptedBackup()`: Bắt buộc yêu cầu `passphrase` khi mã hóa di chuyển máy; nếu không có passphrase, cảnh báo hoặc dùng thuật toán dẫn xuất khóa chuẩn hóa.
   - Trong `app.post('/api/backup/import')`:
     - Chuẩn hóa mọi biến thể của payload (`storage`, `data`, `profiles`).
     - Hỗ trợ cờ `cleanImport = true`: Xóa sạch tài khoản cũ trên máy ít tài khoản để chuyển trọn vẹn 100% tài khoản từ máy nguồn sang.
     - Đồng bộ lại `rotator.resetCache()` / `rotator.initPorts()` để UI cập nhật ngay lập tức.
2. **Frontend UI (`public/js/management-view.js` & `public/index.html`)**:
   - Khi bấm "Nạp JSON" hoặc "Nạp Mã Hóa", hiển thị hộp thoại xác nhận rõ ràng:
     - Cho phép chọn: Gộp thêm vào tài khoản hiện tại HOẶC Thay thế hoàn toàn bằng danh sách tài khoản từ file sao lưu.
   - Thêm nút "Sao lưu Di chuyển Máy (Cross-Machine Package)" xuất trọn gói 1 file JSON chứa 100% tài khoản và cấu hình.
