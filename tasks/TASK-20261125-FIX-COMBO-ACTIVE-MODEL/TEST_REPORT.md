# TEST REPORT: KIỂM THỬ KHẮC PHỤC CHỌN MODEL TRONG COMBO NHƯNG KHÔNG CHẠY MODEL ĐÓ

**Task ID:** TASK-20261125-FIX-COMBO-ACTIVE-MODEL  
**Kiểm thử viên:** @qc  
**Quy trình:** Tiêu chuẩn Vận hành Tự chủ v2.1 (Strict Telemetry Verification)  
**Kết luận:** PASS_100_PERCENT  

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)
Sau khi soi mã nguồn tại `src/server/openaiAdapter.ts`, @dev và @qc phát hiện 2 nguyên nhân khiến model bạn chọn không có hiệu lực:
1. **Thiếu cơ chế Override toàn cục khi System Combo đang bật:**
   - Trong `openaiAdapter.ts`, đoạn code cũ chỉ tìm combo khi model request gửi lên trùng tên combo (`model.toLowerCase() === combo.name.toLowerCase()`) hoặc khi `model === 'default' || model === 'auto'`.
   - Nếu IDE (như Hermes, Cursor, Cline) gửi tên model cụ thể như `gpt-4o`, `gemini-1.5-flash` hay `AI` viết hoa/thường lệch, hệ thống bỏ qua Combo hệ thống đang kích hoạt (`activeModel`) và nhảy thẳng vào chuỗi fallback mặc định của model đó.
2. **Không đồng bộ ngay lập tức lên màn hình hiển thị Switch & API Status:**
   - `GET /api/status` trước đó lấy model hiển thị trên màn hình LCM Switch từ log gần nhất (`recentLogs[0]?.model`). Khi bạn vừa bấm chọn model mới trong Combo nhưng chưa có request mới sinh ra, màn hình LCM và Topology vẫn hiển thị model cũ khiến bạn tưởng rằng model chưa được chọn.

---

## 2. KẾT QUẢ KHẮC PHỤC & BẰNG CHỨNG THỰC TẾ
1. **Nâng cấp `src/server/openaiAdapter.ts`:**
   - Khi có Combo đang bật trạng thái **⚡ Kích Hoạt Hệ Thống**, mọi request gửi tới Gateway (kể cả gọi `gpt-4o`, `gemini-3.8-flash` hay `AI`) đều được **ép buộc áp dụng chính xác `activeModel` mà bạn đã bấm chọn trong Combo**.
2. **Nâng cấp `src/server/api.ts` & `public/js/management-view.js`:**
   - `GET /api/status` ưu tiên lấy ngay `activeModel` của Combo hệ thống đang kích hoạt.
   - Khi bạn bấm vào model bất kỳ trong danh sách Combo, UI lập tức cập nhật màn hình LCM trên Switch và Topology Hub ngay thời gian thực.
3. **Bằng chứng kiểm thử tự động (Raw Telemetry):**
   - **Thử nghiệm 1:** Bấm chọn `claude-3-7-sonnet` -> Gọi API chat completions -> Kết quả trả về model: `"claude-3-7-sonnet"`.
   - **Thử nghiệm 2:** Bấm chọn `gemini-3.8-flash` -> Gọi API chat completions -> Kết quả trả về model: `"gemini-3.8-flash"`.
   - **Thử nghiệm 3:** Bấm chọn `gemini-4-argon-high` -> Kết quả trả về model: `"gemini-4-argon-high"`.
