#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const manager_1 = require("./profiles/manager");
const api_1 = require("./server/api");
const daemon_1 = require("./services/daemon");
// Load .env from project directory or current working directory
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.join(__dirname, '..', '.env') });
const program = new commander_1.Command();
const manager = new manager_1.ProfileManager();
const daemon = new daemon_1.DaemonManager();
let appVersion = '1.1.0';
try {
    const pkg = require(path_1.default.join(__dirname, '..', 'package.json'));
    appVersion = pkg.version || '1.1.0';
}
catch (_) {
    try {
        const pkg = require(path_1.default.join(__dirname, '..', '..', 'package.json'));
        appVersion = pkg.version || '1.1.0';
    }
    catch (_) { }
}
program
    .name('switch-google')
    .description('Quản lý đa tài khoản Google, phiên làm việc OAuth2 và cấp API cho bên thứ 3')
    .version(appVersion);
// Command: login
program
    .command('login [profile_name]')
    .description('Đăng nhập thêm tài khoản Google mới (tự động lấy email làm tên nếu không nhập tên)')
    .action(async (profileName) => {
    try {
        console.log(`Đang mở trình duyệt đăng nhập Google OAuth...`);
        const profile = await manager.loginAndSave(profileName);
        console.log(`\n✓ Đã kết nối thành công tài khoản [${profile.name}] (${profile.email})!`);
        console.log(`Phiên đăng nhập đã được lưu trữ an toàn.`);
    }
    catch (err) {
        console.error(`\n✗ Lỗi đăng nhập: ${err.message}`);
        process.exit(1);
    }
});
// Command: add-key
program
    .command('add-key <profile_name> <api_key>')
    .description('Thêm tài khoản trực tiếp bằng Google Gemini API Key (từ Google AI Studio)')
    .option('-e, --email <email>', 'Email định danh tài khoản')
    .action((profileName, apiKey, options) => {
    try {
        const prof = manager.addApiKeyProfile(profileName, apiKey, options.email);
        console.log(`\n✓ Đã thêm tài khoản [${prof.name}] thành công bằng API Key!`);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: add-token
program
    .command('add-token <profile_name> <access_token> [refresh_token]')
    .description('Thêm tài khoản trực tiếp bằng Bearer Access Token / Refresh Token')
    .option('-e, --email <email>', 'Email tài khoản', 'manual@google.com')
    .action((profileName, accessToken, refreshToken, options) => {
    try {
        const prof = manager.addDirectTokenProfile(profileName, options?.email || 'manual@google.com', accessToken, refreshToken);
        console.log(`\n✓ Đã thêm tài khoản [${prof.name}] thành công bằng Token!`);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: add-cookie
program
    .command('add-cookie <profile_name> <cookies>')
    .description('Thêm tài khoản trực tiếp bằng Gemini Web Session Cookies (Dành cho tài khoản bị chặn Antigravity)')
    .option('-e, --email <email>', 'Email định danh tài khoản')
    .action((profileName, cookies, options) => {
    try {
        const prof = manager.addWebSessionProfile(profileName, cookies, options.email);
        console.log(`\n✓ Đã kết nối tài khoản Web [${prof.name}] (${prof.email}) thành công qua Session Cookies!`);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: login-web (Tự động mở trình duyệt lấy Cookie Web Mode)
program
    .command('login-web [profile_name]')
    .description('Đăng nhập Google tự động để kích hoạt Gemini Web Mode (Vượt chặn Antigravity)')
    .action(async (profileName) => {
    try {
        console.log('\n🚀 Đang mở trình duyệt để xác thực tài khoản Google Gemini Web...');
        console.log('Vui lòng đăng nhập tài khoản Google của bạn trên cửa sổ vừa mở.');
        const { autoCaptureGeminiWebSession } = await Promise.resolve().then(() => __importStar(require('./services/webAuthAutomator')));
        const captured = await autoCaptureGeminiWebSession(180000);
        const targetProfile = profileName?.trim() || captured.email;
        const prof = manager.addWebSessionProfile(targetProfile, captured.cookies, captured.email);
        console.log(`\n✓ Đã kích hoạt Gemini Web Mode cho [${prof.name}] (${prof.email}) thành công!`);
        process.exit(0);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: upgrade-web (Chuyển đổi tài khoản OAuth bị chặn sang Web Mode)
program
    .command('upgrade-web <profile_name>')
    .description('Chuyển đổi tài khoản OAuth bị chặn sang Gemini Web Mode để vượt chặn Antigravity')
    .action(async (profileName) => {
    try {
        const raw = manager.getRawProfile(profileName);
        if (!raw) {
            console.error(`\n✗ Lỗi: Profile '${profileName}' không tồn tại.`);
            process.exit(1);
        }
        console.log(`\n🚀 Đang mở trình duyệt để chuyển tài khoản [${profileName}] (${raw.email}) sang Gemini Web Mode...`);
        const { autoCaptureGeminiWebSession } = await Promise.resolve().then(() => __importStar(require('./services/webAuthAutomator')));
        const captured = await autoCaptureGeminiWebSession(180000, raw.email);
        const prof = manager.upgradeOauthToWebSession(profileName, captured.cookies, captured.email);
        console.log(`\n✓ Đã nâng cấp tài khoản [${prof.name}] sang Gemini Web Mode thành công!`);
        process.exit(0);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: list
program
    .command('list')
    .alias('ls')
    .description('Liệt kê danh sách các tài khoản Google đã kết nối')
    .action(() => {
    try {
        const profiles = manager.listProfiles();
        if (profiles.length === 0) {
            console.log('\nChưa có tài khoản nào được kết nối.');
            console.log('Chạy lệnh sau để kết nối tài khoản đầu tiên:');
            console.log('  switch-google login <tên_profile>\n');
            return;
        }
        console.log('\nDanh sách tài khoản Google đã kết nối:\n');
        console.log('  ' +
            'ACTIVE'.padEnd(8) +
            'PROFILE'.padEnd(18) +
            'TYPE'.padEnd(12) +
            'EMAIL'.padEnd(28) +
            'HẾT HẠN TOKEN'.padEnd(25) +
            'TRẠNG THÁI');
        console.log('  ' + '-'.repeat(105));
        for (const p of profiles) {
            const marker = p.isActive ? '  *   ' : '      ';
            let status = p.isExpired ? 'Hết hạn (Sẽ tự refresh)' : 'Hoạt động';
            if (p.isBlockedAntigravity && p.type === 'oauth') {
                status = '⚠️ Bị chặn Antigravity (Cần Web Mode)';
            }
            console.log(marker +
                p.name.padEnd(18) +
                p.type.toUpperCase().padEnd(12) +
                p.email.padEnd(28) +
                p.expiresAt.padEnd(25) +
                status);
        }
        console.log('\n(*) Đang là tài khoản Active mặc định.');
    }
    catch (err) {
        console.error(`Lỗi: ${err.message}`);
    }
});
// Command: use
program
    .command('use <profile_name>')
    .description('Chuyển đổi tài khoản đang hoạt động mặc định')
    .action((profileName) => {
    try {
        manager.setActiveProfile(profileName);
        console.log(`\n✓ Đã chuyển tài khoản active sang: [${profileName}]`);
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: token
program
    .command('token [profile_name]')
    .description('Lấy Access Token hiện tại (tự động làm mới nếu token hết hạn)')
    .option('-r, --raw', 'Chỉ in ra token thuần để truyền vào script')
    .action(async (profileName, options) => {
    try {
        const tokenInfo = profileName
            ? await manager.getTokenForProfile(profileName)
            : await manager.getActiveToken();
        if (options.raw) {
            process.stdout.write(tokenInfo.access_token);
        }
        else {
            console.log(`\n[Profile: ${tokenInfo.profile}] - [Email: ${tokenInfo.email}]`);
            console.log(`Access Token:\n${tokenInfo.access_token}`);
            if (tokenInfo.expiry_date) {
                console.log(`\nHết hạn vào: ${new Date(tokenInfo.expiry_date).toLocaleString()}`);
            }
        }
    }
    catch (err) {
        console.error(`\n✗ Lỗi lấy token: ${err.message}`);
        process.exit(1);
    }
});
// Command: delete
program
    .command('delete <profile_name>')
    .alias('rm')
    .description('Xóa một tài khoản khỏi danh sách')
    .action((profileName) => {
    try {
        const success = manager.deleteProfile(profileName);
        if (success) {
            console.log(`\n✓ Đã xóa profile [${profileName}].`);
        }
        else {
            console.log(`\nProfile [${profileName}] không tồn tại.`);
        }
    }
    catch (err) {
        console.error(`\n✗ Lỗi: ${err.message}`);
        process.exit(1);
    }
});
// Command: import-antigravity
program
    .command('import-antigravity')
    .description('Tự động nhập tài khoản Antigravity đang hoạt động từ macOS Keychain')
    .action(() => {
    const prof = manager.importAntigravityKeychainSession();
    if (prof) {
        console.log(`\n✓ Đã kết nối thành công phiên Antigravity: ${prof.name}`);
    }
    else {
        console.log(`\nKhông tìm thấy phiên Antigravity trong Keychain hoặc hệ thống không hỗ trợ.`);
    }
});
// Command: serve
program
    .command('serve')
    .description('Khởi chạy Web Dashboard & API Server để bên thứ 3 có thể lấy token hoặc switch tài khoản')
    .option('-p, --port <number>', 'Cổng Web Server', '1909')
    .action((options) => {
    manager.importAntigravityKeychainSession();
    const port = parseInt(options.port, 10) || 1909;
    (0, api_1.startApiServer)(port);
});
// Command: daemon
program
    .command('daemon <action>')
    .description('Quản lý tiến trình chạy ngầm & tự khởi động cùng máy tính: start | stop | status | enable | disable')
    .option('-p, --port <number>', 'Cổng Web Server', '1909')
    .action(async (action, options) => {
    const port = parseInt(options.port, 10) || 1909;
    switch (action.toLowerCase()) {
        case 'start': {
            const res = daemon.startDaemon(port);
            console.log(`\n${res.success ? '✓' : '✗'} ${res.message}`);
            if (res.success) {
                console.log(`Đang mở trình duyệt tới http://localhost:${port}...`);
                try {
                    const openPkg = await eval('import("open")');
                    await openPkg.default(`http://localhost:${port}`);
                }
                catch (_) { }
            }
            break;
        }
        case 'stop': {
            const res = daemon.stopDaemon();
            console.log(`\n${res.success ? '✓' : '✗'} ${res.message}`);
            break;
        }
        case 'status': {
            const status = daemon.getStatus(port);
            console.log(`\n======================================================`);
            console.log(`  TRẠNG THÁI TIẾN TRÌNH NGẦM (DAEMON STATUS)`);
            console.log(`======================================================`);
            console.log(`  Trạng thái:            ${status.isRunning ? '🟢 ĐANG CHẠY' : '⚪ ĐANG DỪNG'}`);
            if (status.pid) {
                console.log(`  Mã tiến trình (PID):   ${status.pid}`);
                console.log(`  URL Web Dashboard:     http://localhost:${status.port}`);
            }
            console.log(`  Tự bật khi mở máy:     ${status.autoStartEnabled ? '✅ ĐÃ BẬT' : '❌ CHƯA BẬT'}`);
            console.log(`  File nhật ký (Log):    ${status.logFile}`);
            console.log(`======================================================\n`);
            break;
        }
        case 'enable': {
            const res = daemon.enableAutoStart(port);
            console.log(`\n${res.success ? '✓' : '✗'} ${res.message}`);
            break;
        }
        case 'disable': {
            const res = daemon.disableAutoStart();
            console.log(`\n${res.success ? '✓' : '✗'} ${res.message}`);
            break;
        }
        default:
            console.log(`\nHành động không hợp lệ: "${action}". Vui lòng dùng một trong các lệnh:`);
            console.log(`  switch-google daemon start   # Khởi chạy ngầm và mở Web`);
            console.log(`  switch-google daemon stop    # Dừng tiến trình ngầm`);
            console.log(`  switch-google daemon status  # Xem trạng thái daemon`);
            console.log(`  switch-google daemon enable  # Bật tự khởi động cùng máy tính`);
            console.log(`  switch-google daemon disable # Tắt tự khởi động cùng máy tính\n`);
    }
});
// Command: update
program
    .command('update')
    .alias('upgrade')
    .description('Kiểm tra và tự động cập nhật Switch Google lên bản mới nhất từ GitHub')
    .action(async () => {
    console.log(`\nĐang kiểm tra phiên bản mới nhất từ GitHub...`);
    const check = await daemon.checkGithubUpdates();
    console.log(`Phiên bản hiện tại: ${check.currentVersion} (Commit: ${check.currentCommit})`);
    console.log(`Bản mới nhất trên GitHub: Commit ${check.latestCommit || 'N/A'}`);
    if (check.latestMessage) {
        console.log(`Nội dung mới: "${check.latestMessage}"`);
    }
    if (!check.hasUpdate) {
        console.log(`\n✓ Bạn đang sử dụng phiên bản mới nhất!`);
        return;
    }
    console.log(`\n⏳ Phát hiện bản cập nhật mới! Đang tiến hành tải và build tự động...`);
    const updateResult = daemon.performSelfUpdate();
    if (updateResult.success) {
        console.log(`\n✓ ${updateResult.message}`);
        console.log(`Nếu bạn đang chạy daemon ngầm, hãy gõ "switch-google daemon stop && switch-google daemon start" để áp dụng.`);
    }
    else {
        console.error(`\n✗ ${updateResult.message}`);
    }
});
program.parse(process.argv);
