# SPEC: TÍCH HỢP KẾT NỐI MẠNG ĐA MÁY QUA TAILSCALE & CLOUDFLARE TUNNEL

**Task ID:** TASK-20261123-REMOTE-TUNNELS  
**Tác giả:** @phan-tich  
**Trạng thái:** DRAFT / PENDING_REVIEW  
**Phiên bản:** 1.0  

---

## 1. MỤC TIÊU & BỐI CẢNH
- Người dùng muốn chia sẻ kết nối `switch-google` (OpenAI Gateway cổng 1909 và Web Dashboard) cho nhiều máy tính khác nhau (Windows, Linux, macOS, iOS).
- Hai giải pháp mạng hàng đầu hiện có sẵn trên máy:
  1. **Tailscale (Mesh VPN):**
     - Đã cài đặt (`/usr/local/bin/tailscale`), máy hiện có IP ảo Tailscale `100.72.75.106`.
     - Kết nối P2P mã hóa WireGuard an toàn tuyệt đối giữa các máy trong tailnet (`admin-pc`, `admin-pc-1`, `admin123-h81m-ds2`).
  2. **Cloudflare Tunnel (`cloudflared`):**
     - Đã cài đặt (`cloudflared version 2026.11.1`).
     - Cho phép mở cổng `1909` ra Internet an toàn qua Quick Tunnel miễn phí (`trycloudflare.com` - không cần domain riêng hoặc thẻ tín dụng) hoặc Named Tunnel có token.

---

## 2. THIẾT KẾ KIẾN TRÚC & TÍNH NĂNG
1. **Module Quản lý Tunnel (`src/services/tunnelManager.ts`):**
   - **Tailscale Detection & Status:**
     - Tự động phát hiện IP Tailscale của máy (`tailscale ip -4` -> `100.72.75.106`).
     - Liệt kê các máy tính cùng mạng (Peers) đang kết nối để người dùng dễ dàng copy link chia sẻ.
   - **Cloudflare Tunnel Process Controller:**
     - Hỗ trợ khởi chạy Quick Tunnel ngầm: `cloudflared tunnel --url http://localhost:1909`.
     - Phân tích log lấy URL công khai dạng `https://*.trycloudflare.com`.
     - Hỗ trợ dừng/bật tunnel theo yêu cầu.
2. **API Endpoints (`src/server/api.ts`):**
   - `GET /api/network/status`: Trả về IP LAN, IP Tailscale, danh sách máy trong Tailscale, trạng thái Cloudflare Tunnel và public URL.
   - `POST /api/network/cloudflare/toggle`: Bật/Tắt Cloudflare Quick Tunnel.
3. **Giao diện Web Dashboard (`public/index.html` & `public/js/`):**
   - Bổ sung Card **"Kết Nối Đa Thiết Bị (Tailscale & Cloudflare Tunnel)"** trong Tab *Tích Hợp & Direct Link* (hoặc Tab *Hệ Thống*):
     - Hiển thị địa chỉ kết nối nội bộ Tailscale: `http://100.72.75.106:1909/v1` (an toàn, chỉ các máy trong tài khoản truy cập được).
     - Công tắc 1-Click để bật Cloudflare Tunnel kèm link public HTTPS được cấp tức thì.
     - Nút copy cấu hình cho Cursor, Antigravity IDE trên máy Windows khác trong mạng.

---

## 3. ACCEPTANCE CRITERIA (AC)
- **AC-1:** Dashboard hiển thị chính xác IP Tailscale và trạng thái mạng của thiết bị.
- **AC-2:** Bấm bật Cloudflare Tunnel thì tiến trình `cloudflared` được khởi chạy, parse thành công public URL `*.trycloudflare.com` và hiển thị trên UI.
- **AC-3:** Khi tắt tunnel, tiến trình `cloudflared` được tắt sạch sẽ (không bị kẹt tiến trình mồ côi).
- **AC-4:** Các máy khác truy cập được Gateway `http://100.72.75.106:1909/v1` qua Tailscale hoặc URL Cloudflare.
