# SPEC — TASK-20261126-SPLIT-MULTI-DEVICE-TAB
**Task ID:** TASK-20261126-SPLIT-MULTI-DEVICE-TAB  
**Mục tiêu:** Tách card "Kết Nối Đa Thiết Bị (Tailscale & Cloudflare Tunnel)" từ tab "Tích Hợp & Direct Link" thành một tab độc lập riêng biệt trên thanh điều hướng bên trái (App Rail) và Command Palette.  
**Trạng thái phê duyệt:** Chờ @phan-bac đánh giá và cấp `AUTO_PASS_TOKEN`.

---

## 1. Phân rã cấu trúc & Kế hoạch UI/UX
1. **Thanh Điều Hướng Bên Trái (App Rail trong `public/index.html`)**:
   - Thêm tab mới `data-tab="tunnels"` với nhãn **"Kết Nối Đa Thiết Bị"** và icon mạng lưới mạng/tunnel (`🌐`).
   - Đặt ngay cạnh tab "Tích Hợp & Direct Link".
2. **Khu vực hiển thị Pane (`pane-tunnels`)**:
   - Di chuyển toàn bộ khối Card **Kết Nối Đa Thiết Bị (Tailscale & Cloudflare Tunnel)** (bao gồm trạng thái Tailscale IP, nút Copy Tailscale, Toggle Cloudflare Quick Tunnel, Public URL box) sang section riêng: `<section class="view-pane" id="pane-tunnels" role="tabpanel">`.
   - Giữ tab `pane-integration` tập trung thuần túy vào **Mitm Fast-Pipe (Port 443/8443 Direct Link)** và **Hướng dẫn cấu hình các IDE (Antigravity, Cursor, Cline, cURL)**.
3. **Bộ điều hướng & Khởi tạo (JavaScript trong `public/js/app.js` & `public/js/network-view.js`)**:
   - Bổ sung `tunnels: 'Kết Nối Đa Thiết Bị (Tailscale & Cloudflare)'` vào `TAB_TITLES`.
   - Trong `window.navigateTab('tunnels')`, kích hoạt gọi `window.fetchNetworkStatus?.()`.
   - Bổ sung lệnh `Chuyển đến: Kết Nối Đa Thiết Bị` vào bảng lệnh nhanh `Cmd+K`.
