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
exports.findChromiumExecutable = findChromiumExecutable;
exports.connectCdp = connectCdp;
exports.getFreePort = getFreePort;
exports.isCdpAlive = isCdpAlive;
exports.autoCaptureGeminiWebSession = autoCaptureGeminiWebSession;
const http_1 = __importDefault(require("http"));
const net_1 = __importDefault(require("net"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const geminiWebClient_1 = require("./geminiWebClient");
/**
 * Tìm đường dẫn thực thi của trình duyệt nhân Chromium trên hệ thống
 */
function findChromiumExecutable() {
    const platform = os_1.default.platform();
    const candidates = [];
    if (platform === 'darwin') {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path_1.default.join(os_1.default.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    }
    else if (platform === 'win32') {
        const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env['LOCALAPPDATA'] || path_1.default.join(os_1.default.homedir(), 'AppData', 'Local');
        candidates.push(path_1.default.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path_1.default.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path_1.default.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path_1.default.join(localAppData, 'CocCoc', 'Browser', 'Application', 'browser.exe'), path_1.default.join(progFiles, 'CocCoc', 'Browser', 'Application', 'browser.exe'), path_1.default.join(progFilesX86, 'CocCoc', 'Browser', 'Application', 'browser.exe'), path_1.default.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path_1.default.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    }
    else {
        candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium');
    }
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * Tạo kết nối CDP an toàn tương thích mọi phiên bản Node.js (Node 20, 22, 24+)
 */
async function connectCdp(wsUrl) {
    if (typeof globalThis.WebSocket !== 'undefined') {
        const WS = globalThis.WebSocket;
        const ws = new WS(wsUrl);
        await new Promise((res, rej) => {
            ws.onopen = () => res(true);
            ws.onerror = (e) => rej(new Error('WebSocket connection failed: ' + (e?.message || e?.type || 'error')));
            ws.onclose = (e) => {
                if (e.code !== 1000) {
                    rej(new Error(`WebSocket closed unexpectedly with code ${e.code}`));
                }
            };
        });
        let msgId = 1;
        return {
            send(method, params = {}) {
                return new Promise((resolve) => {
                    const curId = msgId++;
                    const handler = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.id === curId) {
                                ws.removeEventListener('message', handler);
                                resolve(data.result);
                            }
                        }
                        catch (_) { }
                    };
                    ws.addEventListener('message', handler);
                    ws.send(JSON.stringify({ id: curId, method, params }));
                });
            },
            close() {
                try {
                    ws.close();
                }
                catch (_) { }
            }
        };
    }
    // Fallback thuần HTTP Upgrade WebSocket cho môi trường Node 20.x
    const parsed = new URL(wsUrl);
    const secKey = crypto_1.default.randomBytes(16).toString('base64');
    return new Promise((resolve, reject) => {
        const req = http_1.default.request({
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
            const callbacks = new Map();
            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= 2) {
                    const firstByte = buffer[0];
                    const secondByte = buffer[1];
                    const isMasked = (secondByte & 0x80) !== 0;
                    let payloadLen = secondByte & 0x7f;
                    let headerLen = 2;
                    if (payloadLen === 126) {
                        if (buffer.length < 4)
                            break;
                        payloadLen = buffer.readUInt16BE(2);
                        headerLen = 4;
                    }
                    else if (payloadLen === 127) {
                        if (buffer.length < 10)
                            break;
                        payloadLen = Number(buffer.readBigUInt64BE(2));
                        headerLen = 10;
                    }
                    if (isMasked)
                        headerLen += 4;
                    if (buffer.length < headerLen + payloadLen)
                        break;
                    let payload = buffer.subarray(headerLen, headerLen + payloadLen);
                    if (isMasked) {
                        const mask = buffer.subarray(headerLen - 4, headerLen);
                        const unmasked = Buffer.alloc(payloadLen);
                        for (let i = 0; i < payloadLen; i++)
                            unmasked[i] = payload[i] ^ mask[i % 4];
                        payload = unmasked;
                    }
                    buffer = buffer.subarray(headerLen + payloadLen);
                    const opcode = firstByte & 0x0f;
                    if (opcode === 0x1) {
                        try {
                            const parsedData = JSON.parse(payload.toString('utf8'));
                            if (parsedData.id && callbacks.has(parsedData.id)) {
                                const cb = callbacks.get(parsedData.id);
                                callbacks.delete(parsedData.id);
                                cb(parsedData.result);
                            }
                        }
                        catch (_) { }
                    }
                }
            });
            resolve({
                send(method, params = {}) {
                    return new Promise((resCb) => {
                        const curId = msgId++;
                        callbacks.set(curId, resCb);
                        const msg = JSON.stringify({ id: curId, method, params });
                        const payloadBuf = Buffer.from(msg, 'utf8');
                        const mask = crypto_1.default.randomBytes(4);
                        let header;
                        if (payloadBuf.length < 126) {
                            header = Buffer.alloc(6);
                            header[0] = 0x81;
                            header[1] = 0x80 | payloadBuf.length;
                            mask.copy(header, 2);
                        }
                        else if (payloadBuf.length <= 65535) {
                            header = Buffer.alloc(8);
                            header[0] = 0x81;
                            header[1] = 0x80 | 126;
                            header.writeUInt16BE(payloadBuf.length, 2);
                            mask.copy(header, 4);
                        }
                        else {
                            header = Buffer.alloc(14);
                            header[0] = 0x81;
                            header[1] = 0x80 | 127;
                            header.writeBigUInt64BE(BigInt(payloadBuf.length), 2);
                            mask.copy(header, 10);
                        }
                        const maskedBuf = Buffer.alloc(payloadBuf.length);
                        for (let i = 0; i < payloadBuf.length; i++)
                            maskedBuf[i] = payloadBuf[i] ^ mask[i % 4];
                        socket.write(Buffer.concat([header, maskedBuf]));
                    });
                },
                close() {
                    try {
                        socket.destroy();
                    }
                    catch (_) { }
                }
            });
        });
        req.end();
    });
}
/**
 * Tìm cổng còn trống an toàn trên localhost (127.0.0.1) được cấp phát động bởi OS
 */
