import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { normalizeCookieString, getSNlM0eToken } from './geminiWebClient';

export interface WebAuthResult {
  email: string;
  cookies: string;
  snlm0e: string;
}

export interface CdpClient {
  send(method: string, params?: any): Promise<any>;
  close(): void;
}

/**
 * Tìm đường dẫn thực thi của trình duyệt nhân Chromium trên hệ thống
 */
export function findChromiumExecutable(): string | null {
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );
  } else if (platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');

    candidates.push(
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Tạo kết nối CDP an toàn tương thích mọi phiên bản Node.js (Node 20, 22, 24+)
 */
export async function connectCdp(wsUrl: string): Promise<CdpClient> {
  if (typeof (globalThis as any).WebSocket !== 'undefined') {
    const WS = (globalThis as any).WebSocket;
    const ws = new WS(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = () => res(true);
      ws.onerror = (e: any) => rej(new Error('WebSocket connection failed: ' + (e?.message || e?.type || 'error')));
      ws.onclose = (e: any) => {
        if (e.code !== 1000) {
          rej(new Error(`WebSocket closed unexpectedly with code ${e.code}`));
        }
      };
    });

    let msgId = 1;
    return {
      send(method: string, params: any = {}) {
        return new Promise((resolve) => {
          const curId = msgId++;
          const handler = (event: any) => {
            try {
              const data = JSON.parse(event.data);
              if (data.id === curId) {
                ws.removeEventListener('message', handler);
                resolve(data.result);
              }
            } catch (_) {}
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id: curId, method, params }));
        });
      },
      close() {
        try {
          ws.close();
        } catch (_) {}
      }
    };
  }

  // Fallback thuần HTTP Upgrade WebSocket cho môi trường Node 20.x
  const parsed = new URL(wsUrl);
  const secKey = crypto.randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': secKey,
        'Sec-WebSocket-Version': '13'
      }
    });

    req.on('error', reject);
    req.on('upgrade', (_res, socket) => {
      let buffer = Buffer.alloc(0);
      let msgId = 1;
      const callbacks = new Map<number, (res: any) => void>();

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const firstByte = buffer[0];
          const secondByte = buffer[1];
          const isMasked = (secondByte & 0x80) !== 0;
          let payloadLen = secondByte & 0x7f;
          let headerLen = 2;
          if (payloadLen === 126) {
            if (buffer.length < 4) break;
            payloadLen = buffer.readUInt16BE(2);
            headerLen = 4;
          } else if (payloadLen === 127) {
            if (buffer.length < 10) break;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            headerLen = 10;
          }
          if (isMasked) headerLen += 4;
          if (buffer.length < headerLen + payloadLen) break;

          let payload = buffer.subarray(headerLen, headerLen + payloadLen);
          if (isMasked) {
            const mask = buffer.subarray(headerLen - 4, headerLen);
            const unmasked = Buffer.alloc(payloadLen);
            for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i % 4];
            payload = unmasked;
          }
          buffer = buffer.subarray(headerLen + payloadLen);

          const opcode = firstByte & 0x0f;
          if (opcode === 0x1) {
            try {
              const parsedData = JSON.parse(payload.toString('utf8'));
              if (parsedData.id && callbacks.has(parsedData.id)) {
                const cb = callbacks.get(parsedData.id)!;
                callbacks.delete(parsedData.id);
                cb(parsedData.result);
              }
            } catch (_) {}
          }
        }
      });

      resolve({
        send(method: string, params: any = {}) {
          return new Promise((resCb) => {
            const curId = msgId++;
            callbacks.set(curId, resCb);
            const msg = JSON.stringify({ id: curId, method, params });
            const payloadBuf = Buffer.from(msg, 'utf8');
            const mask = crypto.randomBytes(4);
            let header: Buffer;
            if (payloadBuf.length < 126) {
              header = Buffer.alloc(6);
              header[0] = 0x81;
              header[1] = 0x80 | payloadBuf.length;
              mask.copy(header, 2);
            } else if (payloadBuf.length <= 65535) {
              header = Buffer.alloc(8);
              header[0] = 0x81;
              header[1] = 0x80 | 126;
              header.writeUInt16BE(payloadBuf.length, 2);
              mask.copy(header, 4);
            } else {
              header = Buffer.alloc(14);
              header[0] = 0x81;
              header[1] = 0x80 | 127;
              header.writeBigUInt64BE(BigInt(payloadBuf.length), 2);
              mask.copy(header, 10);
            }
            const maskedBuf = Buffer.alloc(payloadBuf.length);
            for (let i = 0; i < payloadBuf.length; i++) maskedBuf[i] = payloadBuf[i] ^ mask[i % 4];
            socket.write(Buffer.concat([header, maskedBuf]));
          });
        },
        close() {
          try {
            socket.destroy();
          } catch (_) {}
        }
      });
    });

    req.end();
  });
}

