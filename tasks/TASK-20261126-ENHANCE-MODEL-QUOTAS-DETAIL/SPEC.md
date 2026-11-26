# SPEC — TASK-20261126-ENHANCE-MODEL-QUOTAS-DETAIL
**Task ID:** TASK-20261126-ENHANCE-MODEL-QUOTAS-DETAIL  
**Mục tiêu:** Nâng cấp tab "Hạn Ngạch & Công Suất Theo Model" chi tiết toàn diện hơn:
1. Thêm bộ lọc model & tìm kiếm nhanh.
2. Thêm thẻ tổng quan Dashboard Quota: Tổng công suất Pool Tokens/ngày, Tốc độ gộp RPM/TPM, Tỷ lệ sử dụng trung bình, Số lượng Model hỗ trợ.
3. Mở rộng danh sách Model Quotas đầy đủ tất cả các dòng model chủ lực:
   - `gemini-4-argon-high` & `gemini-4-argon`
   - `gemini-3.8-flash-high` & `gemini-3.8-flash`
   - `claude-sonnet-5-5-high` & `claude-3-7-sonnet` (Thinking)
   - `claude-3-5-sonnet`
   - `gemini-2.5-pro` & `gemini-2.5-flash`
4. Chi tiết từng Card Model:
   - Thông số TPM (Tokens Per Minute), RPM (Requests Per Minute), Max Context Window (2M/1M/200K tokens).
   - Giá trị quy đổi Token sang VNĐ ước tính trong ngày.
   - Trạng thái sức khỏe Model (Operational / Degraded / Cooldown).
   - Danh sách chi tiết từng cổng (Port P01, P02...) với thanh tiến trình trực quan, số reqs, số token đã tiêu thụ và nút test ping nhanh cho từng model.

**Phê duyệt:** Chờ @phan-bac đánh giá rủi ro và cấp mã `AUTO_PASS_TOKEN`.
