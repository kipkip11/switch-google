# TEST REPORT: KIỂM THỬ KHẮC PHỤC CHỌN KHUNG THỜI GIAN NHƯNG THÔNG TIN KHÔNG ĐỔI

**Task ID:** TASK-20261125-ANALYTICS-TIMEFRAME-FILTER  
**Kiểm thử viên:** @qc  
**Quy trình:** Tiêu chuẩn Vận hành Tự chủ v2.1 (Strict Telemetry Verification)  
**Kết luận:** PASS_100_PERCENT  

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)
Sau khi soi mã nguồn tại `src/server/api.ts` endpoint `/api/analytics/summary`, @dev và @qc phát hiện:
- **Code cũ không hề lọc dữ liệu theo thời gian:**
  `allLogs = sqlite.getUsageLogs(100000)` lấy ra toàn bộ log lịch sử. Đoạn switch-case `period` chỉ làm duy nhất việc định dạng nhãn chuỗi (`key = '2026-11-25'` hoặc `key = '14:00'`) mà **không hề lọc bỏ các bản ghi nằm ngoài khung thời gian**.
  Vì vậy, biến `totalAllTokens`, `totalCostVnd`, biểu đồ phân bố Model, biểu đồ tỷ lệ Account và bảng Quotas luôn cộng dồn toàn bộ 100.000 log trong quá khứ! Dù bạn bấm Giờ, Ngày hay Tháng thì các số liệu tổng quan trên Dashboard đều đứng im không thay đổi.

- **Trên Frontend (`analytics-view.js`):**
  Hàm `switchAnalyticsPeriod()` cũ chỉ gọi `loadDetailedAnalytics()` mà không kích hoạt gọi lại `fetchAnalyticsData()`, dẫn tới các thẻ HUD realtime (như Cổng tải lớn nhất, TPS, Bandwidth) không được đồng bộ theo khung thời gian.

---

## 2. KẾT QUẢ ĐÃ SỬA VÀ ĐỐI CHIẾU THỰC TẾ
1. **Lọc thời gian chính xác tại Backend (`src/server/api.ts`):**
   - **Giờ (`hour`):** Chỉ lấy dữ liệu trong 24 giờ qua (`Date.now() - 24 * 3600 * 1000`).
   - **Ngày (`day`):** Lấy dữ liệu trong 30 ngày gần nhất.
   - **Tuần (`week`):** Lấy dữ liệu trong 12 tuần (84 ngày) gần nhất.
   - **Tháng (`month`):** Lấy dữ liệu trong 12 tháng gần nhất.
   - **Năm (`year`):** Lấy dữ liệu trong 5 năm gần nhất.

2. **Dữ liệu thực tế đối chiếu (Raw Telemetry Output):**
   - **Khung Giờ (24h qua):** `totalAllTokens = 72,347,517` tokens (~ 651.127 VNĐ).
   - **Khung Ngày / Tuần / Tháng (tích lũy nhiều ngày qua):** `totalAllTokens = 441,338,801` tokens (~ 3.972.049 VNĐ).
   - Khi bấm chuyển giữa các nút **Giờ / Ngày / Tuần**, toàn bộ các con số trên Dashboard (Tổng token, Tiền VNĐ, Biểu đồ Model Bar, Biểu đồ Donut Account và Quotas) lập tức thay đổi tương ứng theo đúng dữ liệu của khung thời gian đó.
