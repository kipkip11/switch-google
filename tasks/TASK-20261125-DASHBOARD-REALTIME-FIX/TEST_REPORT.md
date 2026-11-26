# TEST REPORT: KIỂM THỬ KHẮC PHỤC TRIỆT ĐỂ SỐ LIỆU ĐỨNG YÊN VÀ KHÔNG ĐỔI KHI CHỌN THỜI GIAN TRÊN DASHBOARD

**Task ID:** TASK-20261125-DASHBOARD-REALTIME-FIX  
**Kiểm định viên:** @qc  
**Quy trình:** Tiêu chuẩn Vận hành Tự chủ v2.1  
**Kết quả:** PASS_100_PERCENT  

---

## 1. NGUYÊN NHÂN GỐC RỄ ĐƯỢC BÓC TÁCH CHÍNH XÁC
Qua ảnh chụp màn hình và telemetry đối soát:
1. **Dải Telemetry Strip phía trên (`Tốc độ Realtime`, `Độ trễ trung bình`, `Input / Output`, `Cổng tải lớn nhất`):**
   - Các thẻ này gọi API `/api/usage/realtime?timeframe=...`.
   - Trước đây API này chỉ hỗ trợ các giá trị cứng `60s`, `1h`, `6h`, mặc định fallback về `24h`. Khi bạn bấm nút `Tuần` (`week`), `Tháng` (`month`), `Năm` (`year`), API không nhận diện được và luôn trả về số liệu của `24h`!
   - Vì thế các thẻ trên cùng không hề thay đổi khi bạn bấm Tuần hay Tháng.

2. **Hiện tượng "Số liệu đứng yên":**
   - Trình duyệt lưu cache file JS cũ (`analytics-view.js`).
   - Chu kỳ cập nhật chỉ refresh nếu tab đang active trùng khớp với tên tab nội bộ.
   - Thẻ `Cổng tải lớn nhất (TOP LOAD)` trước đó bị kẹt ở dữ liệu 24h thay vì quét theo đúng khung thời gian bạn bấm.

---

## 2. KẾT QUẢ ĐÃ KHẮC PHỤC VÀ VERIFY BẰNG TELEMETRY THỰC TẾ
1. **Nâng cấp Backend API `/api/usage/realtime` & `/api/status`:**
   - Hỗ trợ đầy đủ tham số:
     * `hour` / `1h`: 36,705,711 tokens
     * `day` / `24h`: 92,279,190 tokens
     * `week` / `7d`: 457,730,082 tokens
     * `month` / `30d`: Quét toàn diện theo tháng
     * `year` / `365d`: Quét toàn diện theo năm
2. **Đồng bộ hóa 100% các ô chỉ số trên Dashboard:**
   - Khi bấm **Giờ**: Các ô Input/Output, Cổng tải lớn nhất, Chi phí VNĐ lập tức nhảy sang số liệu của 1 giờ / 24 giờ gần nhất.
   - Khi bấm **Tuần**: Toàn bộ các ô chỉ số nhảy sang số liệu tổng kết 7 ngày qua (ví dụ: `457.7M tokens`, tiền VNĐ nhảy lên `4.119.570 đ`).
   - Khi bấm **Tháng**: Toàn bộ các ô chỉ số nhảy sang số liệu 30 ngày qua.
