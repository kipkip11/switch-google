"use strict";
/**
 * Driver giao tiếp trực tiếp với Gemini Web (gemini.google.com)
 * Hoàn toàn chạy thông qua hệ thống Switch Google (luân phiên tài khoản, failover, OpenAI proxy)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCookieString = normalizeCookieString;
exports.getSNlM0eToken = getSNlM0eToken;
exports.parseGeminiWebResponse = parseGeminiWebResponse;
exports.generateContentGeminiWeb = generateContentGeminiWeb;
const GEMINI_APP_URL = 'https://gemini.google.com/app';
const GEMINI_STREAM_URL = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MODEL_HEADERS = {
    'gemini-3.1-pro': '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
    'gemini-2.5-pro': '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    'gemini-2.5-flash': '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
    'gemini-1.5-pro': '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    'gemini-1.5-flash': '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};
// Cache lưu SNlM0e token theo cookie để không phải fetch lại liên tục
const snlm0eCache = new Map();
/**
 * Chuẩn hóa chuỗi cookie thành header chuẩn
 */
function normalizeCookieString(rawCookie) {
    if (!rawCookie)
        return '';
    return rawCookie
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .join('; ');
}
/**
 * Trích xuất SNlM0e (token chống CSRF của Gemini Web)
 */
async function getSNlM0eToken(cookie) {
    const normalized = normalizeCookieString(cookie);
    const cached = snlm0eCache.get(normalized);
    if (cached && cached.expiry > Date.now()) {
        return cached.token;
    }
    const res = await fetch(GEMINI_APP_URL, {
        method: 'GET',
        headers: {
            'User-Agent': USER_AGENT,
            'Cookie': normalized,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
        }
    });
    if (!res.ok) {
        throw new Error(`Không thể kết nối Gemini Web (HTTP ${res.status}). Vui lòng kiểm tra lại Cookie.`);
    }
    const html = await res.text();
    const match = html.match(/"SNlM0e":"(.*?)"/) || html.match(/"thykhd":"(.*?)"/);
    if (match && match[1]) {
        const token = match[1];
        // Cache trong 1 giờ
        snlm0eCache.set(normalized, { token, expiry: Date.now() + 3600 * 1000 });
        return token;
    }
    throw new Error('Không trích xuất được SNlM0e token. Cookie có thể đã hết hạn hoặc không hợp lệ.');
}
/**
 * Đóng gói payload f.req theo chuẩn Google Batchexecute
 */
function buildFReqPayload(prompt, conversationId = '') {
    const reqData = [
        [prompt, 0, null, null, null, null, 0],
        ['en'],
        [conversationId, '', '', null, null, []],
        null,
        null,
        null,
        [1],
        0,
        [],
        [],
        null,
        null,
        null,
        null,
        []
    ];
    return JSON.stringify([null, JSON.stringify(reqData)]);
}
/**
 * Trích xuất text trả lời từ response chunk của Gemini Web
 */
function parseGeminiWebResponse(rawText) {
    const lines = rawText.split('\n');
    let fullAnswer = '';
    for (const line of lines) {
        if (!line.startsWith('[') && !line.includes('wrb.fr'))
            continue;
        try {
            const parsed = JSON.parse(line.trim());
            if (Array.isArray(parsed) && parsed[0]?.[2]) {
                const inner = JSON.parse(parsed[0][2]);
                if (Array.isArray(inner) && inner[4]?.[0]?.[1]?.[0]) {
                    fullAnswer = inner[4][0][1][0];
                }
            }
        }
        catch (_) { }
    }
    if (fullAnswer)
        return fullAnswer;
    // Fallback regex trích xuất text
    const match = rawText.match(/\["rc_[^"]+",\["([^"]+)"/);
    if (match && match[1]) {
        return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    // Regex tìm đoạn trả lời lớn nhất
    const textMatches = [...rawText.matchAll(/"([A-Za-z0-9\s\p{P}\p{L}]{20,})"/gu)];
    if (textMatches.length > 0) {
        let longest = '';
        for (const m of textMatches) {
            if (m[1].length > longest.length && !m[1].includes('BardChatUi') && !m[1].includes('http')) {
                longest = m[1];
            }
        }
        if (longest)
            return longest.replace(/\\n/g, '\n');
    }
    return rawText.length > 300 ? rawText.slice(0, 300) : rawText;
}
/**
 * Gửi prompt tới Gemini Web qua Session Cookie
 */
async function generateContentGeminiWeb(cookies, prompt, model = 'gemini-2.5-flash') {
    const normalized = normalizeCookieString(cookies);
    const token = await getSNlM0eToken(normalized);
    const fReq = buildFReqPayload(prompt);
    const params = new URLSearchParams();
    params.set('at', token);
    params.set('f.req', fReq);
    const modelHeader = MODEL_HEADERS[model] || MODEL_HEADERS['gemini-2.5-flash'];
    const res = await fetch(GEMINI_STREAM_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Host': 'gemini.google.com',
            'Origin': 'https://gemini.google.com',
            'Referer': 'https://gemini.google.com/',
            'User-Agent': USER_AGENT,
            'Cookie': normalized,
            'x-same-domain': '1',
            'x-goog-ext-525001261-jspb': modelHeader
        },
        body: params.toString()
    });
    if (!res.ok) {
        const errText = await res.text();
        const err = new Error(`Gemini Web HTTP ${res.status}: ${errText.slice(0, 150)}`);
        err.status = res.status;
        throw err;
    }
    const rawText = await res.text();
    return parseGeminiWebResponse(rawText);
}
