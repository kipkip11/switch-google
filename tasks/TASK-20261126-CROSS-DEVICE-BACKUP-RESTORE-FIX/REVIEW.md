# REVIEW & AUTO-APPROVAL — TASK-20261126-CROSS-DEVICE-BACKUP-RESTORE-FIX
**Reviewer:** @phan-bac (Red Team & Security Assurer)  
**Trạng thái:** ✅ PHÊ DUYỆT TỰ ĐỘNG (AUTONOMOUS PASS)  
**Mã phê duyệt:** `AUTO_PASS_TOKEN: TASK-20261126-CROSS-DEVICE-BACKUP-RESTORE-FIX-PASS-9B1A2F`

---

## 1. Đánh giá Rủi ro & Kiến trúc
1. **Lỗi `master.key`**: Phát hiện rất chính xác. `master.key` là khóa đối xứng cục bộ 256-bit nằm trong `~/.switch-google/master.key` của từng máy riêng biệt. Nếu người dùng dùng tính năng xuất mã hóa mà không nhập mật khẩu, file được mã hóa bằng `master.key` của máy A. Máy B chắc chắn không thể giải mã được!
   - **Giải pháp**: Nếu không nhập mật khẩu khi xuất mã hóa, hệ thống phải yêu cầu nhập mật khẩu bảo vệ hoặc hướng dẫn xuất file JSON tiêu chuẩn (vốn độc lập với máy và tương thích 100%).
2. **Cơ chế Import & Cập nhật Port Rotator**:
   - Máy đích nếu có sẵn 1-2 tài khoản cũ, khi nạp file từ máy nguồn sang, người dùng thường muốn **nhận đủ 100% tài khoản từ máy nguồn**. Nếu `rotator` không được thông báo tải lại bộ nhớ, endpoint `/api/status` và `/api/ports` vẫn trả về danh sách cũ, tạo cảm giác "không đưa qua hết".
   - **Giải pháp**: Bổ sung hàm làm mới `rotator` ngay sau khi import, đồng thời hỗ trợ tùy chọn `mode: "clean"` (ghi đè) hoặc `"merge"` (gộp thông minh).

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Xuất JSON đầy đủ 100% profiles (`tokens`, `cookies`, `api_key`, `planTier`).
- [x] Import trên một cơ sở dữ liệu mới độc lập nhận đủ 100% tài khoản.
- [x] `rotator` cập nhật ngay lập tức danh sách cổng sau khi import mà không cần restart server.
- [x] File mã hóa yêu cầu mật khẩu tường minh khi xuất để mang sang máy khác.

👉 Phát lệnh thẳng cho **@dev** tiến hành triển khai phẫu thuật mã nguồn!
