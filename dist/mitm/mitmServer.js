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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MitmServer = void 0;
const https = __importStar(require("https"));
const tls = __importStar(require("tls"));
const certManager_1 = require("./certManager");
class MitmServer {
    profileManager;
    rotator;
    static instance = null;
    server = null;
    isRunning = false;
    port = 443;
    certCache = new Map();
    constructor(profileManager, rotator) {
        this.profileManager = profileManager;
        this.rotator = rotator;
    }
    static getInstance(profileManager, rotator) {
        if (!MitmServer.instance) {
            if (!profileManager || !rotator) {
                throw new Error('ProfileManager and AccountRotator required to initialize MitmServer');
            }
            MitmServer.instance = new MitmServer(profileManager, rotator);
        }
        return MitmServer.instance;
    }
    getStatus() {
        return {
            running: this.isRunning,
            port: this.port,
            certTrusted: certManager_1.CertManager.isCertTrusted()
        };
    }
    async start(port = 443) {
        if (this.isRunning)
            return;
        this.port = port;
        const rootCA = certManager_1.CertManager.ensureRootCA();
        const options = {
            key: rootCA.key,
            cert: rootCA.cert,
            SNICallback: (servername, cb) => {
                try {
                    if (this.certCache.has(servername)) {
                        return cb(null, this.certCache.get(servername));
                    }
                    const domainCert = certManager_1.CertManager.getCertForDomain(servername);
                    const ctx = tls.createSecureContext({
                        key: domainCert.key,
                        cert: `${domainCert.cert.toString('utf8')}\n${rootCA.cert.toString('utf8')}`
                    });
                    this.certCache.set(servername, ctx);
                    cb(null, ctx);
                }
                catch (e) {
                    cb(e);
                }
            }
        };
        this.server = https.createServer(options, (req, res) => {
            this.handleFastPipe(req, res);
        });
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, '127.0.0.1', () => {
                this.isRunning = true;
                resolve();
            });
            this.server.on('error', (err) => {
                this.isRunning = false;
                reject(err);
            });
        });
    }
    stop() {
        return new Promise((resolve) => {
            if (this.server && this.isRunning) {
                this.server.close(() => {
                    this.isRunning = false;
                    resolve();
                });
            }
            else {
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
    async handleFastPipe(req, res) {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
            const bodyBuffer = Buffer.concat(chunks);
            try {
                await this.rotator.executeWithFailover(async (creds) => {
                    return new Promise((resolve, reject) => {
                        // Chuẩn bị headers upstream giữ nguyên vẹn 100% telemetry gốc của IDE
                        const upstreamHeaders = {};
                        for (const [k, v] of Object.entries(req.headers)) {
                            if (!v)
                                continue;
                            const lk = k.toLowerCase();
                            // Bỏ hop-by-hop headers
                            if (lk === 'host' || lk === 'connection' || lk === 'content-length')
                                continue;
                            upstreamHeaders[k] = v;
                        }
                        // Tráo đổi Bearer token của tài khoản trong pool
                        upstreamHeaders['authorization'] = `Bearer ${creds.access_token}`;
                        upstreamHeaders['host'] = 'daily-cloudcode-pa.googleapis.com';
                        const targetHost = 'daily-cloudcode-pa.googleapis.com';
                        const targetPath = req.url || '/v1internal:streamGenerateContent';
                        // Gửi thẳng request lên Google Cloud Code upstream (Zero-Translation)
                        const proxyReq = https.request({
                            host: targetHost,
                            port: 443,
                            path: targetPath,
                            method: req.method || 'POST',
                            headers: upstreamHeaders,
                            agent: new https.Agent({ keepAlive: true, maxSockets: 50 })
                        }, (proxyRes) => {
                            const statusCode = proxyRes.statusCode || 200;
                            if (statusCode === 429) {
                                return reject({ status: 429, message: 'Google CloudCode rate limit 429' });
                            }
                            if (statusCode >= 400 && statusCode !== 404) {
                                // Buffer body để log nếu có lỗi
                                const errChunks = [];
                                proxyRes.on('data', (c) => errChunks.push(c));
                                proxyRes.on('end', () => {
                                    const errMsg = Buffer.concat(errChunks).toString('utf8');
                                    reject({ status: statusCode, message: errMsg });
                                });
                                return;
                            }
                            // Forward status code và headers
                            const resHeaders = {};
                            for (const [hk, hv] of Object.entries(proxyRes.headers)) {
                                if (hv)
                                    resHeaders[hk] = hv;
                            }
                            res.writeHead(statusCode, resHeaders);
                            // Pipe trực tiếp data stream từ Google về Antigravity IDE (Zero-Lag)
                            proxyRes.pipe(res);
                            proxyRes.on('end', () => resolve());
                        });
                        proxyReq.on('error', (e) => reject(e));
                        proxyReq.end(bodyBuffer);
                    });
                });
            }
            catch (err) {
                if (!res.headersSent) {
                    res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: { message: err.message || 'Fast-Pipe upstream error' } }));
            }
        });
    }
}
exports.MitmServer = MitmServer;
