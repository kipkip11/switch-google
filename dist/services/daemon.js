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
    autoUpdateTimer = null;
    isUpdating = false;
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
                    `WshShell.Run """${nodeBin}"" """${cliScript}""" serve -p ${port}", 0, False`
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
            windowsHide: true,
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
            if (process.platform === 'win32') {
                try {
                    (0, child_process_1.execSync)(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
                }
                catch (_) {
                    process.kill(pid, 'SIGTERM');
                }
            }
            else {
                process.kill(pid, 'SIGTERM');
            }
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
    async fetchGithubJson(apiPath) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: apiPath,
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
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(rawData));
                        }
                        catch (e) {
                            reject(e);
                        }
                    }
                    else {
                        reject(new Error(`GitHub API returned status ${res.statusCode}: ${rawData.slice(0, 150)}`));
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.setTimeout(8000, () => {
                req.destroy();
                reject(new Error('GitHub API request timed out'));
            });
            req.end();
        });
    }
    async checkCiCdStatus(commitSha) {
        if (!commitSha || commitSha === 'unknown') {
            return {
                passed: false,
                status: 'unknown',
                details: 'Không xác định được commit SHA',
                totalRuns: 0,
                passedRuns: 0
            };
        }
        try {
            // 1. Kiểm tra Check-Runs API của GitHub Actions
            const checkData = await this.fetchGithubJson(`/repos/kipkip11/switch-google/commits/${commitSha}/check-runs`);
            if (checkData && Array.isArray(checkData.check_runs) && checkData.total_count > 0) {
                const total = checkData.total_count;
                const runs = checkData.check_runs;
                const inProgress = runs.some((r) => r.status !== 'completed');
                const failed = runs.some((r) => r.status === 'completed' &&
                    r.conclusion !== 'success' &&
                    r.conclusion !== 'neutral' &&
                    r.conclusion !== 'skipped');
                const passedCount = runs.filter((r) => r.status === 'completed' && r.conclusion === 'success').length;
                if (inProgress) {
                    return {
                        passed: false,
                        status: 'in_progress',
                        details: `CI/CD đang chạy kiểm thử (${passedCount}/${total} hoàn thành)...`,
                        totalRuns: total,
                        passedRuns: passedCount
                    };
                }
                if (failed) {
                    return {
                        passed: false,
                        status: 'failed',
                        details: `CI/CD kiểm thử thất bại (phát hiện lỗi trong test suite)`,
                        totalRuns: total,
                        passedRuns: passedCount
                    };
                }
                return {
                    passed: true,
                    status: 'success',
                    details: `Đã vượt qua toàn bộ bộ lọc CI/CD (${total}/${total} checks đạt chuẩn)`,
                    totalRuns: total,
                    passedRuns: total
                };
            }
            // 2. Fallback: Combined Commit Status API
            const statusData = await this.fetchGithubJson(`/repos/kipkip11/switch-google/commits/${commitSha}/status`);
            if (statusData && statusData.state) {
                if (statusData.state === 'success') {
                    return {
                        passed: true,
                        status: 'success',
                        details: 'Trạng thái commit: Success (CI/CD Passed)',
                        totalRuns: statusData.total_count || 1,
                        passedRuns: statusData.total_count || 1
                    };
                }
                else if (statusData.state === 'pending') {
                    return {
                        passed: false,
                        status: 'in_progress',
                        details: 'Trạng thái commit: CI/CD đang chờ xử lý',
                        totalRuns: statusData.total_count || 0,
                        passedRuns: 0
                    };
                }
                else {
                    return {
                        passed: false,
                        status: 'failed',
                        details: `Trạng thái commit: ${statusData.state} (CI/CD thất bại)`,
                        totalRuns: statusData.total_count || 0,
                        passedRuns: 0
                    };
                }
            }
            return {
                passed: false,
                status: 'unknown',
                details: 'Chưa có thông tin CI/CD cho commit này',
                totalRuns: 0,
                passedRuns: 0
            };
        }
        catch (err) {
            return {
                passed: false,
                status: 'unknown',
                details: `Không thể kết nối kiểm tra CI/CD: ${err.message}`,
                totalRuns: 0,
                passedRuns: 0
            };
        }
    }
    async checkGithubUpdates() {
        let currentCommit = 'unknown';
        let currentVersion = '1.0.0';
        try {
            const pkg = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.appRoot, 'package.json'), 'utf8'));
            currentVersion = pkg.version || '1.0.0';
        }
        catch (_) { }
        // 1. Thử đọc trực tiếp từ .git folder (100% Node.js, không spawn cmd, không giật popup trên Windows)
        try {
            const gitHeadPath = path_1.default.join(this.appRoot, '.git', 'HEAD');
            if (fs_1.default.existsSync(gitHeadPath)) {
                const headContent = fs_1.default.readFileSync(gitHeadPath, 'utf8').trim();
                if (headContent.startsWith('ref: ')) {
                    const refRelPath = headContent.slice(5).trim();
                    const refPath = path_1.default.join(this.appRoot, '.git', refRelPath);
                    if (fs_1.default.existsSync(refPath)) {
                        currentCommit = fs_1.default.readFileSync(refPath, 'utf8').trim().slice(0, 7);
                    }
                    else {
                        // Thử tìm trong .git/packed-refs
                        const packedPath = path_1.default.join(this.appRoot, '.git', 'packed-refs');
                        if (fs_1.default.existsSync(packedPath)) {
                            const packed = fs_1.default.readFileSync(packedPath, 'utf8');
                            const match = packed.split('\n').find((line) => line.endsWith(refRelPath));
                            if (match) {
                                currentCommit = match.split(' ')[0].trim().slice(0, 7);
                            }
                        }
                    }
                }
                else if (headContent.length >= 7) {
                    currentCommit = headContent.slice(0, 7);
                }
            }
        }
        catch (_) { }
        // 2. Nếu chưa đọc được bằng fs, fallback execSync an toàn với windowsHide: true
        if (currentCommit === 'unknown') {
            try {
                currentCommit = (0, child_process_1.execSync)('git rev-parse --short HEAD', {
                    cwd: this.appRoot,
                    stdio: ['ignore', 'pipe', 'ignore'],
                    windowsHide: true
                })
                    .toString()
                    .trim();
            }
            catch (_) { }
        }
        // 3. Nếu là cài đặt từ ZIP (không có git), dùng phiên bản vX.Y.Z
        if (currentCommit === 'unknown') {
            currentCommit = `v${currentVersion}`;
        }
        try {
            const commitData = await this.fetchGithubJson('/repos/kipkip11/switch-google/commits/main');
            const latestSha = commitData.sha || '';
            const latestCommit = latestSha ? latestSha.slice(0, 7) : '';
            const latestMessage = commitData.commit?.message?.split('\n')[0] || '';
            let isLocalAheadOrContainsRemote = false;
            if (latestSha && latestCommit && latestCommit !== currentCommit) {
                try {
                    (0, child_process_1.execSync)(`git merge-base --is-ancestor ${latestSha} HEAD`, {
                        cwd: this.appRoot,
                        stdio: 'ignore',
                        windowsHide: true
                    });
                    isLocalAheadOrContainsRemote = true;
                }
                catch (_) { }
            }
            const hasUpdate = Boolean(latestCommit &&
                currentCommit !== 'unknown' &&
                latestCommit !== currentCommit &&
                !isLocalAheadOrContainsRemote);
            let ciResult = {
                passed: false,
                status: 'unknown',
                details: 'Chưa kiểm tra',
                totalRuns: 0,
                passedRuns: 0
            };
            if (latestSha) {
                ciResult = await this.checkCiCdStatus(latestSha);
            }
            const safeToAutoUpdate = hasUpdate && ciResult.passed;
            return {
                hasUpdate,
                currentCommit,
                latestCommit,
                latestMessage,
                currentVersion,
                ciPassed: ciResult.passed,
                ciStatus: ciResult.status,
                ciDetails: ciResult.details,
                safeToAutoUpdate
            };
        }
        catch (err) {
            return {
                hasUpdate: false,
                currentCommit,
                latestCommit: currentCommit,
                latestMessage: `Không thể kết nối GitHub: ${err.message}`,
                currentVersion,
                ciPassed: false,
                ciStatus: 'unknown',
                ciDetails: 'Không có kết nối mạng',
                safeToAutoUpdate: false
            };
        }
    }
    getAutoUpdateConfig() {
        const configFile = path_1.default.join(this.baseDir, 'auto_update.json');
        const defaultConfig = {
            enabled: true,
            intervalMinutes: 60
        };
        try {
            if (fs_1.default.existsSync(configFile)) {
                return { ...defaultConfig, ...JSON.parse(fs_1.default.readFileSync(configFile, 'utf8')) };
            }
        }
        catch (_) { }
        return defaultConfig;
    }
    saveAutoUpdateConfig(config) {
        const current = this.getAutoUpdateConfig();
        const updated = { ...current, ...config };
        const configFile = path_1.default.join(this.baseDir, 'auto_update.json');
        try {
            fs_1.default.writeFileSync(configFile, JSON.stringify(updated, null, 2), 'utf8');
        }
        catch (_) { }
        return updated;
    }
    startAutoUpdateWorker(port = 1909, onPerformRestart) {
        if (this.autoUpdateTimer) {
            clearInterval(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }
        const checkAndRun = async () => {
            const config = this.getAutoUpdateConfig();
            if (!config.enabled || this.isUpdating) {
                return;
            }
            try {
                const updateInfo = await this.checkGithubUpdates();
                const now = Date.now();
                this.saveAutoUpdateConfig({
                    lastCheckTime: now,
                    lastCheckedCommit: updateInfo.latestCommit,
                    lastCheckedStatus: updateInfo.ciDetails
                });
                if (updateInfo.safeToAutoUpdate) {
                    console.log(`\n[AutoUpdate] 🚀 Phát hiện bản cập nhật mới (${updateInfo.latestCommit}) đã vượt qua bộ lọc CI/CD!`);
                    console.log(`[AutoUpdate] Chi tiết CI/CD: ${updateInfo.ciDetails}`);
                    console.log(`[AutoUpdate] Bắt đầu tự động cập nhật ngầm cho hệ thống...`);
                    this.isUpdating = true;
                    const updateResult = this.performSelfUpdate();
                    this.isUpdating = false;
                    if (updateResult.success) {
                        console.log(`[AutoUpdate] ✓ Cập nhật thành công!`);
                        this.saveAutoUpdateConfig({
                            lastSuccessUpdate: Date.now()
                        });
                        console.log(`[AutoUpdate] Đang tự động khởi động lại server ngầm để nạp phiên bản mới...`);
                        if (onPerformRestart) {
                            onPerformRestart();
                        }
                        else {
                            this.performSelfRestart(port);
                        }
                    }
                    else {
                        console.error(`[AutoUpdate] ✗ Cập nhật thất bại: ${updateResult.message}`);
                    }
                }
                else if (updateInfo.hasUpdate && !updateInfo.ciPassed) {
                    console.log(`[AutoUpdate] ℹ Phát hiện bản mới (${updateInfo.latestCommit}) nhưng đang chờ CI/CD (${updateInfo.ciDetails}). Bỏ qua cập nhật để đảm bảo an toàn.`);
                }
            }
            catch (err) {
                console.error(`[AutoUpdate] Lỗi kiểm tra tự động: ${err.message}`);
            }
        };
        // Kiểm tra lần đầu sau 15 giây khi server vừa khởi động
        const initialTimer = setTimeout(() => {
            checkAndRun();
        }, 15000);
        initialTimer.unref();
        // Chạy định kỳ theo cấu hình intervalMinutes (tối thiểu 5 phút)
        const intervalMinutes = Math.max(5, this.getAutoUpdateConfig().intervalMinutes || 60);
        this.autoUpdateTimer = setInterval(checkAndRun, intervalMinutes * 60 * 1000);
        this.autoUpdateTimer.unref();
    }
    stopAutoUpdateWorker() {
        if (this.autoUpdateTimer) {
            clearInterval(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }
    }
    performSelfRestart(port = 1909, onBeforeExit) {
        try {
            if (onBeforeExit) {
                try {
                    onBeforeExit();
                }
                catch (_) { }
            }
            const cliScript = path_1.default.join(this.appRoot, 'dist', 'cli.js');
            const logStream = fs_1.default.openSync(this.logFile, 'a');
            const child = (0, child_process_1.spawn)(process.execPath, [cliScript, 'serve', '-p', port.toString()], {
                detached: true,
                stdio: ['ignore', logStream, logStream],
                cwd: this.appRoot,
                windowsHide: true,
                env: { ...process.env, PORT: port.toString() }
            });
            child.unref();
            if (child.pid) {
                fs_1.default.writeFileSync(this.pidFile, child.pid.toString(), 'utf8');
            }
            setTimeout(() => {
                process.exit(0);
            }, 500);
        }
        catch (err) {
            console.error('[Daemon] Lỗi khởi động lại:', err);
        }
    }
    restartDaemon(port = 1909) {
        this.stopDaemon();
        // Chờ socket giải phóng bằng pure node sleep (zero spawn, không nháy CMD)
        try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
        }
        catch (_) {
            try {
                if (process.platform === 'win32') {
                    (0, child_process_1.execSync)('ping 127.0.0.1 -n 2 >nul', { windowsHide: true, stdio: 'ignore' });
                }
                else {
                    (0, child_process_1.execSync)('sleep 0.5', { stdio: 'ignore' });
                }
            }
            catch (_) { }
        }
        return this.startDaemon(port);
    }
    performSelfUpdate() {
        try {
            // 1. Tự động sao lưu dữ liệu an toàn trước khi cập nhật
            const backupDir = path_1.default.join(this.baseDir, 'backups', `pre_update_${Date.now()}`);
            try {
                if (!fs_1.default.existsSync(backupDir)) {
                    fs_1.default.mkdirSync(backupDir, { recursive: true });
                }
                const filesToBackup = ['switch_google.sqlite', 'profiles.enc.json', 'master.key', 'usage_logs.json'];
                for (const f of filesToBackup) {
                    const src = path_1.default.join(this.baseDir, f);
                    if (fs_1.default.existsSync(src)) {
                        fs_1.default.copyFileSync(src, path_1.default.join(backupDir, f));
                    }
                }
            }
            catch (backupErr) {
                console.warn('[Update] Cảnh báo sao lưu trước cập nhật:', backupErr);
            }
            let output = '';
            if (fs_1.default.existsSync(path_1.default.join(this.appRoot, '.git'))) {
                output += (0, child_process_1.execSync)('git pull origin main', { cwd: this.appRoot, windowsHide: true }).toString();
                output += '\n' + (0, child_process_1.execSync)('npm install', { cwd: this.appRoot, windowsHide: true }).toString();
                output += '\n' + (0, child_process_1.execSync)('npm run build', { cwd: this.appRoot, windowsHide: true }).toString();
            }
            else {
                output += (0, child_process_1.execSync)('npm install -g git+https://github.com/kipkip11/switch-google.git', { windowsHide: true }).toString();
            }
            return {
                success: true,
                message: 'Đã cập nhật Switch Google lên phiên bản mới nhất thành công (Dữ liệu đã được sao lưu an toàn)!',
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
