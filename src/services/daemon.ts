import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import https from 'https';

export interface AutoUpdateConfig {
  enabled: boolean;
  intervalMinutes: number;
  lastCheckTime?: number;
  lastCheckedCommit?: string;
  lastCheckedStatus?: string;
  lastSuccessUpdate?: number;
}

export interface CiCdCheckResult {
  passed: boolean;
  status: 'success' | 'in_progress' | 'failed' | 'unknown';
  details: string;
  totalRuns: number;
  passedRuns: number;
}

export interface GithubUpdateCheckResult {
  hasUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  latestMessage: string;
  currentVersion: string;
  ciPassed: boolean;
  ciStatus: 'success' | 'in_progress' | 'failed' | 'unknown';
  ciDetails: string;
  safeToAutoUpdate: boolean;
}

export class DaemonManager {
  private baseDir: string;
  private pidFile: string;
  private logFile: string;
  private appRoot: string;
  private autoUpdateTimer: NodeJS.Timeout | null = null;
  private isUpdating = false;

  constructor() {
    this.baseDir = path.join(os.homedir(), '.switch-google');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    this.pidFile = path.join(this.baseDir, 'daemon.pid');
    this.logFile = path.join(this.baseDir, 'daemon.log');
    // App root points to the package root where package.json lives
    this.appRoot = path.resolve(__dirname, '../..');
  }

  public getPid(): number | null {
    try {
      if (fs.existsSync(this.pidFile)) {
        const pid = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
        if (!isNaN(pid) && this.isProcessAlive(pid)) {
          return pid;
        }
      }
    } catch (_) {}
    return null;
  }

  public isProcessAlive(pid: number): boolean {
    try {
      // Sending signal 0 tests if process exists
      process.kill(pid, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  public isAutoStartEnabled(): boolean {
    const platform = process.platform;
    if (platform === 'win32') {
      const startupDir = path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
      );
      return fs.existsSync(path.join(startupDir, 'switch-google-daemon.vbs'));
    } else if (platform === 'darwin') {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.switchgoogle.daemon.plist');
      return fs.existsSync(plistPath);
    } else {
      const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'switch-google.service');
      return fs.existsSync(servicePath);
    }
  }

  public enableAutoStart(port = 1909): { success: boolean; message: string } {
    const platform = process.platform;
    const nodeBin = process.execPath;
    const cliScript = path.join(this.appRoot, 'dist', 'cli.js');

    try {
      if (platform === 'win32') {
        const startupDir = path.join(
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
          'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
        );
        fs.mkdirSync(startupDir, { recursive: true });
        const vbsPath = path.join(startupDir, 'switch-google-daemon.vbs');
        
        // VBScript hides window completely (0 = vbHide) and opens browser to port
        const vbsContent = [
          'Set WshShell = CreateObject("WScript.Shell")',
          `WshShell.Run """${nodeBin}"" """${cliScript}""" serve -p ${port}", 0, False`
        ].join('\r\n');

        fs.writeFileSync(vbsPath, vbsContent, 'utf8');
        return { success: true, message: `Đã kích hoạt tự khởi động ngầm cùng Windows tại: ${vbsPath}` };
      } else if (platform === 'darwin') {
        const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        fs.mkdirSync(agentsDir, { recursive: true });
        const plistPath = path.join(agentsDir, 'com.switchgoogle.daemon.plist');

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

        fs.writeFileSync(plistPath, plistContent, 'utf8');
        try {
          execSync(`launchctl load "${plistPath}"`, { stdio: 'ignore' });
        } catch (_) {}
        return { success: true, message: `Đã kích hoạt tự khởi động cùng macOS qua LaunchAgent: ${plistPath}` };
      } else {
        const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
        fs.mkdirSync(systemdDir, { recursive: true });
        const servicePath = path.join(systemdDir, 'switch-google.service');

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

        fs.writeFileSync(servicePath, serviceContent, 'utf8');
        try {
          execSync('systemctl --user daemon-reload && systemctl --user enable switch-google', { stdio: 'ignore' });
        } catch (_) {}
        return { success: true, message: `Đã kích hoạt tự khởi động cùng Linux systemd user service.` };
      }
    } catch (err: any) {
      return { success: false, message: `Lỗi kích hoạt khởi động: ${err.message}` };
    }
  }

  public disableAutoStart(): { success: boolean; message: string } {
    const platform = process.platform;
    try {
      if (platform === 'win32') {
        const startupDir = path.join(
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
          'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
        );
        const vbsPath = path.join(startupDir, 'switch-google-daemon.vbs');
        if (fs.existsSync(vbsPath)) {
          fs.unlinkSync(vbsPath);
        }
        return { success: true, message: 'Đã hủy tự khởi động cùng Windows.' };
      } else if (platform === 'darwin') {
        const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.switchgoogle.daemon.plist');
        if (fs.existsSync(plistPath)) {
          try {
            execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
          } catch (_) {}
          fs.unlinkSync(plistPath);
        }
        return { success: true, message: 'Đã hủy tự khởi động cùng macOS.' };
      } else {
        const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'switch-google.service');
        if (fs.existsSync(servicePath)) {
          try {
            execSync('systemctl --user disable switch-google', { stdio: 'ignore' });
          } catch (_) {}
          fs.unlinkSync(servicePath);
        }
        return { success: true, message: 'Đã hủy tự khởi động cùng Linux.' };
      }
    } catch (err: any) {
      return { success: false, message: `Lỗi hủy khởi động: ${err.message}` };
    }
  }

