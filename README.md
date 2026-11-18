# Switch Google - Multi-Account Profile, Session & Token Matrix Manager

[![Switch-Google CI/CD Pipeline](https://github.com/kipkip11/switch-google/actions/workflows/ci.yml/badge.svg)](https://github.com/kipkip11/switch-google/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/Phi%C3%AAn%20b%E1%BA%A3n-v1.1.0-blue.svg)](https://github.com/kipkip11/switch-google/releases)
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

## 🚀 Cài Đặt 1 Dòng Lệnh Duy Nhất

### 🪟 Dành Cho Windows (PowerShell)
Mở PowerShell ở bất kỳ thư mục nào và dán đúng 1 dòng lệnh sau:
```powershell
irm https://raw.githubusercontent.com/kipkip11/switch-google/main/install.ps1 | iex
```
> *(Tự động tải mã nguồn, thiết lập lệnh `switch-google` toàn cục vào WindowsApps, kích hoạt chế độ tự chạy ngầm khi bật máy tính và mở ngay Web Dashboard `http://localhost:1909`).*

---

### 🍎 Dành Cho macOS & Linux (Terminal)
Mở Terminal và dán dòng lệnh sau:
```bash
curl -fsSL https://raw.githubusercontent.com/kipkip11/switch-google/main/install.sh | bash
```

---

### 📦 Cài Đặt Toàn Cục Qua NPM (Mọi Hệ Điều Hành)
Nếu máy tính của bạn đã có Node.js:
```bash
npm install -g git+https://github.com/kipkip11/switch-google.git
```
*(Hệ thống đã cấu hình tự động kích hoạt `prepare: npm run build`, sau khi cài đặt bạn có thể gõ trực tiếp lệnh `switch-google` ở bất kỳ thư mục nào trên máy).*

Hoặc khởi chạy tức thì mà không cần cài đặt:
```bash
npx git+https://github.com/kipkip11/switch-google.git serve
```

---

### 🛠️ Cách 3: Cài đặt thủ công từ mã nguồn
```bash
git clone https://github.com/kipkip11/switch-google.git
cd switch-google
npm install
npm run build
npm run serve
```

---

### 🪟 Dành Riêng Cho Windows (PowerShell / One-Click Launcher)
Nếu bạn sử dụng Windows, chỉ cần **click đúp chuột vào file `start.bat`** (hoặc gõ `.\start.ps1` trong PowerShell):
- **[1] ⚡ Chạy ngầm (Ẩn hoàn toàn cửa sổ) + Mở Web + Tự bật khi khởi động máy**
- **[2] 🖥️ Chạy thường có cửa sổ PowerShell (để theo dõi log trực tiếp)**
- **[3] 🌐 Mở nhanh Web Dashboard (`http://localhost:1909`)**
- **[4] 🛑 Dừng tiến trình chạy ngầm**
- **[5] 🔄 Tự động cập nhật hệ thống từ GitHub**
- **[6] ❌ Tắt tính năng tự khởi động cùng Windows**

---

## 🔄 Hướng Dẫn Cập Nhật Phiên Bản Mới (Update)

Mọi dữ liệu tài khoản, tokens và khóa mã hóa đều được lưu độc lập tại `~/.switch-google/`, do đó **việc cập nhật mã nguồn mới hoàn toàn an toàn và không bao giờ làm mất tài khoản hay dữ liệu của bạn**.

### ⚡ Cách 1: Nút Cập Nhật 1-Click trên Web Dashboard (Khuyên dùng)
Khi có tính năng mới trên GitHub, thanh Header trên trang Web Dashboard (`http://localhost:1909`) sẽ tự động xuất hiện nút:  
👉 **`🚀 Cập Nhật Mới (Commit)`**  
Bạn chỉ cần nhấn vào nút đó, hệ thống sẽ tự động tải mã nguồn mới về và build lại trong vài giây.

### 💻 Cách 2: Cập nhật qua Terminal / PowerShell
- **Nếu đã cài đặt toàn cục:**
  ```bash
  switch-google update
  ```
- **Nếu hệ thống báo lệnh không nhận diện (`not recognized`):**  
  Chạy trực tiếp qua NPX:
  ```powershell
  npx git+https://github.com/kipkip11/switch-google.git update
  ```
  Hoặc cài đè bản mới nhất vào hệ thống:
  ```powershell
  npm install -g git+https://github.com/kipkip11/switch-google.git
  ```
- **Trên macOS / Linux:**  
  Chạy lại dòng lệnh cài đặt tự động:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/kipkip11/switch-google/main/install.sh | bash
  ```

### 🪟 Cách 3: Cập nhật trên Windows qua Launcher
Chỉ cần click đúp vào file **`start.bat`** (hoặc gõ `.\start.ps1` trong PowerShell) và chọn số **`[5]`** để hệ thống tự động kiểm tra và nâng cấp.

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

---

## 📜 Lịch Sử Phiên Bản (Changelog)

| Phiên Bản | Ngày | Nội Dung & Tính Năng Mới |
| :--- | :--- | :--- |
| **`v1.1.0` (Mới nhất)** | 18/11/2026 | • Trung tâm điều khiển PowerShell & Windows Launcher (`start.bat`, `start.ps1`)<br>• Chạy ngầm hoàn toàn (Silent Daemon, không hiện cửa sổ)<br>• Tự khởi động cùng hệ điều hành khi bật máy (Windows Startup, macOS LaunchAgent, Linux systemd)<br>• Tự động cập nhật 1-Click trên Web Dashboard & lệnh `switch-google update`<br>• Hiển thị số phiên bản trực quan trên giao diện Web, CLI và README |
| **`v1.0.0`** | 17/11/2026 | • Bản phát hành khởi tạo đầu tiên<br>• Quản lý đa tài khoản Google OAuth 2.0 & Gemini API Key<br>• Mã hóa bảo mật độc lập chuẩn AES-256-GCM<br>• Sơ đồ ma trận mạng Switch Rack RJ45 trực quan thời gian thực<br>• Cơ chế luân phiên tự động chống Rate Limit (429)<br>• Tích hợp CI/CD tự động toàn diện trên GitHub Actions |
