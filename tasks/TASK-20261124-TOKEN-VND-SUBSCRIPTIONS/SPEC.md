# SPEC: BỔ SUNG GIÁ TOKEN QUY ĐỔI TIỀN VNĐ VÀ TAB GÓI ĐĂNG KÝ / THỜI HẠN TÀI KHOẢN

**Task ID:** TASK-20261124-TOKEN-VND-SUBSCRIPTIONS  
**Tác giả:** @phan-tich  
**Trạng thái:** APPROVED_AUTONOMOUS (Theo quy trình v2.1)  
**Tiêu chuẩn:** Full Autonomous Execution Engine v2.1  

---

## 1. MỤC TIÊU & BỐI CẢNH
Người dùng yêu cầu 2 tính năng quan trọng trong giao diện quản trị `switch-google`:
1. **Hiển thị giá token đã dùng bằng tiền Việt Nam Đồng (VNĐ):**
   - Tại màn hình **Switch & Định Tuyến** (cả trên 4-Card Telemetry Strip, SFP+ Fiber Uplink, và trên từng cổng Switch RJ45), người dùng cần nhìn thấy ngay giá trị tiền VNĐ tương ứng với số token đã tiêu thụ (ví dụ: `2.4M tok ~ 32.400 đ`).
   - Tỷ giá chuẩn: Google Gemini 1.5/2.5/3.8 Flash trung bình $0.15 / 1M input tokens + $0.60 / 1M output tokens (trung bình ~ $0.35/1M token ≈ 9.000 VNĐ / 1M token; tỷ giá USD/VND ~ 25.500).
   - Cho phép người dùng tùy chỉnh tỷ giá hoặc đơn giá nếu muốn trong cài đặt.
2. **Bổ sung Tab "Gói Đăng Ký & Thời Hạn" (Subscriptions & Plan Expiry):**
   - Tạo thêm 1 tab riêng biệt trên Rail Navigation bên trái: **Gói & Thời Hạn** (`subscriptions`).
   - Hiển thị danh sách toàn bộ tài khoản Google trong hệ thống kèm theo:
     + Loại tài khoản (Google Workspace / Google One AI Premium / Google Cloud Free Tier / Web Session Cookie).
     + Gói dịch vụ (Free Tier, AI Premium 2TB, Advanced Ultra).
     + Thời hạn gói / Ngày hết hạn token (`expiresAt`).
     + Trạng thái còn hạn (Đang hoạt động, Sắp hết hạn, Đã hết hạn).
     + Nút sửa nhanh / cập nhật gói và gia hạn ngày hết hạn trực tiếp trên giao diện và lưu vào SQLite.

---

## 2. THIẾT KẾ KỸ THUẬT & CODEBASE IMPACT
1. **Database SQLite (`sqliteStorage.ts`):**
   - Bổ sung các cột vào bảng `profiles` nếu chưa có (hoặc lưu trong cột mở rộng / metadata JSON):
     - `plan_tier`: Gói đăng ký (ví dụ: `AI Premium (Claude/Gemini Pro)`, `Google Workspace Enterprise`, `Google AI Studio Free`).
     - `plan_expires_at`: Ngày hết hạn gói dịch vụ (timestamp hoặc chuỗi `YYYY-MM-DD`).
     - `custom_vnd_rate`: (Tùy chọn) Đơn giá VNĐ trên 1M token.
2. **Backend API (`api.ts` & `rotator.ts`):**
   - Cung cấp API `GET /api/subscriptions` & `POST /api/subscriptions/:name` để xem và cập nhật gói/thời hạn cho từng profile.
   - Thêm trường `costVnd` tính toán tự động trong `getPortStatuses()` và telemetry uplink (`/api/ports`, `/api/telemetry`).
3. **Frontend UI (`index.html`, `switch-view.js`, `subscriptions-view.js`):**
   - Tại `index.html`: Thêm nút Rail Tab "Gói & Thời Hạn", thêm `<section class="view-pane" id="pane-subscriptions">`.
   - Tại `switch-view.js`:
     + Card Lưu Lượng Gateway: Hiển thị Tổng Token kèm dòng phụ `~ X.XXX VNĐ`.
     + SFP+ Uplink: Hiển thị thêm số tiền VNĐ tương ứng.
     + Mỗi nút Cổng Switch RJ45: Thêm giá trị tiền VNĐ nhỏ gọn dưới số token (`${fmt(p.totalTokens)} · ${fmtVnd(cost)}`).
   - Viết module mới `public/js/subscriptions-view.js` hiển thị bảng các tài khoản dạng thẻ hiện đại, có badge màu theo hạn sử dụng và form cập nhật gói tức thì.

---

## 3. MACHINE ACCEPTANCE CRITERIA (MAC)
- **MAC-1:** `GET /api/ports` trả về trường `costVnd` và `planTier` cho từng tài khoản.
- **MAC-2:** Giao diện Switch hiển thị số tiền VNĐ ở Telemetry Strip, SFP+ và từng Port RJ45.
- **MAC-3:** Có Tab "Gói & Thời Hạn", hiển thị bảng danh sách các tài khoản với ngày hết hạn và gói dịch vụ.
- **MAC-4:** Cập nhật thông tin gói thành công qua API và lưu bền vững vào SQLite.
