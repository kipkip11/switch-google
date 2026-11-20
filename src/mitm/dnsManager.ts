import * as fs from 'fs';
import { execSync } from 'child_process';

const HOSTS_FILE = process.platform === 'win32'
  ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\drivers\\etc\\hosts`
  : '/etc/hosts';

const START_MARKER = '# BEGIN SWITCH-GOOGLE MITM';
const END_MARKER = '# END SWITCH-GOOGLE MITM';

const TARGET_DOMAINS = [
  'daily-cloudcode-pa.googleapis.com',
  'cloudcode-pa.googleapis.com'
];

export class DnsManager {
  public static isEnabled(): boolean {
    try {
      if (!fs.existsSync(HOSTS_FILE)) return false;
      const content = fs.readFileSync(HOSTS_FILE, 'utf8');
      return content.includes(START_MARKER) && content.includes(END_MARKER);
    } catch {
      return false;
    }
  }

  public static getEnableCommand(): string {
    const lines = [
      START_MARKER,
      ...TARGET_DOMAINS.map((d) => `127.0.0.1 ${d}`),
      END_MARKER
    ].join('\\n');

    if (process.platform === 'win32') {
      return `powershell -Command "Add-Content -Path '${HOSTS_FILE}' -Value '${lines}'"`;
    }
    return `echo "${lines}" | sudo tee -a ${HOSTS_FILE} > /dev/null`;
  }

  public static getDisableCommand(): string {
    if (process.platform === 'win32') {
      return `powershell -Command "$content = Get-Content '${HOSTS_FILE}' -Raw; $content = $content -replace '(?s)${START_MARKER}.*?${END_MARKER}\\r?\\n?', ''; Set-Content '${HOSTS_FILE}' -Value $content"`;
    }
    return `sudo sed -i '' '/${START_MARKER}/,/${END_MARKER}/d' ${HOSTS_FILE} 2>/dev/null || sudo sed -i '/${START_MARKER}/,/${END_MARKER}/d' ${HOSTS_FILE}`;
  }

  public static registerExitRollback(): void {
    const rollback = () => {
      try {
        if (DnsManager.isEnabled()) {
          // Chỉ cố gắng gỡ nếu có quyền write hoặc chạy ngầm an toàn
          const content = fs.readFileSync(HOSTS_FILE, 'utf8');
          const reg = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'g');
          const clean = content.replace(reg, '');
          fs.writeFileSync(HOSTS_FILE, clean, 'utf8');
        }
      } catch {}
    };

    process.once('SIGINT', () => { rollback(); process.exit(0); });
    process.once('SIGTERM', () => { rollback(); process.exit(0); });
    process.once('beforeExit', () => { rollback(); });
  }
}
