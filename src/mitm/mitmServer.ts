import * as https from 'https';
import * as tls from 'tls';
import * as dns from 'dns';
import { IncomingMessage, ServerResponse } from 'http';
import { CertManager } from './certManager';
import { ProfileManager } from '../profiles/manager';
import { AccountRotator } from '../profiles/rotator';
import { ModelFallbackManager, normalizeDisplayModel, resolveUpstreamModel } from '../services/modelFallback';
import { SmartRouter } from '../services/smartRouter';
import { usageTracker } from '../usage/tracker';

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

  public getStatus(): { running: boolean; port: number; certTrusted: boolean; isFallback: boolean } {
    return {
      running: this.isRunning,
      port: this.port,
      certTrusted: CertManager.isCertTrusted(),
      isFallback: this.port !== 443
    };
  }

  public getActivePort(): number {
    return this.port;
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

    const tryListen = (listenPort: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const onError = (err: any) => {
          this.server!.removeListener('listening', onListening);
          if (err.code === 'EACCES' && listenPort === 443) {
            console.warn(`[MitmServer] Cổng 443 yêu cầu quyền root/sudo (EACCES). Tự động fallback sang cổng 8443...`);
            this.port = 8443;
            tryListen(8443).then(resolve).catch(reject);
            return;
          }
          this.isRunning = false;
          reject(err);
        };

        const onListening = () => {
          this.server!.removeListener('error', onError);
          this.isRunning = true;
          this.port = listenPort;
          console.log(`[MitmServer] Fast-Pipe MITM Server đang lắng nghe tại 127.0.0.1:${this.port}`);
          resolve();
        };

        this.server!.once('error', onError);
        this.server!.once('listening', onListening);
        this.server!.listen(listenPort, '127.0.0.1');
      });
    };

    return tryListen(this.port);
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
      const rawBodyBuffer = Buffer.concat(chunks);
      let parsedBody: any = null;
      try {
        parsedBody = JSON.parse(rawBodyBuffer.toString('utf8'));
      } catch (_) {}

      const originalModel = parsedBody?.model || 'gemini-3.8-flash-high';
      const fallbackMgr = new ModelFallbackManager(this.profileManager);

      // Kiểm tra nếu có Model Combo đang kích hoạt trên toàn hệ thống
      const activeCombo = this.profileManager.getActiveSystemCombo();
      let modelCandidates: string[] = [];

      if (activeCombo && activeCombo.models.length > 0) {
        if (activeCombo.strategy === 'smart-routing') {
          const contentsOrMessages = parsedBody?.contents || parsedBody?.messages || [];
          const tools = parsedBody?.tools || [];
          const analysis = SmartRouter.calculateComplexity(contentsOrMessages, tools);
          console.log(`[MitmFastPipe] 🧠 SmartRouter phân tích: isComplex=${analysis.isComplex}, score=${analysis.score} (${analysis.reason})`);
          const prioritized = SmartRouter.prioritizeModels(activeCombo.models, analysis.isComplex);
          
          let orderedModels = prioritized;
          if (activeCombo.activeModel && activeCombo.models.includes(activeCombo.activeModel)) {
            const isChosenSmart = SmartRouter.isSmartModel(activeCombo.activeModel);
            const isChosenFast = SmartRouter.isFastModel(activeCombo.activeModel);
            if ((analysis.isComplex && isChosenSmart) || (!analysis.isComplex && isChosenFast)) {
              orderedModels = [activeCombo.activeModel, ...prioritized.filter(m => m !== activeCombo.activeModel)];
            }
          }
          modelCandidates = Array.from(new Set(orderedModels.map(m => resolveUpstreamModel(m))));
          console.log(`[MitmFastPipe] ⚡ Áp dụng Smart-Routing [${activeCombo.name}]: Model ưu tiên hàng đầu [${orderedModels[0]}] -> ${modelCandidates[0]}`);
        } else {
          const chosen = activeCombo.activeModel || activeCombo.models[0];
          const primaryUpstream = resolveUpstreamModel(chosen);
          const otherUpstreams = activeCombo.models
            .filter((m) => m !== chosen)
            .map((m) => resolveUpstreamModel(m));
          modelCandidates = Array.from(new Set([primaryUpstream, ...otherUpstreams]));
          console.log(`[MitmFastPipe] ⚡ Áp dụng System Combo [${activeCombo.name}]: Model đã chọn [${chosen}] (${primaryUpstream})`);
        }
      } else {
        modelCandidates = fallbackMgr.getUpstreamFallbackChain(originalModel);
      }

      let lastError: any = null;

      for (const targetModel of modelCandidates) {
        let currentBodyBuffer = rawBodyBuffer;
        if (parsedBody && parsedBody.model !== targetModel) {
          const modified = { ...parsedBody, model: targetModel };
          currentBodyBuffer = Buffer.from(JSON.stringify(modified), 'utf8');
          console.log(`[MitmFastPipe] 🚀 Model [${originalModel}] cạn quota trên mọi tài khoản. Tự động chuyển tiếp sang model dự phòng [${targetModel}] cho Antigravity IDE...`);
        }

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
              upstreamHeaders['content-length'] = String(currentBodyBuffer.length);

              const targetHost = 'daily-cloudcode-pa.googleapis.com';
              const targetPath = req.url || '/v1internal:streamGenerateContent';

              // Custom lookup để bỏ qua /etc/hosts (tránh loopback MITM)
              const upstreamLookup = (hostname: string, opts: any, cb?: (err: any, address?: any, family?: number) => void) => {
                const callback = typeof opts === 'function' ? opts : cb;
                const isAll = typeof opts === 'object' && opts?.all;
                const resolver = new dns.Resolver();
                resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
                resolver.resolve4(hostname, (err, addresses) => {
                  if (err || !addresses || addresses.length === 0) {
                    return callback(err || new Error(`Cannot resolve upstream IP for ${hostname}`));
                  }
                  const ip = addresses[Math.floor(Math.random() * addresses.length)];
                  if (isAll) {
                    callback(null, [{ address: ip, family: 4 }]);
                  } else {
                    callback(null, ip, 4);
                  }
                });
              };

              // Gửi thẳng request lên Google Cloud Code upstream (Zero-Translation)
              const proxyReq = https.request(
                {
                  host: targetHost,
                  port: 443,
                  path: targetPath,
                  method: req.method || 'POST',
                  headers: upstreamHeaders,
                  lookup: upstreamLookup as any,
                  agent: new https.Agent({ keepAlive: true, maxSockets: 50 })
                },
                (proxyRes) => {
                  const reqStartTime = Date.now();
                  let promptTokens = 0;
                  let completionTokens = 0;
                  let totalTokens = 0;
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

                  // Thu thập usage telemetry từ SSE chunks không làm chậm pipeline
                  proxyRes.on('data', (chunk: Buffer) => {
                    const str = chunk.toString('utf8');
                    const pMatch = str.match(/"promptTokenCount"\s*:\s*(\d+)/);
                    if (pMatch) promptTokens = parseInt(pMatch[1], 10);
                    const cMatch = str.match(/"candidatesTokenCount"\s*:\s*(\d+)/);
                    if (cMatch) completionTokens = parseInt(cMatch[1], 10);
                    const tMatch = str.match(/"totalTokenCount"\s*:\s*(\d+)/);
                    if (tMatch) totalTokens = parseInt(tMatch[1], 10);
                  });

                  // Pipe trực tiếp data stream từ Google về Antigravity IDE (Zero-Lag)
                  proxyRes.pipe(res);
                  proxyRes.on('end', () => {
                    const latencyMs = Date.now() - reqStartTime;
                    let finalTokens = totalTokens || (promptTokens + completionTokens);
                    if (finalTokens === 0) finalTokens = Math.max(1, Math.round(currentBodyBuffer.length / 4));
                    const displayModel = normalizeDisplayModel(targetModel);

                    usageTracker.record({
                      profile: creds.profile,
                      email: creds.email,
                      model: displayModel,
                      virtualKey: 'direct-link',
                      promptTokens,
                      completionTokens,
                      totalTokens: finalTokens,
                      latencyMs,
                      statusCode,
                      stream: true
                    });
                    this.rotator.recordSuccess(creds.profile, finalTokens);
                    if (activeCombo && activeCombo.strategy === 'smart-routing' && activeCombo.activeModel !== displayModel) {
                      setImmediate(() => {
                        try {
                          this.profileManager.setActiveModelInCombo(activeCombo.id, displayModel);
                        } catch (_) {}
                      });
                    }
                    resolve();
                  });
                }
              );

              proxyReq.on('error', (e) => reject(e));
              proxyReq.end(currentBodyBuffer);
            });
          });

          // Thành công
          return;
        } catch (err: any) {
          lastError = err;
          this.rotator.clearCooldowns();
          console.warn(`[MitmFastPipe] Model [${targetModel}] gặp lỗi/hết quota (${err.status || ''} ${err.message || ''}). Thử model kế tiếp...`);
        }
      }

      if (!res.headersSent) {
        res.writeHead(lastError?.status || 500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: lastError?.message || 'Fast-Pipe upstream error' } }));
    });
  }
}
