import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import https from 'https';

export class DaemonManager {
  private baseDir: string;
  private pidFile: string;
  private logFile: string;
  private appRoot: string;

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
          `WshShell.Run """${nodeBin}"" """${cliScript}""" serve -p ${port}", 0, False`,
          'WScript.Sleep 1500',
          `WshShell.Run "http://localhost:${port}"`
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
      process.kill(pid, 'SIGTERM');
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

  public async checkGithubUpdates(): Promise<{
    hasUpdate: boolean;
    currentCommit: string;
    latestCommit: string;
    latestMessage: string;
    currentVersion: string;
  }> {
    let currentCommit = 'unknown';
    let currentVersion = '1.0.0';

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.appRoot, 'package.json'), 'utf8'));
      currentVersion = pkg.version || '1.0.0';
    } catch (_) {}

    try {
      currentCommit = execSync('git rev-parse --short HEAD', { cwd: this.appRoot, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch (_) {}

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

      const req = https.request(options, (res) => {
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
            } else {
              resolve({
                hasUpdate: false,
                currentCommit,
                latestCommit: currentCommit,
                latestMessage: 'Không thể kết nối GitHub API',
                currentVersion
              });
            }
          } catch (_) {
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

  public performSelfUpdate(): { success: boolean; message: string; output: string } {
    try {
      let output = '';
      if (fs.existsSync(path.join(this.appRoot, '.git'))) {
        output += execSync('git pull origin main', { cwd: this.appRoot }).toString();
        output += '\n' + execSync('npm install', { cwd: this.appRoot }).toString();
        output += '\n' + execSync('npm run build', { cwd: this.appRoot }).toString();
      } else {
        output += execSync('npm install -g git+https://github.com/kipkip11/switch-google.git').toString();
      }
      return {
        success: true,
        message: 'Đã cập nhật Switch Google lên phiên bản mới nhất thành công!',
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