/**
 * Tìm cổng còn trống an toàn trên localhost (127.0.0.1) được cấp phát động bởi OS
 */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Đăng nhập tự động vào Gemini Web qua Chrome CDP:
 * 1. Khởi chạy Chrome với isolate data-dir và mở cổng CDP
 * 2. Mở sẵn trang gemini.google.com để người dùng đăng nhập bằng Google
 * 3. Tự động lắng nghe Cookie `__Secure-1PSID` và `__Secure-1PSIDTS`
 * 4. Tự động lấy email và xác thực SNlM0e token
 * 5. Tự đóng browser và trả về WebAuthResult
 */
export async function autoCaptureGeminiWebSession(timeoutMs = 180000, targetEmail?: string): Promise<WebAuthResult> {
  const chromePath = findChromiumExecutable();
  if (!chromePath) {
    throw new Error('Không tìm thấy Google Chrome hoặc trình duyệt Chromium trên máy để tự động đăng nhập.');
  }

  // Cấp phát cổng CDP độc lập, đảm bảo 100% không trùng với tiến trình khác
  const cdpPort = await getFreePort();
  const tempProfileDir = path.join(os.tmpdir(), `switch_google_cdp_${Date.now()}`);
  fs.mkdirSync(tempProfileDir, { recursive: true });

  let browserProcess: ChildProcess | null = null;
  let cdpClient: CdpClient | null = null;

  try {
    const startUrl = targetEmail && targetEmail.includes('@')
      ? `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(targetEmail)}&continue=https://gemini.google.com/app`
      : 'https://gemini.google.com/app';

    const launchArgs = [
      `--remote-debugging-port=${cdpPort}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${tempProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=120,80',
      '--window-size=1100,800',
      startUrl
    ];

    browserProcess = spawn(chromePath, launchArgs, {
      detached: false,
      stdio: 'ignore'
    });

    if (os.platform() === 'darwin') {
      try {
        const { exec } = await import('child_process');
        exec('osascript -e \'tell application "Google Chrome" to activate\'');
      } catch (_) {}
    }

    // Chờ CDP server sẵn sàng
    let wsUrl: string | null = null;
    const startWait = Date.now();
    while (Date.now() - startWait < 15000) {
      try {
        const json: any = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(1000, () => req.destroy());
        });

        if (json && json.webSocketDebuggerUrl) {
          wsUrl = json.webSocketDebuggerUrl;
          break;
        }
      } catch (_) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    if (!wsUrl) {
      throw new Error(`Không thể kết nối Chrome DevTools Protocol tại cổng ${cdpPort}.`);
    }

    // Kết nối WebSocket CDP qua wrapper tương thích đa phiên bản
    cdpClient = await connectCdp(wsUrl);

    // Bật Network & Storage nếu hỗ trợ
    try {
      await cdpClient.send('Storage.enable');
    } catch (_) {}
    try {
      await cdpClient.send('Network.enable');
    } catch (_) {}

    // Polling lấy Cookie của gemini.google.com & google.com
    const startTime = Date.now();
    let detectedCookies: { [k: string]: string } = {};
    let detectedEmail = '';

    while (Date.now() - startTime < timeoutMs) {
      // 1. Kiểm tra tiến trình browser còn sống không
      if (browserProcess.killed || browserProcess.exitCode !== null) {
        throw new Error('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
      }

      // 2. Lấy toàn bộ cookies từ Chrome CDP (Sử dụng Storage.getCookies chuẩn trên Browser Target, fallback Network.getAllCookies)
      try {
        const storageRes = await cdpClient.send('Storage.getCookies');
        if (storageRes && Array.isArray(storageRes.cookies)) {
          for (const c of storageRes.cookies) {
            if (c.domain && (c.domain.includes('google.com') || c.domain.includes('google'))) {
              detectedCookies[c.name] = c.value;
            }
          }
        }
      } catch (_) {
        try {
          const cookiesRes = await cdpClient.send('Network.getAllCookies');
          if (cookiesRes && Array.isArray(cookiesRes.cookies)) {
            for (const c of cookiesRes.cookies) {
              if (c.domain && (c.domain.includes('google.com') || c.domain.includes('google'))) {
                detectedCookies[c.name] = c.value;
              }
            }
          }
        } catch (_) {}
      }

      // 3. Phương thức 1 (Tối ưu nhất): Đọc trực tiếp SNlM0e token, Email và Cookie từ tab Gemini đang mở
      let inPageSn = '';
      let isGeminiUrlActive = false;
      try {
        const pageTargets: any[] = await new Promise((resTargets) => {
          const req = http.get(`http://127.0.0.1:${cdpPort}/json/list`, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => {
              try {
                resTargets(JSON.parse(data));
              } catch (_) {
                resTargets([]);
              }
            });
          });
          req.on('error', () => resTargets([]));
          req.setTimeout(800, () => req.destroy());
        });

        const geminiTab = pageTargets.find(
          (t: any) => t.type === 'page' && t.url && t.url.includes('gemini.google.com')
        );

        if (geminiTab) {
          isGeminiUrlActive = true;
        }

        if (geminiTab && geminiTab.webSocketDebuggerUrl) {
          let pageCdp: CdpClient | null = null;
          try {
            pageCdp = await connectCdp(geminiTab.webSocketDebuggerUrl);

            // Bổ sung đọc cookies từ Page Target để dự phòng tối đa
            try {
              const pageCookies = await pageCdp.send('Network.getCookies', {
                urls: ['https://gemini.google.com', 'https://accounts.google.com', 'https://google.com']
              });
              if (pageCookies && Array.isArray(pageCookies.cookies)) {
                for (const c of pageCookies.cookies) {
                  if (c.domain && (c.domain.includes('google.com') || c.domain.includes('google'))) {
                    detectedCookies[c.name] = c.value;
                  }
                }
              }
            } catch (_) {}

            const evalRes = await pageCdp.send('Runtime.evaluate', {
              expression: `(() => {
                try {
                  const wiz = (window && window.WIZ_global_data) || {};
                  const html = (document.documentElement && document.documentElement.innerHTML) || (document.body && document.body.innerHTML) || "";
                  const sn = wiz.SNlM0e || (html.match(/"SNlM0e":"(.*?)"/) || [])[1] || (html.match(/"thykhd":"(.*?)"/) || [])[1] || "";
                  let email = "";
                  try {
                    const m = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/i);
                    if (m) email = m[1];
                  } catch (_) {}
                  return JSON.stringify({ sn, email, url: window.location.href });
                } catch (e) {
                  return JSON.stringify({ error: e.message });
                }
              })()`,
              returnByValue: true
            });

            if (evalRes && evalRes.result && evalRes.result.value) {
              const info = JSON.parse(evalRes.result.value);
              if (info && info.sn) {
                inPageSn = info.sn;
              }
              if (info && info.email && !detectedEmail) {
                detectedEmail = info.email;
              }
            }
          } catch (_) {
          } finally {
            if (pageCdp) {
              try { pageCdp.close(); } catch (_) {}
            }
          }
        }
      } catch (_) {}

      // 4. Kiểm tra điều kiện hoàn tất phiên (Session Completion Gate):
      // - Đã có SID hoặc __Secure-1PSID
      // - Đã điều hướng vào gemini.google.com
      // - Đã lấy được SNlM0e HOẶC đã có __Secure-1PSIDTS
      const sid = detectedCookies['__Secure-1PSID'] || detectedCookies['SID'];
      const sidts = detectedCookies['__Secure-1PSIDTS'];

      if (sid && (isGeminiUrlActive || sidts || inPageSn)) {
        // Chuẩn hóa chuỗi cookie
        const cookieString = Object.entries(detectedCookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');

        let finalSnlm0e = inPageSn;

        // Nếu trong trang chưa lấy được, thử fallback qua getSNlM0eToken
        if (!finalSnlm0e) {
          try {
            finalSnlm0e = await getSNlM0eToken(cookieString);
          } catch (_) {}
        }

        // Nếu đã có SNlM0e hoặc có cả SIDTS, hoặc đã ở trên trang gemini.google.com
        if (finalSnlm0e || sidts || isGeminiUrlActive) {
          // Lấy email thông qua trang account Google nếu chưa có
          if (!detectedEmail) {
            try {
              const targets = await cdpClient.send('Target.getTargets');
              if (targets && Array.isArray(targets.targetInfos)) {
                const geminiTarget = targets.targetInfos.find((t: any) => t.url && t.url.includes('google.com'));
                if (geminiTarget && geminiTarget.title) {
                  const emailMatch = geminiTarget.title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                  if (emailMatch) {
                    detectedEmail = emailMatch[1];
                  }
                }
              }
            } catch (_) {}
          }

          if (!detectedEmail && targetEmail) {
            detectedEmail = targetEmail;
          }
          if (!detectedEmail) {
            detectedEmail = `gemini-web-${Date.now().toString(36)}@gmail.com`;
          }

          return {
            email: detectedEmail,
            cookies: cookieString,
            snlm0e: finalSnlm0e || ''
          };
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error('Hết thời gian chờ đăng nhập Google Gemini (3 phút). Vui lòng thử lại.');
  } finally {
    // Dọn dẹp an toàn
    try {
      if (cdpClient) cdpClient.close();
    } catch (_) {}
    try {
      if (browserProcess && !browserProcess.killed) {
        browserProcess.kill('SIGTERM');
      }
    } catch (_) {}
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch (_) {}
  }
}
