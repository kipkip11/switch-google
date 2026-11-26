# SPEC — TASK-20261126-FIX-SMART-ROUTING-ENGINE
**Task ID:** TASK-20261126-FIX-SMART-ROUTING-ENGINE  
**Mục tiêu:** Khắc phục và tối ưu hóa toàn diện tính năng Smart-Routing để thực sự thông minh, chính xác và hiệu quả.

---

## 1. Nguyên nhân gốc rễ (Root Cause Analysis)
Qua rà soát chuyên sâu hệ thống phát hiện 3 vấn đề lớn khiến Smart-Routing chưa hoạt động tốt:
1. **Trạng thái Combo "AI" trong SQLite bị lệch về `fallback` thay vì `smart-routing`**:
   - Khi gọi API `/api/combos/active`, combo đang kích hoạt toàn hệ thống là `"AI"` nhưng trường `strategy` lại là `"fallback"`, dẫn đến việc hệ thống luôn bỏ qua thuật toán SmartRouter và chỉ gọi model cố định (`gemini-3.8-flash`)!
2. **Kênh MITM Fast-Pipe (`mitmServer.ts`) hoàn toàn chưa tích hợp SmartRouter**:
   - Trong `mitmServer.ts` (cổng 443/8443 mà Antigravity IDE hay Cursor kết nối trực tiếp), code đang hardcode lấy `activeModel` cố định, không hề chạy qua `SmartRouter.calculateComplexity(messages, tools)`. Do đó mọi request đi qua MITM Fast-Pipe đều không được định tuyến thông minh theo nội dung code/logic!
3. **Bộ nhận diện `SmartRouter.ts` quá phụ thuộc vào tin nhắn cuối cùng (Last Message Only)**:
   - Trong các cuộc hội thoại pair-programming của IDE, tin nhắn cuối cùng của user thường rất ngắn (ví dụ: *"fix this"*, *"tiếp tục"*, *"tại sao lỗi"*, *"ok"*), trong khi toàn bộ code lỗi và bối cảnh kỹ thuật phức tạp lại nằm ở 2-3 tin nhắn trước đó (tool calls, assistant output, user prompt trước). Thuật toán chỉ xét `lastUserMessage` nên thường tính điểm thấp và bị gán nhầm sang `isComplex = false` (chọn Flash thay vì Claude 3.7 / Argon High).
4. **Quy tắc gán model ưu tiên `prioritizeModels`**:
   - Cần bổ sung nhận diện thêm các biến thể model cao cấp mới: `gemini-4-argon-high`, `claude-sonnet-5-5-high`, `gemini-3.8-flash-high`.

---

## 2. Kế hoạch sửa đổi (Implementation Plan)
1. **Nâng cấp `src/services/smartRouter.ts`**:
   - Quét cửa sổ 4 tin nhắn gần nhất (`sliding window of last 4 messages`) thay vì chỉ 1 tin nhắn.
   - Bổ sung nhận diện ngữ cảnh lập trình (stack traces, JSON schemas, diff patches, file paths, keywords tiếng Việt & tiếng Anh).
   - Hạ ngưỡng nhạy cảm `isComplex` xuống mức tối ưu để không bỏ lọt các tác vụ coding.
2. **Tích hợp SmartRouter vào `src/mitm/mitmServer.ts`**:
   - Khi `activeCombo.strategy === 'smart-routing'`, thực hiện trích xuất `contents` hoặc `messages` từ `parsedBody`, chạy qua `SmartRouter.calculateComplexity()` để quyết định thứ tự ưu tiên model upstream.
3. **Cập nhật Combo `"AI"` sang `strategy: 'smart-routing'`**:
   - Cập nhật DB SQLite đảm bảo combo `"AI"` chạy đúng chiến lược `smart-routing`.
4. **Kiểm thử Telemetry thực tế**:
   - Viết test case giả lập câu lệnh code ngắn (`"sửa bug này giúp tôi"`), câu lệnh code kèm stacktrace, và câu lệnh chào hỏi thông thường để kiểm chứng độ chính xác 100%.

**Phê duyệt:** Chờ @phan-bac đánh giá và cấp `AUTO_PASS_TOKEN`.
