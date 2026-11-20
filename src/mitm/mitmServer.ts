import * as https from 'https';
import * as tls from 'tls';
import { IncomingMessage, ServerResponse } from 'http';
import { CertManager } from './certManager';
import { ProfileManager } from '../profiles/manager';
import { AccountRotator } from '../profiles/rotator';

export class MitmServer {
  private static instance: MitmServer | null = null;
  private server: https.Server | null = null;
  private isRunning: boolean = false;
  private port: number = 443;
  private certCache: Map<string, tls.SecureContext> = new Map();

  private constructor(
    private profileManager: ProfileManager,
    private rotator: AccountRotator
  ) {}

  public static getInstance(profileManager?: ProfileManager, rotator?: AccountRotator): MitmServer {
    if (!MitmServer.instance) {
      if (!profileManager || !rotator) {
        throw new Error('ProfileManager and AccountRotator required to initialize MitmServer');
      }
      MitmServer.instance = new MitmServer(profileManager, rotator);
    }
    return MitmServer.instance;
  }

  public getStatus(): { running: boolean; port: number; certTrusted: boolean } {
    return {
      running: this.isRunning,
      port: this.port,
      certTrusted: CertManager.isCertTrusted()
    };
  }

  public async start(port = 443): Promise<void> {
    if (this.isRunning) return;
    this.port = port;

    const rootCA = CertManager.ensureRootCA();

    const options: https.ServerOptions = {
      key: rootCA.key,
      cert: rootCA.cert,
      SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
        try {
          if (this.certCache.has(servername)) {
            return cb(null, this.certCache.get(servername));
          }
          const domainCert = CertManager.getCertForDomain(servername);
          const ctx = tls.createSecureContext({
            key: domainCert.key,
            cert: `${domainCert.cert.toString('utf8')}\n${rootCA.cert.toString('utf8')}`
          });
          this.certCache.set(servername, ctx);
          cb(null, ctx);
        } catch (e: any) {
          cb(e);
        }
      }
    };

    this.server = https.createServer(options, (req: IncomingMessage, res: ServerResponse) => {
      this.handleFastPipe(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.isRunning = true;
        resolve();
      });

      this.server!.on('error', (err: any) => {
        this.isRunning = false;
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  /**
   * Zero-Translation Fast-Pipe Handler:
   * Giữ nguyên 100% request body và telemetry headers gốc của Antigravity IDE,
   * chỉ hoán đổi Authorization token bằng tài khoản đang xoay tua trong pool,
   * stream thẳng lên Google qua kết nối socket TLS Keep-Alive (< 5ms latency).
   */
  private async handleFastPipe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const bodyBuffer = Buffer.concat(chunks);

      try {
        await this.rotator.executeWithFailover(async (creds) => {
          return new Promise<void>((resolve, reject) => {
            // Chuẩn bị headers upstream giữ nguyên vẹn 100% telemetry gốc của IDE
            const upstreamHeaders: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (!v) continue;
              const lk = k.toLowerCase();
              // Bỏ hop-by-hop headers
              if (lk === 'host' || lk === 'connection' || lk === 'content-length') continue;
              upstreamHeaders[k] = v;
            }

            // Tráo đổi Bearer token của tài khoản trong pool
            upstreamHeaders['authorization'] = `Bearer ${creds.access_token}`;
            upstreamHeaders['host'] = 'daily-cloudcode-pa.googleapis.com';

            const targetHost = 'daily-cloudcode-pa.googleapis.com';
            const targetPath = req.url || '/v1internal:streamGenerateContent';

            // Gửi thẳng request lên Google Cloud Code upstream (Zero-Translation)
            const proxyReq = https.request(
              {
                host: targetHost,
                port: 443,
                path: targetPath,
                method: req.method || 'POST',
                headers: upstreamHeaders,
                agent: new https.Agent({ keepAlive: true, maxSockets: 50 })
              },
              (proxyRes) => {
                const statusCode = proxyRes.statusCode || 200;

                if (statusCode === 429) {
                  return reject({ status: 429, message: 'Google CloudCode rate limit 429' });
                }

                if (statusCode >= 400 && statusCode !== 404) {
                  // Buffer body để log nếu có lỗi
                  const errChunks: Buffer[] = [];
                  proxyRes.on('data', (c) => errChunks.push(c));
                  proxyRes.on('end', () => {
                    const errMsg = Buffer.concat(errChunks).toString('utf8');
                    reject({ status: statusCode, message: errMsg });
                  });
                  return;
                }

                // Forward status code và headers
                const resHeaders: Record<string, any> = {};
                for (const [hk, hv] of Object.entries(proxyRes.headers)) {
                  if (hv) resHeaders[hk] = hv;
                }

                res.writeHead(statusCode, resHeaders);
                // Pipe trực tiếp data stream từ Google về Antigravity IDE (Zero-Lag)
                proxyRes.pipe(res);
                proxyRes.on('end', () => resolve());
              }
            );

            proxyReq.on('error', (e) => reject(e));
            proxyReq.end(bodyBuffer);
          });
        });
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: { message: err.message || 'Fast-Pipe upstream error' } }));
      }
    });
  }
}
