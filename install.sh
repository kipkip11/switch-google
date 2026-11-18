#!/usr/bin/env bash
# ==============================================================================
# Script Cài Đặt Tự Động Switch Google CLI
# https://github.com/kipkip11/switch-google
# ==============================================================================

set -e

# Màu sắc thông báo
C_RESET='\033[0m'
C_CYAN='\033[1;36m'
C_GREEN='\033[1;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[1;31m'
C_BOLD='\033[1m'

echo -e "${C_CYAN}"
echo "============================================================"
echo "    🚀 CÀI ĐẶT SWITCH GOOGLE - MULTI-ACCOUNT TOKEN MANAGER  "
echo "============================================================"
echo -e "${C_RESET}"

# 1. Kiểm tra môi trường Node.js
if ! command -v node >/dev/null 2>&1; then
    echo -e "${C_RED}✗ Lỗi: Chưa tìm thấy Node.js trên hệ thống!${C_RESET}"
    echo -e "Vui lòng cài đặt Node.js (phiên bản 18 trở lên) từ https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${C_YELLOW}⚠ Cảnh báo: Phiên bản Node.js hiện tại là $(node -v). Khuyến nghị Node.js >= 18.${C_RESET}"
fi

# 2. Kiểm tra Git
if ! command -v git >/dev/null 2>&1; then
    echo -e "${C_RED}✗ Lỗi: Chưa tìm thấy Git trên hệ thống!${C_RESET}"
    echo -e "Vui lòng cài đặt Git trước khi tiếp tục."
    exit 1
fi

# 3. Kiểm tra npm
if ! command -v npm >/dev/null 2>&1; then
    echo -e "${C_RED}✗ Lỗi: Chưa tìm thấy NPM trên hệ thống!${C_RESET}"
    exit 1
fi

echo -e "${C_CYAN}ℹ Kiểm tra môi trường: Node.js $(node -v), NPM $(npm -v), Git $(git --version | awk '{print $3}')${C_RESET}"
echo -e "${C_BOLD}⏳ Đang tiến hành cài đặt Switch Google CLI toàn cục qua NPM...${C_RESET}"

REPO_URL="git+https://github.com/kipkip11/switch-google.git"
INSTALL_SUCCESS=0

# Thử cài đặt trực tiếp qua npm install -g
if npm install -g "$REPO_URL" 2>/tmp/switch-google-npm-err.log; then
    INSTALL_SUCCESS=1
else
    echo -e "${C_YELLOW}⚠ Cài đặt qua global npm cần phân quyền hoặc gặp sự cố. Đang chuyển sang phương thức dự phòng (Local Core)...${C_RESET}"
fi

# Nếu npm install -g gặp lỗi phân quyền, chuyển sang cài đặt vào ~/.switch-google/core
if [ "$INSTALL_SUCCESS" -ne 1 ]; then
    INSTALL_DIR="$HOME/.switch-google/core"
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"

    echo -e "${C_CYAN}ℹ Đang cài đặt mã nguồn vào: $INSTALL_DIR${C_RESET}"
    if [ -d "$INSTALL_DIR/.git" ]; then
        cd "$INSTALL_DIR"
        git fetch origin main
        git reset --hard origin/main
    else
        rm -rf "$INSTALL_DIR"
        git clone "https://github.com/kipkip11/switch-google.git" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    echo -e "${C_BOLD}⏳ Đang cài đặt thư viện và build mã nguồn TypeScript...${C_RESET}"
    npm install
    npm run build

    # Tạo symlink vào ~/.local/bin/switch-google
    ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/switch-google"
    chmod +x "$INSTALL_DIR/dist/cli.js"

    # Thêm BIN_DIR vào PATH nếu chưa có
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        SHELL_RC=""
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi

        if [ -n "$SHELL_RC" ] && ! grep -q "$BIN_DIR" "$SHELL_RC"; then
            echo -e "\nexport PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
            echo -e "${C_YELLOW}ℹ Đã tự động thêm $BIN_DIR vào $SHELL_RC${C_RESET}"
        fi
        export PATH="$BIN_DIR:$PATH"
    fi
fi

echo ""
echo -e "${C_GREEN}============================================================${C_RESET}"
echo -e "${C_GREEN}🎉 CÀI ĐẶT SWITCH GOOGLE HOÀN TẤT THÀNH CÔNG!${C_RESET}"
echo -e "${C_GREEN}============================================================${C_RESET}"
echo ""
echo -e "${C_BOLD}📖 HƯỚNG DẪN KHỞI CHẠY:${C_RESET}"
echo -e "  1. Khởi chạy Web Dashboard & API Server:"
echo -e "     ${C_CYAN}switch-google serve${C_RESET} (hoặc mở ${C_CYAN}http://localhost:1909${C_RESET})"
echo ""
echo -e "  2. Đăng nhập thêm tài khoản Google:"
echo -e "     ${C_CYAN}switch-google login [tên_tài_khoản]${C_RESET}"
echo ""
echo -e "  3. Liệt kê danh sách tài khoản đã kết nối:"
echo -e "     ${C_CYAN}switch-google list${C_RESET}"
echo ""
echo -e "  4. Xem trợ giúp các lệnh:"
echo -e "     ${C_CYAN}switch-google --help${C_RESET}"
echo ""