  public startDaemon(port = 1909): { success: boolean; message: string; pid?: number } {
    const existingPid = this.getPid();
    if (existingPid) {
      return {
        success: true,
        message: `Server ngầm đã đang chạy (PID: ${existingPid}) tại http://localhost:${port}`,
        pid: existingPid
      };
    }

    const cliScript = path.join(this.appRoot, 'dist', 'cli.js');
    if (!fs.existsSync(cliScript)) {
      return {
        success: false,
        message: 'Chưa biên dịch mã nguồn (dist/cli.js không tồn tại). Vui lòng chạy npm run build trước.'
      };
    }

    const logStream = fs.openSync(this.logFile, 'a');
    const child = spawn(process.execPath, [cliScript, 'serve', '-p', port.toString()], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      cwd: this.appRoot,
      windowsHide: true,
      env: { ...process.env, PORT: port.toString() }
    });

    child.unref();

    if (child.pid) {
      fs.writeFileSync(this.pidFile, child.pid.toString(), 'utf8');
      return {
        success: true,
        message: `Đã khởi chạy server ngầm thành công (PID: ${child.pid}) tại http://localhost:${port}`,
        pid: child.pid
      };
    } else {
      return {
        success: false,
        message: 'Không thể khởi chạy tiến trình ngầm.'
      };
    }
  }

  public stopDaemon(): { success: boolean; message: string } {
    const pid = this.getPid();
    if (!pid) {
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
      return { success: true, message: 'Không có tiến trình ngầm nào đang chạy.' };
    }

    try {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
        } catch (_) {
          process.kill(pid, 'SIGTERM');
        }
      } else {
        process.kill(pid, 'SIGTERM');
      }
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
      return { success: true, message: `Đã dừng tiến trình ngầm (PID: ${pid}) thành công.` };
    } catch (err: any) {
      return { success: false, message: `Lỗi khi dừng tiến trình (PID: ${pid}): ${err.message}` };
    }
  }

  public getStatus(port = 1909): {
    isRunning: boolean;
    pid: number | null;
    port: number;
    autoStartEnabled: boolean;
    logFile: string;
  } {
    return {
      isRunning: this.getPid() !== null,
      pid: this.getPid(),
      port,
      autoStartEnabled: this.isAutoStartEnabled(),
      logFile: this.logFile
    };
  }

  public async fetchGithubJson(apiPath: string): Promise<any> {
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

      const req = https.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(rawData));
            } catch (e) {
              reject(e);
            }
          } else {
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

  public async checkCiCdStatus(commitSha: string): Promise<CiCdCheckResult> {
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
        const inProgress = runs.some((r: any) => r.status !== 'completed');
        const failed = runs.some((r: any) =>
          r.status === 'completed' &&
          r.conclusion !== 'success' &&
          r.conclusion !== 'neutral' &&
          r.conclusion !== 'skipped'
        );
        const passedCount = runs.filter((r: any) => r.status === 'completed' && r.conclusion === 'success').length;

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
        } else if (statusData.state === 'pending') {
          return {
            passed: false,
            status: 'in_progress',
            details: 'Trạng thái commit: CI/CD đang chờ xử lý',
            totalRuns: statusData.total_count || 0,
            passedRuns: 0
          };
        } else {
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
    } catch (err: any) {
      return {
        passed: false,
        status: 'unknown',
        details: `Không thể kết nối kiểm tra CI/CD: ${err.message}`,
        totalRuns: 0,
        passedRuns: 0
      };
    }
  }

  public async checkGithubUpdates(): Promise<GithubUpdateCheckResult> {
    let currentCommit = 'unknown';
    let currentVersion = '1.0.0';

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.appRoot, 'package.json'), 'utf8'));
      currentVersion = pkg.version || '1.0.0';
    } catch (_) {}

    // 1. Thử đọc trực tiếp từ .git folder (100% Node.js, không spawn cmd, không giật popup trên Windows)
    try {
      const gitHeadPath = path.join(this.appRoot, '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
        if (headContent.startsWith('ref: ')) {
          const refRelPath = headContent.slice(5).trim();
          const refPath = path.join(this.appRoot, '.git', refRelPath);
          if (fs.existsSync(refPath)) {
            currentCommit = fs.readFileSync(refPath, 'utf8').trim().slice(0, 7);
          } else {
            // Thử tìm trong .git/packed-refs
            const packedPath = path.join(this.appRoot, '.git', 'packed-refs');
            if (fs.existsSync(packedPath)) {
              const packed = fs.readFileSync(packedPath, 'utf8');
              const match = packed.split('\n').find((line) => line.endsWith(refRelPath));
              if (match) {
                currentCommit = match.split(' ')[0].trim().slice(0, 7);
              }
            }
          }
        } else if (headContent.length >= 7) {
          currentCommit = headContent.slice(0, 7);
        }
      }
    } catch (_) {}

    // 2. Nếu chưa đọc được bằng fs, fallback execSync an toàn với windowsHide: true
    if (currentCommit === 'unknown') {
      try {
        currentCommit = execSync('git rev-parse --short HEAD', {
          cwd: this.appRoot,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true
        })
          .toString()
          .trim();
      } catch (_) {}
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
      const hasUpdate = Boolean(latestCommit && currentCommit !== 'unknown' && latestCommit !== currentCommit);

      let ciResult: CiCdCheckResult = {
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
    } catch (err: any) {
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

  public getAutoUpdateConfig(): AutoUpdateConfig {
    const configFile = path.join(this.baseDir, 'auto_update.json');
    const defaultConfig: AutoUpdateConfig = {
      enabled: true,
      intervalMinutes: 60
    };
    try {
      if (fs.existsSync(configFile)) {
        return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
      }
    } catch (_) {}
    return defaultConfig;
  }

  public saveAutoUpdateConfig(config: Partial<AutoUpdateConfig>): AutoUpdateConfig {
    const current = this.getAutoUpdateConfig();
    const updated = { ...current, ...config };
    const configFile = path.join(this.baseDir, 'auto_update.json');
    try {
      fs.writeFileSync(configFile, JSON.stringify(updated, null, 2), 'utf8');
    } catch (_) {}
    return updated;
  }

  public startAutoUpdateWorker(port = 1909, onPerformRestart?: () => void): void {
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
            } else {
              this.performSelfRestart(port);
            }
          } else {
            console.error(`[AutoUpdate] ✗ Cập nhật thất bại: ${updateResult.message}`);
          }
        } else if (updateInfo.hasUpdate && !updateInfo.ciPassed) {
          console.log(`[AutoUpdate] ℹ Phát hiện bản mới (${updateInfo.latestCommit}) nhưng đang chờ CI/CD (${updateInfo.ciDetails}). Bỏ qua cập nhật để đảm bảo an toàn.`);
        }
      } catch (err: any) {
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

  public stopAutoUpdateWorker(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
  }

  public performSelfRestart(port = 1909, onBeforeExit?: () => void): void {
    try {
      if (onBeforeExit) {
        try { onBeforeExit(); } catch (_) {}
      }

      const cliScript = path.join(this.appRoot, 'dist', 'cli.js');
      const logStream = fs.openSync(this.logFile, 'a');
      const child = spawn(process.execPath, [cliScript, 'serve', '-p', port.toString()], {
        detached: true,
        stdio: ['ignore', logStream, logStream],
        cwd: this.appRoot,
        windowsHide: true,
        env: { ...process.env, PORT: port.toString() }
      });

      child.unref();

      if (child.pid) {
        fs.writeFileSync(this.pidFile, child.pid.toString(), 'utf8');
      }

      setTimeout(() => {
        process.exit(0);
      }, 500);
    } catch (err) {
      console.error('[Daemon] Lỗi khởi động lại:', err);
    }
  }

  public restartDaemon(port = 1909): { success: boolean; message: string; pid?: number } {
    this.stopDaemon();
    // Chờ socket giải phóng bằng pure node sleep (zero spawn, không nháy CMD)
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
    } catch (_) {
      try {
        if (process.platform === 'win32') {
          execSync('ping 127.0.0.1 -n 2 >nul', { windowsHide: true, stdio: 'ignore' });
        } else {
          execSync('sleep 0.5', { stdio: 'ignore' });
        }
      } catch (_) {}
    }
    return this.startDaemon(port);
  }

  public performSelfUpdate(): { success: boolean; message: string; output: string } {
    try {
      // 1. Tự động sao lưu dữ liệu an toàn trước khi cập nhật
      const backupDir = path.join(this.baseDir, 'backups', `pre_update_${Date.now()}`);
      try {
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        const filesToBackup = ['switch_google.sqlite', 'profiles.enc.json', 'master.key', 'usage_logs.json'];
        for (const f of filesToBackup) {
          const src = path.join(this.baseDir, f);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(backupDir, f));
          }
        }
      } catch (backupErr) {
        console.warn('[Update] Cảnh báo sao lưu trước cập nhật:', backupErr);
      }

      let output = '';
      if (fs.existsSync(path.join(this.appRoot, '.git'))) {
        output += execSync('git pull origin main', { cwd: this.appRoot, windowsHide: true }).toString();
        output += '\n' + execSync('npm install', { cwd: this.appRoot, windowsHide: true }).toString();
        output += '\n' + execSync('npm run build', { cwd: this.appRoot, windowsHide: true }).toString();
      } else {
        output += execSync('npm install -g git+https://github.com/kipkip11/switch-google.git', { windowsHide: true }).toString();
      }
      return {
        success: true,
        message: 'Đã cập nhật Switch Google lên phiên bản mới nhất thành công (Dữ liệu đã được sao lưu an toàn)!',
        output
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Lỗi khi cập nhật: ${err.message}`,
        output: err.stderr ? err.stderr.toString() : err.message
      };
    }
  }
}
