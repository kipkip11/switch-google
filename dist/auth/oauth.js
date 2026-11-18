"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleOAuthHandler = exports.GEMINI_CLI_CLIENT_SECRET = exports.GEMINI_CLI_CLIENT_ID = exports.ANTIGRAVITY_CLIENT_SECRET = exports.ANTIGRAVITY_CLIENT_ID = void 0;
const http_1 = __importDefault(require("http"));
const url_1 = __importDefault(require("url"));
const google_auth_library_1 = require("google-auth-library");
// Antigravity & Gemini OAuth Client Credentials (from 9router / Google Antigravity Hub)
exports.ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
exports.ANTIGRAVITY_CLIENT_SECRET = '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';
exports.GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
exports.GEMINI_CLI_CLIENT_SECRET = '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';
class GoogleOAuthHandler {
    config;
    defaultScopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'openid',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs'
    ];
    constructor(config) {
        const rawId = process.env.GOOGLE_CLIENT_ID;
        const rawSecret = process.env.GOOGLE_CLIENT_SECRET;
        const isPlaceholderId = !rawId || rawId.includes('your_google_client_id');
        const isPlaceholderSecret = !rawSecret || rawSecret.includes('your_google_client_secret');
        this.config = {
            clientId: config?.clientId || (!isPlaceholderId ? rawId : exports.ANTIGRAVITY_CLIENT_ID),
            clientSecret: config?.clientSecret || (!isPlaceholderSecret ? rawSecret : exports.ANTIGRAVITY_CLIENT_SECRET),
            redirectPort: config?.redirectPort || Number(process.env.AUTH_CALLBACK_PORT) || 8910,
            scopes: config?.scopes || this.defaultScopes
        };
    }
    getClient(tokens) {
        const redirectUri = `http://localhost:${this.config.redirectPort}/oauth2callback`;
        const client = new google_auth_library_1.OAuth2Client(this.config.clientId, this.config.clientSecret, redirectUri);
        if (tokens) {
            client.setCredentials(tokens);
        }
        return client;
    }
    async authorizeInteractive() {
        if (!this.config.clientId || !this.config.clientSecret) {
            throw new Error('Chưa cấu hình GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET. Vui lòng thiết lập biến môi trường hoặc file .env');
        }
        const redirectUri = `http://localhost:${this.config.redirectPort}/oauth2callback`;
        const oauth2Client = this.getClient();
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: this.config.scopes
        });
        return new Promise((resolve, reject) => {
            // Safety timeout (120s) to prevent hanging the callback port if user abandons
            const timeoutTimer = setTimeout(() => {
                try {
                    server.close();
                }
                catch (_) { }
                reject(new Error('Hết thời gian chờ đăng nhập (120 giây). Vui lòng thử lại.'));
            }, 120000);
            const cleanupAndClose = () => {
                clearTimeout(timeoutTimer);
                try {
                    server.close();
                }
                catch (_) { }
            };
            const server = http_1.default.createServer(async (req, res) => {
                try {
                    if (!req.url)
                        return;
                    const parsedUrl = url_1.default.parse(req.url, true);
                    if (parsedUrl.pathname === '/oauth2callback') {
                        const code = parsedUrl.query.code;
                        const error = parsedUrl.query.error;
                        if (error) {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(`<h2>Xác thực thất bại: ${error}</h2><p>Bạn có thể đóng cửa sổ này.</p>`);
                            cleanupAndClose();
                            reject(new Error(`OAuth error: ${error}`));
                            return;
                        }
                        if (!code) {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<h2>Không nhận được authorization code</h2>');
                            cleanupAndClose();
                            reject(new Error('No code returned from Google'));
                            return;
                        }
                        // Exchange authorization code for tokens
                        const { tokens } = await oauth2Client.getToken(code);
                        oauth2Client.setCredentials(tokens);
                        // Fetch user info to get email
                        let email = 'unknown@google.com';
                        try {
                            const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
                            email = tokenInfo.email || email;
                        }
                        catch (err) {
                            // Fallback fetch userinfo endpoint
                            try {
                                const resUser = await oauth2Client.request({
                                    url: 'https://www.googleapis.com/oauth2/v2/userinfo'
                                });
                                if (resUser.data.email) {
                                    email = resUser.data.email;
                                }
                            }
                            catch (_) {
                                // If cloud-platform only scope, continue with token info
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #0F9D58;">✓ Đăng nhập thành công!</h1>
                  <p>Tài khoản: <strong>${email}</strong></p>
                  <p>Bạn có thể đóng tab này và quay lại cửa sổ Terminal.</p>
                </body>
              </html>
            `);
                        cleanupAndClose();
                        resolve({
                            tokens,
                            email
                        });
                    }
                }
                catch (err) {
                    cleanupAndClose();
                    reject(err);
                }
            });
            server.listen(this.config.redirectPort, async () => {
                console.log(`\nĐang mở trình duyệt để đăng nhập tài khoản Google...`);
                console.log(`Nếu trình duyệt không tự mở, hãy truy cập link sau:\n${authUrl}\n`);
                try {
                    const openPkg = await eval('import("open")');
                    await openPkg.default(authUrl);
                }
                catch (_) {
                    console.log(`Không thể tự mở trình duyệt, hãy copy link ở trên.`);
                }
            });
            server.on('error', (err) => {
                cleanupAndClose();
                reject(new Error(`Không thể khởi tạo local callback server tại cổng ${this.config.redirectPort}: ${err.message}`));
            });
        });
    }
    async refreshTokenIfNeeded(tokens) {
        const isExpired = tokens.expiry_date ? tokens.expiry_date <= Date.now() + 60000 : false;
        if (!isExpired && tokens.access_token) {
            return tokens;
        }
        if (!tokens.refresh_token) {
            if (tokens.access_token)
                return tokens;
            throw new Error('Không có refresh_token để làm mới access_token. Cần đăng nhập lại.');
        }
        // Try primary client ID (Antigravity)
        try {
            const client = this.getClient(tokens);
            const refreshed = await client.refreshAccessToken();
            return {
                ...tokens,
                access_token: refreshed.credentials.access_token,
                expiry_date: refreshed.credentials.expiry_date,
                token_type: refreshed.credentials.token_type
            };
        }
        catch (err1) {
            // Try fallback client ID (Gemini CLI)
            try {
                const fallbackClient = new google_auth_library_1.OAuth2Client(exports.GEMINI_CLI_CLIENT_ID, exports.GEMINI_CLI_CLIENT_SECRET, `http://localhost:${this.config.redirectPort}/oauth2callback`);
                fallbackClient.setCredentials(tokens);
                const refreshed = await fallbackClient.refreshAccessToken();
                return {
                    ...tokens,
                    access_token: refreshed.credentials.access_token,
                    expiry_date: refreshed.credentials.expiry_date,
                    token_type: refreshed.credentials.token_type
                };
            }
            catch (_) {
                // If refresh fails but we still have an access_token, use it
                if (tokens.access_token) {
                    return tokens;
                }
                throw err1;
            }
        }
    }
}
exports.GoogleOAuthHandler = GoogleOAuthHandler;
