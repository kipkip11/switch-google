"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findChromiumExecutable = findChromiumExecutable;
exports.connectCdp = connectCdp;
exports.autoCaptureGeminiWebSession = autoCaptureGeminiWebSession;
const http_1 = __importDefault(require("http"));
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
        candidates.push(path_1.default.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), path_1.default.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path_1.default.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path_1.default.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
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
    // Chọn cổng CDP ngẫu nhiên an toàn (9330-9380)
    const cdpPort = 9330 + Math.floor(Math.random() * 50);
    const tempProfileDir = path_1.default.join(os_1.default.tmpdir(), `switch_google_cdp_${Date.now()}`);
    fs_1.default.mkdirSync(tempProfileDir, { recursive: true });
    let browserProcess = null;
    let cdpClient = null;
    try {
        const startUrl = targetEmail && targetEmail.includes('@')
            ? `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(targetEmail)}&continue=https://gemini.google.com/app`
            : 'https://gemini.google.com/app';
        const launchArgs = [
            `--remote-debugging-port=${cdpPort}`,
            `--user-data-dir=${tempProfileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=1024,768',
            startUrl
        ];
        browserProcess = (0, child_process_1.spawn)(chromePath, launchArgs, {
            detached: false,
            stdio: 'ignore'
        });
        // Chờ CDP server sẵn sàng
        let wsUrl = null;
        const startWait = Date.now();
        while (Date.now() - startWait < 15000) {
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
                    req.setTimeout(1000, () => req.destroy());
                });
                if (json && json.webSocketDebuggerUrl) {
                    wsUrl = json.webSocketDebuggerUrl;
                    break;
                }
            }
            catch (_) {
                await new Promise((r) => setTimeout(r, 400));
            }
        }
        if (!wsUrl) {
            throw new Error(`Không thể kết nối Chrome DevTools Protocol tại cổng ${cdpPort}.`);
        }
        // Kết nối WebSocket CDP qua wrapper tương thích đa phiên bản
        cdpClient = await connectCdp(wsUrl);
        // Bật Network & Storage
        await cdpClient.send('Network.enable');
        // Polling lấy Cookie của gemini.google.com & google.com
        const startTime = Date.now();
        let detectedCookies = {};
        let detectedEmail = '';
        while (Date.now() - startTime < timeoutMs) {
            // 1. Kiểm tra tiến trình browser còn sống không
            if (browserProcess.killed || browserProcess.exitCode !== null) {
                throw new Error('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
            }
            // 2. Lấy toàn bộ cookies
            try {
                const cookiesRes = await cdpClient.send('Network.getAllCookies');
                if (cookiesRes && Array.isArray(cookiesRes.cookies)) {
                    for (const c of cookiesRes.cookies) {
                        if (c.domain.includes('google.com')) {
                            detectedCookies[c.name] = c.value;
                        }
                    }
                }
            }
            catch (_) { }
            // Kiểm tra có các cookie phiên cốt lõi chưa
            const sid = detectedCookies['__Secure-1PSID'] || detectedCookies['SID'];
            if (sid) {
                // Chuẩn hóa chuỗi cookie
                const cookieString = Object.entries(detectedCookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('; ');
                // Thử lấy SNlM0e token xác thực
                try {
                    const snlm0e = await (0, geminiWebClient_1.getSNlM0eToken)(cookieString);
                    if (snlm0e) {
                        // Lấy email thông qua trang account Google nếu có
                        try {
                            const targets = await cdpClient.send('Target.getTargets');
                            const geminiTarget = targets.targetInfos.find((t) => t.url.includes('google.com'));
                            if (geminiTarget && geminiTarget.title) {
                                const emailMatch = geminiTarget.title.match(/([a-zA-Z0-9._%+-]+@gmail\.com)/i);
                                if (emailMatch) {
                                    detectedEmail = emailMatch[1];
                                }
                            }
                        }
                        catch (_) { }
                        if (!detectedEmail) {
                            // Thử lấy email từ myaccount.google.com qua fetch với cookie
                            try {
                                const accRes = await fetch('https://myaccount.google.com/', {
                                    headers: { 'Cookie': cookieString, 'User-Agent': 'Mozilla/5.0' }
                                });
                                const accHtml = await accRes.text();
                                const m = accHtml.match(/([a-zA-Z0-9._%+-]+@gmail\.com)/i);
                                if (m)
                                    detectedEmail = m[1];
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
                            snlm0e
                        };
                    }
                }
                catch (_) {
                    // Chưa đăng nhập xong hoặc chưa vào app, tiếp tục đợi
                }
            }
            await new Promise((r) => setTimeout(r, 1500));
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
                browserProcess.kill('SIGTERM');
            }
        }
        catch (_) { }
        try {
            fs_1.default.rmSync(tempProfileDir, { recursive: true, force: true });
        }
        catch (_) { }
    }
}
