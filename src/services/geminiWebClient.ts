import https from 'https';
import crypto from 'crypto';

/**
 * Driver giao tiếp trực tiếp với Gemini Web (gemini.google.com)
 * Hoàn toàn chạy thông qua hệ thống Switch Google (luân phiên tài khoản, failover, OpenAI proxy)
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Cache lưu SNlM0e & cfb2h token theo cookie
const sessionCache: Map<string, { snlm0e: string; bl: string; expiry: number }> = new Map();

/**
 * Chuẩn hóa chuỗi cookie thành header chuẩn
 */
export function normalizeCookieString(rawCookie: string): string {
  if (!rawCookie) return '';
  return rawCookie
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Tạo chữ ký xác thực SAPISIDHASH theo chuẩn Google Web Authentication
 */
export function getSapisidHash(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-1PAPISID|__Secure-3PAPISID|SAPISID)=([^;]+)/);
  if (!match) return null;
  const sapisid = match[1];
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisid} https://gemini.google.com`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

/**
 * Thực hiện HTTPS request với maxHeaderSize mở rộng (64KB) chống lỗi UND_ERR_HEADERS_OVERFLOW
 */
function requestWithLargeHeader(options: https.RequestOptions, postData?: string): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      ...options,
      maxHeaderSize: 64 * 1024
    };

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error('Request to Gemini Web timed out (60s)'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Trích xuất SNlM0e (token chống CSRF của Gemini Web) và build version (bl)
 */
export async function getSNlM0eToken(cookie: string): Promise<string> {
  const normalized = normalizeCookieString(cookie);
  const cached = sessionCache.get(normalized);
  if (cached && cached.expiry > Date.now()) {
    return cached.snlm0e;
  }

  const res = await requestWithLargeHeader({
    hostname: 'gemini.google.com',
    port: 443,
    path: '/app',
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Cookie': normalized,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
    }
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Không thể kết nối Gemini Web (HTTP ${res.statusCode}). Vui lòng kiểm tra lại Cookie.`);
  }

  const html = res.body;
  const match = html.match(/"SNlM0e":"(.*?)"/) || html.match(/"thykhd":"(.*?)"/);
  const blMatch = html.match(/"cfb2h":"(.*?)"/);
  const bl = (blMatch && blMatch[1]) || 'boq_gemini-web-uiserver_20261118.14_p0';

  if (match && match[1]) {
    const snlm0e = match[1];
    // Cache trong 1 giờ
    sessionCache.set(normalized, { snlm0e, bl, expiry: Date.now() + 3600 * 1000 });
    return snlm0e;
  }

  throw new Error('Không trích xuất được SNlM0e token. Cookie có thể đã hết hạn hoặc không hợp lệ.');
}

/**
 * Đóng gói payload f.req theo chuẩn Google StreamGenerate (102 slots mảng RPC)
 */
function buildFReqPayload(prompt: string, model: string): string {
  const inner: any[] = Array(102).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ['vi'];
  inner[2] = ['', '', '', null, null, null, null, null, null, ''];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  // Think mode: 4 cho fast/flash, 0 cho thinking/pro
  const isPro = model.includes('pro') || model.includes('opus') || model.includes('argon');
  inner[17] = [[isPro ? 0 : 4]];
  inner[30] = [4];
  inner[41] = [2];
  inner[59] = crypto.randomUUID();
  inner[68] = 1;
  inner[79] = isPro ? 2 : 1; // 1: Flash, 2: Pro

  return JSON.stringify([null, JSON.stringify(inner)]);
}

/**
 * Trích xuất text trả lời từ response chunk của Gemini Web Batchexecute RPC
 */
export function parseGeminiWebResponse(rawText: string): string {
  let cleanText = rawText.replace(/^\)]\}\x27\s*/, '');
  let lastAnswer = '';

  // Trích xuất các khối wrb.fr
  const wrbMatches = cleanText.matchAll(/\[\["wrb\.fr",null,"(.*?)(?<!\\)"/gs);
  for (const m of wrbMatches) {
    try {
      const unescaped = JSON.parse(`"${m[1]}"`);
      const inner = JSON.parse(unescaped);
      if (inner && Array.isArray(inner[4]) && inner[4][0] && Array.isArray(inner[4][0][1])) {
        const txt = inner[4][0][1][0];
        if (txt && typeof txt === 'string') {
          lastAnswer = txt;
        }
      }
    } catch (_) {}
  }

  if (lastAnswer) return lastAnswer;

  // Fallback 1: Trích xuất qua mã khối rc_
  const rcMatch = cleanText.match(/\["rc_[^"]+",\["([^"]+)"/);
  if (rcMatch && rcMatch[1]) {
    return rcMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }

  // Fallback 2: Duyệt từng dòng JSON
  const lines = cleanText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes('wrb.fr')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item[0] === 'wrb.fr' && typeof item[2] === 'string') {
            const inner = JSON.parse(item[2]);
            if (inner && Array.isArray(inner[4]) && inner[4][0] && Array.isArray(inner[4][0][1])) {
              const text = inner[4][0][1][0];
              if (text && typeof text === 'string') {
                lastAnswer = text;
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  if (lastAnswer) return lastAnswer;

  return cleanText.length > 300 ? cleanText.slice(0, 300) : cleanText;
}

/**
 * Gửi prompt tới Gemini Web qua Session Cookie
 */
export async function generateContentGeminiWeb(
  cookies: string,
  prompt: string,
  model = 'gemini-2.5-flash'
): Promise<string> {
  const normalized = normalizeCookieString(cookies);
  const token = await getSNlM0eToken(normalized);
  const cached = sessionCache.get(normalized);
  const bl = cached?.bl || 'boq_gemini-web-uiserver_20261118.14_p0';

  const fReq = buildFReqPayload(prompt, model);

  const params = new URLSearchParams();
  params.set('at', token);
  params.set('f.req', fReq);
  const postData = params.toString();

  const reqId = Math.floor(Math.random() * 90000) + 10000;
  const path = `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${encodeURIComponent(bl)}&hl=vi&_reqid=${reqId}&rt=c`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    'Host': 'gemini.google.com',
    'Origin': 'https://gemini.google.com',
    'Referer': 'https://gemini.google.com/',
    'User-Agent': USER_AGENT,
    'Cookie': normalized,
    'x-same-domain': '1',
    'Content-Length': String(Buffer.byteLength(postData))
  };

  const authHeader = getSapisidHash(normalized);
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const res = await requestWithLargeHeader({
    hostname: 'gemini.google.com',
    port: 443,
    path,
    method: 'POST',
    headers
  }, postData);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err: any = new Error(`Gemini Web HTTP ${res.statusCode}: ${res.body.slice(0, 150)}`);
    err.status = res.statusCode;
    throw err;
  }

  return parseGeminiWebResponse(res.body);
}
