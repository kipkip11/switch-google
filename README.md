# Switch Google - Multi-Account Profile, Session & Token Matrix Manager

[![Switch-Google CI/CD Pipeline](https://github.com/kipkip11/switch-google/actions/workflows/ci.yml/badge.svg)](https://github.com/kipkip11/switch-google/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-20.x%20%7C%2022.x-green.svg)](https://nodejs.org/)

Hệ thống điều phối và cân bằng tải đa tài khoản Google OAuth 2.0 / Gemini API, tự động luân phiên (Round-Robin, Fallback, Fixed) chống Rate Limit (429), sơ đồ ma trận Switch Rack trực quan thời gian thực, giám sát Token Usage chuyên sâu và tích hợp CI/CD tự động toàn diện.

---

## 🌟 Tính Năng Chính
1. **Lưu trữ phiên an toàn (Encrypted Storage):** Refresh Token và Access Token được mã hóa chuẩn **AES-256-GCM** và lưu trữ độc lập tại `~/.switch-google/`.
2. **Tự động làm mới Token (Auto-refresh):** Khi Access Token hết hạn, hệ thống tự động sử dụng Refresh Token để lấy token mới mà không cần đăng nhập lại trình duyệt.
3. **Cân bằng tải & Luân phiên thông minh:** Hỗ trợ 3 chiến lược luân phiên `round-robin`, `fallback` và `fixed`. Tự động cooldown 60s khi gặp 429 Rate Limit và tự loại trừ tài khoản bị lỗi.
4. **Sơ đồ ma trận Switch Rack (Live Account-to-AI Matrix):** Mô phỏng switch mạng phần cứng với đèn LED link status, luồng tín hiệu laser và routing trực tiếp tới Google AI.
5. **Giám sát Token Usage & Analytics:** Biểu đồ thời gian thực (Prompt Tokens, Completion Tokens, Latency) và lịch sử gọi API chi tiết.
6. **Sao lưu & Phục hồi (Backup & Restore):** Hỗ trợ xuất và nhập toàn bộ profile, Virtual API Keys, và cấu hình dưới dạng tệp JSON mã hóa an toàn.
7. **Tương thích hoàn toàn OpenAI/Gemini Format:** Cung cấp `/v1/chat/completions` và `/v1/models` giúp kết nối ngay lập tức với Cursor, Cline, Roo Code, Hermes, hoặc bất kỳ AI Agent nào.

---

## 🚀 Cài Đặt & Cấu Hình

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Thiết lập cấu hình `.env`
Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```
Điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` của bạn vào file `.env` (hoặc sử dụng cấu hình mặc định sẵn có của Antigravity).

### 3. Build dự án
```bash
npm run build
```

---

## 📖 Hướng Dẫn Sử Dụng (CLI)

### 1. Đăng nhập và thêm tài khoản
```bash
npx ts-node src/cli.ts login work-account
# hoặc sau khi build:
# node dist/cli.js login work-account
```

### 2. Liệt kê danh sách tài khoản đã lưu
```bash
npx ts-node src/cli.ts list
```

### 3. Chuyển đổi tài khoản mặc định (Active)
```bash
npx ts-node src/cli.ts use work-account
```

### 4. Lấy Access Token
```bash
# Lấy token của tài khoản đang active
npx ts-node src/cli.ts token

# Lấy token dạng raw để truyền vào biến môi trường / curl:
export TOKEN=$(npx ts-node src/cli.ts token -r)
```

---

## 🌐 Khởi Chạy Web Dashboard & API Server

Chạy lệnh:
```bash
npm run serve
# hoặc
node dist/cli.js serve -p 1909
```

Mở trình duyệt truy cập:
👉 **`http://localhost:1909`**

---

## 🧪 Kiểm Thử & CI/CD Pipeline

Dự án được bảo vệ bởi pipeline CI/CD tự động trên GitHub Actions:
- **TypeScript Static Verification:** `npm run type-check`
- **Unit Testing & Coverage:** `npm test -- --coverage`
- **Production Build:** `npm run build`
- **Security Audit:** Quét lỗ hổng bảo mật tự động trên môi trường Node.js 20 & 22.

Chạy kiểm thử cục bộ:
```bash
npm run type-check   # Kiểm tra kiểu TypeScript
npm test             # Chạy toàn bộ test suites
npm run build        # Biên dịch sang thư mục dist/
```
