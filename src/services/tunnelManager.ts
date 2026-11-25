import { execSync, spawn, ChildProcess } from 'child_process';
import os from 'os';

export interface NetworkStatus {
  lanIps: string[];
  tailscale: {
    installed: boolean;
    active: boolean;
    ip: string | null;
    peers: Array<{ name: string; ip: string; os: string; online: boolean }>;
  };
  cloudflare: {
    installed: boolean;
    running: boolean;
    url: string | null;
  };
}

export class TunnelManager {
  private static cfProcess: ChildProcess | null = null;
  private static cfUrl: string | null = null;

  public static getNetworkStatus(port: number): NetworkStatus {
    // 1. Get LAN IPs
    const lanIps: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          lanIps.push(iface.address);
        }
      }
    }

    // 2. Tailscale Status
    let tsInstalled = false;
    let tsActive = false;
    let tsIp: string | null = null;
    const tsPeers: Array<{ name: string; ip: string; os: string; online: boolean }> = [];

    const tailscaleBin = '/usr/local/bin/tailscale';
    try {
      execSync(`test -x ${tailscaleBin} || which tailscale`, { stdio: 'pipe' });
      tsInstalled = true;
    } catch {}

    if (tsInstalled) {
      try {
        const raw = execSync(`${tailscaleBin} status --json`, { stdio: 'pipe', encoding: 'utf8' });
        const data = JSON.parse(raw);
        if (data.Self) {
          tsActive = true;
          tsIp = (data.Self.TailscaleIPs && data.Self.TailscaleIPs[0]) || null;
        }
        if (data.Peer) {
          for (const key of Object.keys(data.Peer)) {
            const p = data.Peer[key];
            tsPeers.push({
              name: p.HostName || 'Unknown',
              ip: (p.TailscaleIPs && p.TailscaleIPs[0]) || '',
              os: p.OS || 'Unknown',
              online: Boolean(p.Online)
            });
          }
        }
      } catch {}
    }

    // 3. Cloudflare Status
    let cfInstalled = false;
    const cfBin = '/usr/local/bin/cloudflared';
    try {
      execSync(`test -x ${cfBin} || which cloudflared`, { stdio: 'pipe' });
      cfInstalled = true;
    } catch {}

    return {
      lanIps,
      tailscale: {
        installed: tsInstalled,
        active: tsActive,
        ip: tsIp,
        peers: tsPeers
      },
      cloudflare: {
        installed: cfInstalled,
        running: Boolean(this.cfProcess && !this.cfProcess.killed),
        url: this.cfUrl
      }
    };
  }

  public static async startCloudflareTunnel(port: number): Promise<string> {
    if (this.cfProcess && !this.cfProcess.killed) {
      if (this.cfUrl) return this.cfUrl;
      this.stopCloudflareTunnel();
    }

    this.cfUrl = null;

    return new Promise((resolve, reject) => {
      const cfBin = '/usr/local/bin/cloudflared';
      const child = spawn(cfBin, ['tunnel', '--url', `http://127.0.0.1:${port}`]);
      this.cfProcess = child;

      const timeout = setTimeout(() => {
        if (!this.cfUrl) {
          this.stopCloudflareTunnel();
          reject(new Error('Khởi tạo Cloudflare Quick Tunnel quá thời gian chờ (15s).'));
        }
      }, 15000);

      const onData = (data: Buffer) => {
        const text = data.toString('utf8');
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.cfUrl = match[0];
          clearTimeout(timeout);
          resolve(this.cfUrl);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.stopCloudflareTunnel();
        reject(err);
      });

      child.on('exit', () => {
        this.cfProcess = null;
        this.cfUrl = null;
      });
    });
  }

  public static stopCloudflareTunnel(): void {
    if (this.cfProcess) {
      try {
        this.cfProcess.kill('SIGTERM');
      } catch {}
      this.cfProcess = null;
      this.cfUrl = null;
    }
  }

  public static registerExitHandler(): void {
    process.once('SIGINT', () => { this.stopCloudflareTunnel(); process.exit(0); });
    process.once('SIGTERM', () => { this.stopCloudflareTunnel(); process.exit(0); });
    process.once('beforeExit', () => { this.stopCloudflareTunnel(); });
  }
}