async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net_1.default.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}
/**
 * Kiểm tra cổng CDP của Chrome còn đang phản hồi hay không
 */
async function isCdpAlive(port) {
    return new Promise((resolve) => {
        const req = http_1.default.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(800, () => {
            req.destroy();
            resolve(false);
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
async function autoCaptureGeminiWebSession(timeoutMs = 180000, targetEmail) {
    const chromePath = findChromiumExecutable();
    if (!chromePath) {
        throw new Error('Không tìm thấy Google Chrome hoặc trình duyệt Chromium trên máy để tự động đăng nhập.');
    }
    // Sử dụng thư mục tạm riêng biệt, đảm bảo môi trường Chromium hoàn toàn độc lập
    const tempProfileDir = path_1.default.join(os_1.default.tmpdir(), `switch_google_cdp_${Date.now()}`);
    fs_1.default.mkdirSync(tempProfileDir, { recursive: true });
    let browserProcess = null;
    let cdpClient = null;
    let cdpPort = 0;
    try {
        const startUrl = targetEmail && targetEmail.includes('@')
            ? `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(targetEmail)}&continue=https://gemini.google.com/app`
            : 'https://gemini.google.com/app';
        // Khởi chạy với --remote-debugging-port=0 (chuẩn Puppeteer/Chromium)
        // Cấp phát cổng động an toàn trực tiếp từ Chromium, tránh triệt để lỗi WSAEADDRINUSE / TIME_WAIT trên Windows
        const launchArgs = [
            '--remote-debugging-port=0',
            `--user-data-dir=${tempProfileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--window-position=120,80',
            '--window-size=1100,800',
            startUrl
        ];
        let spawnError = null;
        browserProcess = (0, child_process_1.spawn)(chromePath, launchArgs, {
            detached: false,
            stdio: 'ignore'
        });
        browserProcess.on('error', (err) => {
            spawnError = err;
        });
        if (os_1.default.platform() === 'darwin') {
            try {
                const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
                exec('osascript -e \'tell application "Google Chrome" to activate\'');
            }
            catch (_) { }
        }
        // Chờ CDP server sẵn sàng: Đọc trực tiếp cổng và wsUrl từ file DevToolsActivePort được Chromium tạo tự động
        let wsUrl = null;
        const activePortFile = path_1.default.join(tempProfileDir, 'DevToolsActivePort');
        const startWait = Date.now();
        while (Date.now() - startWait < 15000) {
            if (spawnError) {
                throw new Error(`Không thể khởi động trình duyệt: ${spawnError?.message || spawnError}`);
            }
            // 1. Đọc file DevToolsActivePort do chính Chromium ghi ra khi bind thành công
            if (fs_1.default.existsSync(activePortFile)) {
                try {
                    const content = fs_1.default.readFileSync(activePortFile, 'utf8').trim().split('\n');
                    const portNum = parseInt(content[0], 10);
                    const wsPath = (content[1] || '').trim();
                    if (portNum > 0 && wsPath) {
                        cdpPort = portNum;
                        wsUrl = `ws://127.0.0.1:${portNum}${wsPath}`;
                        break;
                    }
                }
                catch (_) { }
            }
            // 2. Dự phòng: Thăm dò endpoint HTTP nếu cdpPort đã được xác định
            if (cdpPort > 0 && !wsUrl) {
                try {
                    const json = await new Promise((resolve, reject) => {
                        const req = http_1.default.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
                            let data = '';
                            res.on('data', (d) => (data += d));
                            res.on('end', () => {
                                try {
                                    resolve(JSON.parse(data));
                                }
                                catch (e) {
                                    reject(e);
                                }
                            });
                        });
                        req.on('error', reject);
                        req.setTimeout(800, () => req.destroy());
                    });
                    if (json && json.webSocketDebuggerUrl) {
                        wsUrl = json.webSocketDebuggerUrl;
                        break;
                    }
                }
                catch (_) { }
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        if (!wsUrl || cdpPort === 0) {
            if (browserProcess.exitCode !== null && browserProcess.exitCode !== 0) {
                throw new Error(`Trình duyệt kết thúc bất thường với mã lỗi ${browserProcess.exitCode}. Vui lòng kiểm tra quyền hạn.`);
            }
            throw new Error(`Không thể kết nối Chrome DevTools Protocol (quá thời gian chờ 15s).`);
        }
        // Kết nối WebSocket CDP qua wrapper tương thích đa phiên bản
        cdpClient = await connectCdp(wsUrl);
        // Bật Network & Storage nếu hỗ trợ
        try {
            await cdpClient.send('Storage.enable');
        }
        catch (_) { }
        try {
            await cdpClient.send('Network.enable');
        }
        catch (_) { }
        // Polling lấy Cookie của gemini.google.com & google.com
        const startTime = Date.now();
        let detectedCookies = {};
        let detectedEmail = '';
        while (Date.now() - startTime < timeoutMs) {
            // 1. Kiểm tra tiến trình browser còn sống không
            // Trên Windows, launcher process thường tự exit với code 0 nhưng Chrome vẫn chạy ngầm qua CDP port.
            // Chỉ coi là đã đóng nếu không còn kết nối được tới CDP port.
            if (browserProcess.killed) {
                throw new Error('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
            }
            if (browserProcess.exitCode !== null) {
                const cdpStillAlive = await isCdpAlive(cdpPort);
                if (!cdpStillAlive) {
                    throw new Error('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
                }
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
            }
            catch (_) {
                try {
                    const cookiesRes = await cdpClient.send('Network.getAllCookies');
                    if (cookiesRes && Array.isArray(cookiesRes.cookies)) {
                        for (const c of cookiesRes.cookies) {
                            if (c.domain && (c.domain.includes('google.com') || c.domain.includes('google'))) {
                                detectedCookies[c.name] = c.value;
                            }
                        }
                    }
                }
                catch (_) { }
            }
            // 3. Phương thức 1 (Tối ưu nhất): Đọc trực tiếp SNlM0e token, Email và Cookie từ tab Gemini đang mở
            let inPageSn = '';
            let isGeminiUrlActive = false;
            try {
                const pageTargets = await new Promise((resTargets) => {
                    const req = http_1.default.get(`http://127.0.0.1:${cdpPort}/json/list`, (res) => {
                        let data = '';
                        res.on('data', (d) => (data += d));
                        res.on('end', () => {
                            try {
                                resTargets(JSON.parse(data));
                            }
                            catch (_) {
                                resTargets([]);
                            }
                        });
                    });
                    req.on('error', () => resTargets([]));
                    req.setTimeout(800, () => req.destroy());
                });
                const geminiTab = pageTargets.find((t) => t.type === 'page' && t.url && t.url.includes('gemini.google.com'));
                if (geminiTab) {
                    isGeminiUrlActive = true;
                }
                if (geminiTab && geminiTab.webSocketDebuggerUrl) {
                    let pageCdp = null;
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
                        }
                        catch (_) { }
                        const evalRes = await pageCdp.send('Runtime.evaluate', {
                            expression: `(() => {
                try {
                  const wiz = (window && window.WIZ_global_data) || {};
                  let sn = wiz.SNlM0e || "";
                  if (!sn) {
                    const scripts = document.querySelectorAll('script');
                    for (const s of scripts) {
                      const text = s.textContent || "";
                      if (text.includes('SNlM0e') || text.includes('thykhd')) {
                        const m = text.match(/"SNlM0e":"(.*?)"/) || text.match(/"thykhd":"(.*?)"/);
                        if (m && m[1]) { sn = m[1]; break; }
                      }
                    }
                  }

                  let email = "";
                  try {
                    const accountBtn = document.querySelector('button[aria-label*="@"], a[aria-label*="@"], [data-email], img[alt*="@"]');
                    if (accountBtn) {
                      const rawText = accountBtn.getAttribute('aria-label') || accountBtn.getAttribute('data-email') || accountBtn.getAttribute('alt') || '';
                      const m = rawText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/i);
                      if (m) email = m[1];
                    }
                    if (!email) {
                      const scripts = document.querySelectorAll('script');
                      for (const s of scripts) {
                        const text = s.textContent || "";
                        if (text.includes('@gmail.com') || text.includes('@googlemail.com')) {
                          const m = text.match(/([a-zA-Z0-9._%+-]+@(gmail|googlemail)\\.[a-zA-Z]{2,})/i);
                          if (m && m[1]) { email = m[1]; break; }
                        }
                      }
                    }
                  } catch (_) {}

                  return JSON.stringify({ sn, email, url: window.location.href, docCookie: document.cookie || "" });
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
                            if (info && info.docCookie) {
                                const parts = info.docCookie.split(';');
                                for (const p of parts) {
                                    const eq = p.indexOf('=');
                                    if (eq > 0) {
                                        const k = p.slice(0, eq).trim();
                                        const v = p.slice(eq + 1).trim();
                                        if (k && v)
                                            detectedCookies[k] = v;
                                    }
                                }
                            }
                        }
                    }
                    catch (_) {
                    }
                    finally {
                        if (pageCdp) {
                            try {
                                pageCdp.close();
                            }
                            catch (_) { }
                        }
                    }
                }
            }
            catch (_) { }
            // 4. Kiểm tra điều kiện hoàn tất phiên (Session Completion Gate):
            // - Đã có SID hoặc __Secure-1PSID hoặc __Secure-3PSID
            // - Đã điều hướng vào gemini.google.com
            // - Đã lấy được SNlM0e HOẶC đã có __Secure-1PSIDTS
            const sid = detectedCookies['__Secure-1PSID'] || detectedCookies['__Secure-3PSID'] || detectedCookies['SID'];
            const sidts = detectedCookies['__Secure-1PSIDTS'] || detectedCookies['__Secure-3PSIDTS'];
            if (sid && (isGeminiUrlActive || sidts || inPageSn)) {
                // Chuẩn hóa chuỗi cookie
                const cookieString = Object.entries(detectedCookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('; ');
                let finalSnlm0e = inPageSn;
                // Nếu trong trang chưa lấy được, thử fallback qua getSNlM0eToken
                if (!finalSnlm0e) {
                    try {
                        finalSnlm0e = await (0, geminiWebClient_1.getSNlM0eToken)(cookieString);
                    }
                    catch (_) { }
                }
                // Nếu đã có SNlM0e hoặc có cả SIDTS, hoặc đã ở trên trang gemini.google.com
                if (finalSnlm0e || sidts || isGeminiUrlActive) {
                    // Lấy email thông qua trang account Google nếu chưa có
                    if (!detectedEmail) {
                        try {
                            const targets = await cdpClient.send('Target.getTargets');
                            if (targets && Array.isArray(targets.targetInfos)) {
                                const geminiTarget = targets.targetInfos.find((t) => t.url && t.url.includes('google.com'));
                                if (geminiTarget && geminiTarget.title) {
                                    const emailMatch = geminiTarget.title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                                    if (emailMatch) {
                                        detectedEmail = emailMatch[1];
                                    }
                                }
                            }
                        }
                        catch (_) { }
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
    }
    finally {
        // Dọn dẹp an toàn
        try {
            if (cdpClient)
                cdpClient.close();
        }
        catch (_) { }
        try {
            if (browserProcess && !browserProcess.killed) {
                if (process.platform === 'win32' && browserProcess.pid) {
                    try {
                        (0, child_process_1.execSync)(`taskkill /F /T /PID ${browserProcess.pid}`, { windowsHide: true, stdio: 'ignore' });
                    }
                    catch (_) { }
                }
                browserProcess.kill('SIGTERM');
            }
        }
        catch (_) { }
        const cleanupTempDir = () => {
            try {
                if (fs_1.default.existsSync(tempProfileDir)) {
                    fs_1.default.rmSync(tempProfileDir, { recursive: true, force: true });
                }
            }
            catch (_) { }
        };
        cleanupTempDir();
        if (process.platform === 'win32') {
            setTimeout(cleanupTempDir, 1500).unref();
        }
    }
}
