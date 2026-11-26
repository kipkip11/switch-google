# IMPLEMENTATION: TÍCH HỢP TAILSCALE & CLOUDFLARE TUNNEL

**Task ID:** TASK-20261123-REMOTE-TUNNELS  
**Thực hiện:** @dev  
**Trạng thái:** COMPLETED  

---

## 1. CÁC TẬP TIN ĐÃ THAY ĐỔI
1. `src/services/tunnelManager.ts` (MỚI):
   - Quản lý trạng thái Tailscale (đọc IP Tailscale, danh sách máy peer: `Admin-PC`, `admin123-H81M-DS2`, iOS).
   - Quản lý tiến trình `cloudflared` ngầm (spawn `/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:1909`), tự động bắt regex lấy public URL `https://*.trycloudflare.com`.
   - Đăng ký hook dọn dẹp tiến trình khi tắt server (`beforeExit`, `SIGINT`, `SIGTERM`).
2. `src/server/api.ts`:
   - Thêm endpoint `GET /api/network/status`.
   - Thêm endpoint `POST /api/network/cloudflare/toggle`.
3. `public/index.html`:
   - Thêm Card **🌐 Kết Nối Đa Thiết Bị (Tailscale & Cloudflare Tunnel)** trong tab Tích Hợp.
4. `public/js/management-view.js` & `public/js/app.js`:
   - Bổ sung logic fetch trạng thái Tailscale và điều khiển toggle Cloudflare Quick Tunnel 1-Click.

## 2. KẾT QUẢ TỰ KIỂM THỬ (DEV SELF-TEST)
- `npm run build`: Thành công không lỗi TypeScript.
- Khởi động lại service và gọi API `/api/network/status`:
  - Tailscale detected: IP `100.72.75.106` (Active).
- Gọi API bật Cloudflare Tunnel:
  - Sinh ra URL thành công: `https://canyon-larry-starts-msgstr.trycloudflare.com`.
  - Curl test từ ngoài vào endpoint `/api/system/version` trả về 200 OK.
- Gọi API tắt Cloudflare Tunnel: Tiến trình con `cloudflared` được terminate sạch sẽ.
