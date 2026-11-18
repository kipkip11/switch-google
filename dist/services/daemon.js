"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const https_1 = __importDefault(require("https"));
class DaemonManager {
    baseDir;
    pidFile;
    logFile;
    appRoot;
    constructor() {
        this.baseDir = path_1.default.join(os_1.default.homedir(), '.switch-google');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
        }
        this.pidFile = path_1.default.join(this.baseDir, 'daemon.pid');
        this.logFile = path_1.default.join(this.baseDir, 'daemon.log');
        // App root points to the package root where package.json lives
        this.appRoot = path_1.default.resolve(__dirname, '../..');
    }
    getPid() {
        try {
            if (fs_1.default.existsSync(this.pidFile)) {
                const pid = parseInt(fs_1.default.readFileSync(this.pidFile, 'utf8').trim(), 10);
                if (!isNaN(pid) && this.isProcessAlive(pid)) {
                    return pid;
                }
            }
        }
        catch (_) { }
        return null;
    }
    isProcessAlive(pid) {
        try {
            // Sending signal 0 tests if process exists
            process.kill(pid, 0);
            return true;
        }
        catch (_) {
            return false;
        }
    }
    isAutoStartEnabled() {
        const platform = process.platform;
        if (platform === 'win32') {
            const startupDir = path_1.default.join(process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            return fs_1.default.existsSync(path_1.default.join(startupDir, 'switch-google-daemon.vbs'));
        }
        else if (platform === 'darwin') {
            const plistPath = path_1.default.join(os_1.default.homedir(), 'Library', 'LaunchAgents', 'com.switchgoogle.daemon.plist');
            return fs_1.default.existsSync(plistPath);
        }
        else {
            const servicePath = path_1.default.join(os_1.default.homedir(), '.config', 'systemd', 'user', 'switch-google.service');
            return fs_1.default.existsSync(servicePath);
        }
    }
    enableAutoStart(port = 1909) {
        const platform = process.platform;
        const nodeBin = process.execPath;
        const cliScript = path_1.default.join(this.appRoot, 'dist', 'cli.js');
        try {
            if (platform === 'win32') {
                const startupDir = path_1.default.join(process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
                fs_1.default.mkdirSync(startupDir, { recursive: true });
                const vbsPath = path_1.default.join(startupDir, 'switch-google-daemon.vbs');
                // VBScript hides window completely (0 = vbHide) and opens browser to port
                const vbsContent = [
                    'Set WshShell = CreateObject("WScript.Shell")',
                    `WshShell.Run """${nodeBin}"" """${cliScript}""" serve -p ${port}", 0, False`,
                    'WScript.Sleep 1500',
                    `WshShell.Run "http://localhost:${port}"`
                ].join('\r\n');
                fs_1.default.writeFileSync(vbsPath, vbsContent, 'utf8');
                return { success: true, message: `Đã kích hoạt tự khởi động ngầm cùng Windows tại: ${vbsPath}` };
            }
            else if (platform === 'darwin') {
                const agentsDir = path_1.default.join(os_1.default.homedir(), 'Library', 'LaunchAgents');
                fs_1.default.mkdirSync(agentsDir, { recursive: true });
                const plistPath = path_1.default.join(agentsDir, 'com.switchgoogle.daemon.plist');
                const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.switchgoogle.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${cliScript}</string>
        <string>serve</string>
        <string>-p</string>
        <string>${port}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${this.logFile}</string>
    <key>StandardErrorPath</key>
    <string>${this.logFile}</string>
</dict>
</plist>`;
                fs_1.default.writeFileSync(plistPath, plistContent, 'utf8');
                try {
                    (0, child_process_1.execSync)(`launchctl load "${plistPath}"`, { stdio: 'ignore' });
                }
                catch (_) { }
                return { success: true, message: `Đã kích hoạt tự khởi động cùng macOS qua LaunchAgent: ${plistPath}` };
            }
            else {
                const systemdDir = path_1.default.join(os_1.default.homedir(), '.config', 'systemd', 'user');
                fs_1.default.mkdirSync(systemdDir, { recursive: true });
                const servicePath = path_1.default.join(systemdDir, 'switch-google.service');
                const serviceContent = `[Unit]
Description=Switch Google Multi-Account Local Token Server
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${cliScript} serve -p ${port}
Restart=always
RestartSec=5
StandardOutput=append:${this.logFile}
StandardError=append:${this.logFile}

[Install]
WantedBy=default.target`;
                fs_1.default.writeFileSync(servicePath, serviceContent, 'utf8');
                try {
                    (0, child_process_1.execSync)('systemctl --user daemon-reload && systemctl --user enable switch-google', { stdio: 'ignore' });
                }
                catch (_) { }
                return { success: true, message: `Đã kích hoạt tự khởi động cùng Linux systemd user service.` };
            }
        }
        catch (err) {
            return { success: false, message: `Lỗi kích hoạt khởi động: ${err.message}` };
        }
    }
    disableAutoStart() {
        const platform = process.platform;
        try {
            if (platform === 'win32') {
                const startupDir = path_1.default.join(process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
                const vbsPath = path_1.default.join(startupDir, 'switch-google-daemon.vbs');
                if (fs_1.default.existsSync(vbsPath)) {
                    fs_1.default.unlinkSync(vbsPath);
                }
                return { success: true, message: 'Đã hủy tự khởi động cùng Windows.' };
            }
            else if (platform === 'darwin') {
                const plistPath = path_1.default.join(os_1.default.homedir(), 'Library', 'LaunchAgents', 'com.switchgoogle.daemon.plist');
                if (fs_1.default.existsSync(plistPath)) {
                    try {
                        (0, child_process_1.execSync)(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
                    }
                    catch (_) { }
                    fs_1.default.unlinkSync(plistPath);
                }
                return { success: true, message: 'Đã hủy tự khởi động cùng macOS.' };
            }
            else {
                const servicePath = path_1.default.join(os_1.default.homedir(), '.config', 'systemd', 'user', 'switch-google.service');
                if (fs_1.default.existsSync(servicePath)) {
                    try {
                        (0, child_process_1.execSync)('systemctl --user disable switch-google', { stdio: 'ignore' });
                    }
                    catch (_) { }
                    fs_1.default.unlinkSync(servicePath);
                }
                return { success: true, message: 'Đã hủy tự khởi động cùng Linux.' };
            }
        }
        catch (err) {
            return { success: false, message: `Lỗi hủy khởi động: ${err.message}` };
        }
    }
    startDaemon(port = 1909) {
        const existingPid = this.getPid();
        if (existingPid) {
            return {
                success: true,
                message: `Server ngầm đã đang chạy (PID: ${existingPid}) tại http://localhost:${port}`,
                pid: existingPid
            };
        }
        const cliScript = path_1.default.join(this.appRoot, 'dist', 'cli.js');
        if (!fs_1.default.existsSync(cliScript)) {
            return {
                success: false,
                message: 'Chưa biên dịch mã nguồn (dist/cli.js không tồn tại). Vui lòng chạy npm run build trước.'
            };
        }
        const logStream = fs_1.default.openSync(this.logFile, 'a');
        const child = (0, child_process_1.spawn)(process.execPath, [cliScript, 'serve', '-p', port.toString()], {
            detached: true,
            stdio: ['ignore', logStream, logStream],
            cwd: this.appRoot,
            env: { ...process.env, PORT: port.toString() }
        });
        child.unref();
        if (child.pid) {
            fs_1.default.writeFileSync(this.pidFile, child.pid.toString(), 'utf8');
            return {
                success: true,
                message: `Đã khởi chạy server ngầm thành công (PID: ${child.pid}) tại http://localhost:${port}`,
                pid: child.pid
            };
        }
        else {
            return {
                success: false,
                message: 'Không thể khởi chạy tiến trình ngầm.'
            };
        }
    }
    stopDaemon() {
        const pid = this.getPid();
        if (!pid) {
            if (fs_1.default.existsSync(this.pidFile)) {
                fs_1.default.unlinkSync(this.pidFile);
            }
            return { success: true, message: 'Không có tiến trình ngầm nào đang chạy.' };
        }
        try {
            process.kill(pid, 'SIGTERM');
            if (fs_1.default.existsSync(this.pidFile)) {
                fs_1.default.unlinkSync(this.pidFile);
            }
            return { success: true, message: `Đã dừng tiến trình ngầm (PID: ${pid}) thành công.` };
        }
        catch (err) {
            return { success: false, message: `Lỗi khi dừng tiến trình (PID: ${pid}): ${err.message}` };
        }
    }
    getStatus(port = 1909) {
        return {
            isRunning: this.getPid() !== null,
            pid: this.getPid(),
            port,
            autoStartEnabled: this.isAutoStartEnabled(),
            logFile: this.logFile
        };
    }
    async checkGithubUpdates() {
        let currentCommit = 'unknown';
        let currentVersion = '1.0.0';
        try {
            const pkg = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.appRoot, 'package.json'), 'utf8'));
            currentVersion = pkg.version || '1.0.0';
        }
        catch (_) { }
        try {
            currentCommit = (0, child_process_1.execSync)('git rev-parse --short HEAD', { cwd: this.appRoot, stdio: ['ignore', 'pipe', 'ignore'] })
                .toString()
                .trim();
        }
        catch (_) { }
        return new Promise((resolve) => {
            const options = {
                hostname: 'api.github.com',
                path: '/repos/kipkip11/switch-google/commits/main',
                method: 'GET',
                headers: {
                    'User-Agent': 'Switch-Google-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            const req = https_1.default.request(options, (res) => {
                let rawData = '';
                res.on('data', (chunk) => { rawData += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const data = JSON.parse(rawData);
                            const latestCommit = data.sha ? data.sha.slice(0, 7) : '';
                            const latestMessage = data.commit?.message?.split('\n')[0] || '';
                            const hasUpdate = Boolean(latestCommit && currentCommit !== 'unknown' && latestCommit !== currentCommit);
                            resolve({
                                hasUpdate,
                                currentCommit,
                                latestCommit,
                                latestMessage,
                                currentVersion
                            });
                        }
                        else {
                            resolve({
                                hasUpdate: false,
                                currentCommit,
                                latestCommit: currentCommit,
                                latestMessage: 'Không thể kết nối GitHub API',
                                currentVersion
                            });
                        }
                    }
                    catch (_) {
                        resolve({
                            hasUpdate: false,
                            currentCommit,
                            latestCommit: currentCommit,
                            latestMessage: 'Lỗi phân tích phản hồi GitHub',
                            currentVersion
                        });
                    }
                });
            });
            req.on('error', () => {
                resolve({
                    hasUpdate: false,
                    currentCommit,
                    latestCommit: currentCommit,
                    latestMessage: 'Không có kết nối mạng',
                    currentVersion
                });
            });
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({
                    hasUpdate: false,
                    currentCommit,
                    latestCommit: currentCommit,
                    latestMessage: 'Hết thời gian chờ',
                    currentVersion
                });
            });
            req.end();
        });
    }
    performSelfUpdate() {
        try {
            let output = '';
            if (fs_1.default.existsSync(path_1.default.join(this.appRoot, '.git'))) {
                output += (0, child_process_1.execSync)('git pull origin main', { cwd: this.appRoot }).toString();
                output += '\n' + (0, child_process_1.execSync)('npm install', { cwd: this.appRoot }).toString();
                output += '\n' + (0, child_process_1.execSync)('npm run build', { cwd: this.appRoot }).toString();
            }
            else {
                output += (0, child_process_1.execSync)('npm install -g git+https://github.com/kipkip11/switch-google.git').toString();
            }
            return {
                success: true,
                message: 'Đã cập nhật Switch Google lên phiên bản mới nhất thành công!',
                output
            };
        }
        catch (err) {
            return {
                success: false,
                message: `Lỗi khi cập nhật: ${err.message}`,
                output: err.stderr ? err.stderr.toString() : err.message
            };
        }
    }
}
exports.DaemonManager = DaemonManager;
