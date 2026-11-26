# SPEC: TÍNH NĂNG ĐIỀU PHỐI MÔ HÌNH THÔNG MINH THEO ĐỘ PHỨC TẠP TÁC VỤ (SMART COMPLEXITY-AWARE ROUTING)

**Task ID:** TASK-20261125-SMART-ROUTER  
**Tác giả:** @phan-tich  
**Trạng thái:** APPROVED_AUTONOMOUS (Theo quy chuẩn v2.1)  

---

## 1. MỤC TIÊU & BỐI CẢNH
Người dùng mong muốn:
- Khi một yêu cầu gửi đến có tính logic cao, bài toán lập trình phức tạp, phân tích chuyên sâu (Reasoning / Complex Coding), hệ thống sẽ **tự động điều phối đến các mô hình thông minh hàng đầu** (ví dụ: `gemini-3.8-pro`, `gemini-2.5-pro`, `claude-3-7-sonnet`, `deepseek-r1`).
- Khi yêu cầu là các tác vụ đơn giản (chat ngắn, dịch thuật cơ bản, tóm tắt nhanh, sửa lỗi chính tả, câu hỏi phổ thông), hệ thống sẽ **điều phối đến các mô hình tốc độ cao, tiết kiệm chi phí/token** (ví dụ: `gemini-3.8-flash`, `gemini-2.5-flash`, `gpt-4o-mini`).
- Cho phép người dùng tùy chọn chiến lược mới trong Model Combos: **`smart-routing`** (Bên cạnh 2 chiến lược cũ: `fallback` và `round-robin`).

---

## 2. THIẾT KẾ BỘ PHÂN LOẠI TÁC VỤ (COMPLEXITY ANALYZER)
1. **Tiêu chí phát hiện Tác vụ Logic / Code cao (Smart / Heavy Task):**
   - **Độ dài ngữ cảnh & Cấu trúc:**
     + Số lượng tin nhắn hoặc tổng ký tự prompt lớn (> 3.500 ký tự).
     + Có sự xuất hiện của Tool Calls / Multi-Turn Function Calling phức tạp.
   - **Từ khóa & Mẫu hình chuyên môn (Regex Patterns):**
     + *Lập trình & Kiến trúc:* `refactor`, `algorithm`, `debug`, `stack trace`, `architecture`, `database schema`, `mutex`, `concurrency`, `deadlock`, `unit test`, `optimize query`, `race condition`, mã nguồn có block ```python, ```rust, ```typescript, ```go...
     + *Tư duy & Suy luận logic:* `suy luận`, `chứng minh`, `giải thích chi tiết từng bước`, `step by step`, `phân tích logic`, `reasoning`, `so sánh ưu nhược điểm`.
2. **Tiêu chí phát hiện Tác vụ Đơn giản (Simple / Fast Task):**
   - Độ dài ngắn (< 800 ký tự), các câu chào hỏi, dịch câu, tra cứu định nghĩa đơn giản, format văn bản.

---

## 3. THIẾT KẾ KỸ THUẬT & CODEBASE
1. **Module `src/services/smartRouter.ts`:**
   - Hàm `classifyComplexity(messages: any[], tools?: any[]): 'smart' | 'fast'`
   - Tính toán điểm số phức tạp (Complexity Score 0 - 100). Nếu Score >= 45 -> `'smart'`, ngược lại -> `'fast'`.
2. **Nâng cấp Model Combo (`storage.ts` & `sqliteStorage.ts`):**
   - Bổ sung giá trị `strategy: 'fallback' | 'round-robin' | 'smart-routing'`
3. **Bộ chuyển tiếp `src/server/openaiAdapter.ts`:**
   - Khi combo có `strategy === 'smart-routing'`:
     + Phân loại `smart` vs `fast`.
     + Lựa chọn model thông minh (chứa từ khóa `pro`, `sonnet`, `r1`, `opus`, `reasoning`) hoặc model tốc độ cao (`flash`, `mini`, `haiku`).
4. **Giao diện Web (`public/js/management-view.js` & `index.html`):**
   - Bổ sung tùy chọn chiến lược: **🧠 Tự Động Theo Độ Phức Tạp (Smart-Routing)** trong form tạo/sửa Model Combo.
   - Thêm badge hiển thị trên từng Combo: `Smart-Routing`.
