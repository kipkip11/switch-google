# REVIEW: ĐÁNH GIÁ RỦI RO & BẢO MẬT CHO TAB DỊCH VỤ AI MỞ RỘNG

**Task ID:** TASK-20261122-MULTI-SERVICES  
**Người đánh giá:** @phan-bien  
**Tài liệu rà soát:** `SPEC.md` v1.0  
**Kết luận phản biện:** `APPROVE` (Đồng ý triển khai)

---

## 1. ĐÁNH GIÁ KỸ THUẬT & AN TOÀN DỮ LIỆU

| Mã | Hạng mục | Mức độ | Nhận xét & Yêu cầu kỹ thuật |
|---|---|---|---|
| **REV-01** | **Bỏ RTK Token Saver** | **Thông qua** | Việc loại bỏ RTK hoàn toàn phù hợp với chỉ đạo của User: Đảm bảo độ chính xác tuyệt đối cho các tác vụ lập trình phức tạp (tránh việc tóm tắt hoặc nén làm mất ngữ cảnh của code/git diff). |
| **REV-02** | **Bảo vệ API Key bên ngoài** | **High** | API Key của DeepSeek, GLM, Groq phải được mã hóa lưu trữ trong SQLite cục bộ (sử dụng Master Key có sẵn của ProfileStorage), không lưu plain-text lộ liễu. |
| **REV-03** | **Độ trễ Fallback** | **Medium** | Khi Google 429 chuyển sang Provider khác, phải thiết lập timeout hợp lý (3s - 5s) để tránh treo request của Client (Cursor/Claude Code/Antigravity). |
| **REV-04** | **Tương thích ngược** | **High** | Việc bổ sung tab và router mới tuyệt đối không được phá vỡ tính năng Antigravity Direct Link (Fast-Pipe MITM) và logic xoay tua tài khoản Google hiện có. |

---

## 2. KẾT LUẬN CHO APPROVAL GATE
Thiết kế `SPEC.md` đã được tối ưu hóa, loại bỏ hoàn toàn RTK Token Saver theo đúng yêu cầu, phân tách module sạch sẽ. Đề xuất User phê duyệt để @dev tiến hành code.
