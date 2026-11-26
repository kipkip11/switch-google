# SPEC — TASK-20261126-ULTRA-LOW-LATENCY-CODING-ASSISTANT
**Task ID:** TASK-20261126-ULTRA-LOW-LATENCY-CODING-ASSISTANT  
**Mục tiêu:** Giải quyết triệt để tình trạng xử lý chậm (15s - 70s/request) khi kết nối `switch-google` với `coding assistant` và hoàn thiện `SmartRouter`.

---

## 1. Phân tích Nguyên nhân gốc rễ (Strict Telemetry Evidence)
Qua đo đạc thực tế trên hệ thống `switch-google` đang phục vụ `coding assistant`:
1. **Context phình to 172,000+ prompt tokens mỗi lượt gọi**:
   - Lịch sử hội thoại của `coding assistant` có tới hơn 200+ messages (172K tokens), nhưng biến `SG_ENABLE_CONTEXT_COMPACT` mặc định bị tắt, khiến `switch-google` gửi nguyên khối 172K tokens lên Google CloudCode ở MỌI lượt tool call -> riêng khâu prefill trên server Google mất **15s - 36s**!
2. **Model `gemini-4-argon-high` có thời gian prefill & suy nghĩ (Deep Thinking) quá lâu**:
   - Kết quả benchmark trực tiếp trên CloudCode:
     + `gemini-2.5-flash`: **994 ms** (~0.9 giây)
     + `claude-sonnet-5-5-high`: **2,273 ms** (~2.2 giây)
     + `gemini-3.8-flash-high`: **3,030 ms** (~3.0 giây)
     + `gemini-4-argon-high`: **6,014 ms -> 27,000 ms** (quá chậm cho các lượt gọi tool liên hoàn của coding assistant).
   - Khi `SmartRouter` ưu tiên `gemini-4-argon-high` lên đầu danh sách cho mọi lượt gọi có tool, mỗi lệnh của coding assistant bị chậm gấp 5-10 lần so với `claude-sonnet-5-5-high` hoặc `gemini-3.8-flash-high`.
3. **Round-Robin trong `rotator.ts` vẫn xoay vào 2 tài khoản `web_session` (`eco2026v2`, `hoangnamkipkip`) đang bị lỗi Cookie HTTP 302**:
   - Trong `getNextAccount()`, nhánh `round-robin` chưa sắp xếp ưu tiên tài khoản `oauth` lên trước `web_session`, và khi `web_session` trả về lỗi `HTTP 302 Cookie`, nó chỉ bị cooldown 20 giây rồi lại tiếp tục bị gọi vào gây đứt quãng 3-5 giây.
4. **Combo `activeModel` ghi đè kết quả của `SmartRouter`**:
   - Trong `openaiAdapter.ts`, khi một request chạy xong và cập nhật `activeModel = gemini-4-argon-high`, đồng thời logic `calculateComplexity` chấm điểm quá cao cho ngữ cảnh cũ trong sliding window, khiến các câu lệnh đơn giản sau đó cũng bị cuốn vào `gemini-4-argon-high` thay vì model tốc độ cao.

---

## 2. Giải pháp Kỹ thuật Toàn diện
1. **Tự động kích hoạt Smart Context Window Compaction (`compactMessagesWindow`)**:
   - Bật mặc định khi `messages.length > 60` (giữ trọn vẹn System Prompt + Yêu cầu gốc + 40 lượt message/tool gần nhất, đảm bảo không mất bất kỳ tool call đang chạy nào nhưng cắt giảm 75% dung lượng payload dư thừa).
2. **Tối ưu hóa Chiến lược Ưu tiên Tốc độ & Trí tuệ trong `SmartRouter`**:
   - Phân tích độ phức tạp dựa trên **tin nhắn cuối cùng của User (hoặc lượt Tool cuối)** để phản ánh đúng yêu cầu tức thời:
     + Nếu là câu lệnh điều hành nhanh, kiểm tra trạng thái, đọc file, chạy lệnh đơn giản (`isComplex = false`): Dùng ngay **`gemini-3.8-flash-high`** / **`gemini-2.5-flash`** (phản hồi < 1.5s).
     + Nếu là tác vụ viết code phức tạp, kiến trúc, sửa bug sâu (`isComplex = true`): Ưu tiên **`claude-sonnet-5-5-high`** lên số 1 (tốc độ chỉ **2.2s**, nhanh gấp 3 lần Argon High mà chất lượng code đỉnh cao), tiếp theo mới đến `gemini-4-argon-high`.
3. **Loại bỏ hoàn toàn độ trễ Failover từ Web Cookie lỗi và Model 404**:
   - Trong `rotator.ts`: Khi có các tài khoản `oauth` đang hoạt động tốt, **chỉ xoay vòng trong nhóm OAuth Direct API** (bỏ qua hoàn toàn `web_session` trừ khi toàn bộ OAuth đều hết quota). Nếu `web_session` báo lỗi `HTTP 302 Cookie`, đánh dấu `isExpired = true` ngay lập tức để không bao giờ thử lại vô ích.
   - Trong `openaiAdapter.ts`: Khử trùng lặp danh sách `modelCandidates` sau khi qua `resolveUpstreamModel` (tránh việc thử `claude-3-7-sonnet` rồi lại thử `claude-3-5-sonnet` khi cả hai đều trỏ về cùng một upstream `claude-sonnet-5-5-high`).

**Phê duyệt:** Chờ @phan-bac cấp `AUTO_PASS_TOKEN`.
