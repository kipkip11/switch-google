# SPEC: BỔ SUNG TAB DỊCH VỤ AI MỞ RỘNG (MULTI-PROVIDER SERVICES) CHO SWITCH-GOOGLE

**Task ID:** TASK-20261122-MULTI-SERVICES  
**Tác giả:** @phan-tich  
**Trạng thái:** DRAFT / PENDING_REVIEW  
**Phiên bản:** 1.0  
**Ghi chú từ User:** LOẠI BỎ hoàn toàn tính năng RTK Token Saver (giữ nguyên vẹn 100% prompt/tool output của user).

---

## 1. MỤC TIÊU & PHẠM VI
- Mở rộng năng lực của `switch-google` từ cổng chuyển đổi tài khoản Google thành một **Universal AI Hub**, học hỏi mô hình multi-provider linh hoạt từ dự án `9router`.
- Thêm Tab mới trên giao diện Web Dashboard: **`Dịch Vụ AI Mở Rộng` (Providers & Services)**.
- Tích hợp các nhà cung cấp AI phổ biến và miễn phí:
  1. **OpenCode Free (Miễn phí 100%, không cần API Key):** Endpoint mở cung cấp các model code miễn phí.
  2. **Kiro AI:** Miễn phí hạn mức hàng tháng (~50 credits: Claude, GLM, MiniMax).
  3. **DeepSeek (V3 / R1):** API tốc độ cao, giá rẻ.
  4. **GLM (ZhipuAI / BigModel):** GLM-4 / GLM-5.
  5. **MiniMax:** M2.5 / M2.7.
  6. **Groq / OpenRouter / Custom OpenAI-compatible:** Dành cho người dùng tự gắn key bên ngoài.
- Cơ chế **Smart Fallback:** Khi Google CloudCode/Antigravity bị dính Rate Limit 429 hoặc lỗi 503, hệ thống tự động failover sang Provider dự phòng đã kích hoạt.

---

## 2. KIẾN TRÚC & FILE THAY ĐỔI DỰ KIẾN
1. **Frontend UI (`public/index.html` & `public/js/dashboard.js`):**
   - Thêm nút tab trên thanh điều hướng bên trái: `<button class="rail-btn" data-tab="providers">`.
   - Giao diện quản lý danh sách Providers dạng thẻ (Cards) với nút Toggle Bật/Tắt, trường nhập API Key, Base URL và chọn Model mặc định.
   - Hiển thị tình trạng kết nối (Active / Quota / Inactive).
2. **Backend Storage (`src/storage/sqliteStorage.ts` & `src/auth/storage.ts`):**
   - Bổ sung bảng hoặc cấu trúc lưu trữ `external_providers`: `{ id, name, type, apiKey, baseUrl, isEnabled, priority, defaultModel }`.
3. **OpenAI Gateway Adapter (`src/server/openaiAdapter.ts`):**
   - Khi nhận request `/v1/chat/completions`:
     - Nếu model thuộc nhóm Google (`gemini-*`, `antigravity-*`): Xử lý qua Google Pool hiện tại.
     - Nếu model có tiền tố Provider khác (ví dụ `oc/*` cho OpenCode, `ds/*` cho DeepSeek, `glm/*`) hoặc khi chuỗi Fallback được kích hoạt: Chuyển tiếp request tới upstream provider tương ứng theo chuẩn OpenAI-compatible.

---

## 3. ACCEPTANCE CRITERIA (AC)
- **AC-1:** Giao diện Dashboard hiển thị Tab "Dịch Vụ AI" rõ ràng, đồng bộ phong cách thiết kế Slate-50 hiện có.
- **AC-2:** Thêm, bật/tắt và lưu cấu hình Provider thành công vào SQLite.
- **AC-3:** Kết nối thử nghiệm thành công với ít nhất 1 Provider miễn phí (OpenCode Free) không cần API Key.
- **AC-4:** Khi gọi Gateway `/v1/chat/completions` với model của Provider mới, trả về kết quả stream trơn tru.
- **AC-5:** Tuyệt đối giữ nguyên vẹn nội dung prompt/tool output, không nén hay cắt bớt dữ liệu (Tuân thủ chỉ đạo bỏ RTK).
