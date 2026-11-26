# REVIEW: ĐÁNH GIÁ RỦI RO & BẢO MẬT CHO TÍNH NĂNG TAILSCALE & CLOUDFLARE TUNNEL

**Task ID:** TASK-20261123-REMOTE-TUNNELS  
**Người đánh giá:** @phan-bien  
**Tài liệu rà soát:** `SPEC.md` v1.0  
**Kết luận phản biện:** `APPROVE_WITH_CONDITIONS` (Đồng ý triển khai với 3 điều kiện an toàn)

---

## 1. ĐÁNH GIÁ RỦI RO & BẢO MẬT

| Mã | Hạng mục | Mức độ | Rủi ro | Giải pháp bắt buộc |
|---|---|---|---|---|
| **REV-NET-01** | **Rò rỉ khi mở Cloudflare Public URL** | **Critical** | Khi mở Cloudflare Quick Tunnel ra Internet, bất kỳ ai có link URL `*.trycloudflare.com` đều có thể gọi vào Gateway để xài chùa API hoặc xem Dashboard. | Bắt buộc kiểm tra **Virtual API Key** đối với các request đi qua Cloudflare Tunnel (`/v1/*`), hoặc chỉ cho phép truy cập Dashboard khi có bảo vệ mật khẩu/auth. |
| **REV-NET-02** | **Ưu tiên mạng Tailscale** | **Low (Khuyến nghị)** | Tailscale sử dụng mạng riêng ảo mã hóa WireGuard, chỉ những máy tính trong cùng tài khoản của User (`hoangquoc19972000@`) mới nhìn thấy nhau -> Cực kỳ an toàn, không sợ rò rỉ ra Internet. | Khuyến khích đặt Tailscale làm phương thức kết nối chính (Primary), Cloudflare Tunnel làm tùy chọn bật tắt theo phiên (On-demand). |
| **REV-NET-03** | **Quản lý Process `cloudflared`** | **Medium** | Nếu switch-google bị tắt hoặc restart mà không dọn tiến trình `cloudflared`, sẽ sinh ra zombie process chiếm tài nguyên. | Đăng ký hook `SIGTERM/SIGINT` và `beforeExit` để tự động kill tiến trình con `cloudflared`. |

---

## 2. KẾT LUẬN CHO APPROVAL GATE
Thiết kế `SPEC.md` rất thực tế vì trên máy Mac của User đã có sẵn cả `tailscale` và `cloudflared`. Đề xuất User phê duyệt để @dev bắt đầu thực hiện theo kế hoạch.
