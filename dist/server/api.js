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
exports.startApiServer = startApiServer;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const manager_1 = require("../profiles/manager");
const rotator_1 = require("../profiles/rotator");
const openaiAdapter_1 = require("./openaiAdapter");
const tracker_1 = require("../usage/tracker");
const daemon_1 = require("../services/daemon");
const webAuthAutomator_1 = require("../services/webAuthAutomator");
const mitmServer_1 = require("../mitm/mitmServer");
const certManager_1 = require("../mitm/certManager");
const dnsManager_1 = require("../mitm/dnsManager");
const portForwardManager_1 = require("../mitm/portForwardManager");
const modelFallback_1 = require("../services/modelFallback");
const externalProviders_1 = require("../services/externalProviders");
const tunnelManager_1 = require("../services/tunnelManager");
const undici_1 = require("undici");
const dns_1 = __importDefault(require("dns"));
// Bỏ qua /etc/hosts cho các request nội bộ từ switch-google tới Google APIs để triệt tiêu loopback khi Direct Link kích hoạt
function setupUpstreamDirectDns() {
    try {
        const resolver = new dns_1.default.Resolver();
        resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
        const upstreamAgent = new undici_1.Agent({
            connect: {
                lookup: (hostname, opts, cb) => {
                    const callback = typeof opts === 'function' ? opts : cb;
                    const isAll = typeof opts === 'object' && opts && opts.all;
                    if (hostname.includes('googleapis.com')) {
                        resolver.resolve4(hostname, (err, addrs) => {
                            if (err || !addrs || addrs.length === 0) {
                                return dns_1.default.lookup(hostname, opts, callback);
                            }
                            const ip = addrs[Math.floor(Math.random() * addrs.length)];
                            if (isAll) {
                                callback(null, [{ address: ip, family: 4 }]);
                            }
                            else {
                                callback(null, ip, 4);
                            }
                        });
                    }
                    else {
                        dns_1.default.lookup(hostname, opts, callback);
                    }
                }
            }
        });
        (0, undici_1.setGlobalDispatcher)(upstreamAgent);
    }
    catch (e) {
        console.warn('[DirectDNS] Warning: Could not set global undici dispatcher:', e.message);
    }
}
function startApiServer(port = Number(process.env.PORT) || 1909) {
    setupUpstreamDirectDns();
    const app = (0, express_1.default)();
    const manager = new manager_1.ProfileManager();
    const rotator = new rotator_1.AccountRotator(manager);
    const daemon = new daemon_1.DaemonManager();
    const fallbackMgr = new modelFallback_1.ModelFallbackManager(manager);
    app.use(express_1.default.json({ limit: '100mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '100mb' }));
    // Serve static files for Web UI
    const publicPaths = [
        path_1.default.join(__dirname, '../../public'),
        path_1.default.join(__dirname, '../public'),
        path_1.default.join(process.cwd(), 'public')
    ];
    for (const p of publicPaths) {
        if (fs_1.default.existsSync(p)) {
            app.use(express_1.default.static(p));
            break;
        }
    }
    // CORS middleware for 3rd party web or local applications
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    // Health and active profile info
    app.get('/api/status', (req, res) => {
        const active = manager.getActiveProfileName();
        const profiles = manager.listProfiles();
        const timeframeParam = req.query.timeframe;
        let timeframeMs = 24 * 60 * 60 * 1000;
        if (timeframeParam === '60s')
            timeframeMs = 60 * 1000;
        else if (timeframeParam === '1h')
            timeframeMs = 60 * 60 * 1000;
        else if (timeframeParam === '6h')
            timeframeMs = 6 * 60 * 60 * 1000;
        else if (timeframeParam === 'week' || timeframeParam === '7d')
            timeframeMs = 7 * 24 * 60 * 60 * 1000;
        else if (timeframeParam === 'month' || timeframeParam === '30d')
            timeframeMs = 30 * 24 * 60 * 60 * 1000;
        else if (timeframeParam === 'year' || timeframeParam === '365d')
            timeframeMs = 365 * 24 * 60 * 60 * 1000;
        const usageStats = tracker_1.usageTracker.getStats(timeframeMs);
        const recentLogs = tracker_1.usageTracker.getRecentLogs(1);
        const activeSystemCombo = manager.getActiveSystemCombo();
        const latestModel = (activeSystemCombo && (activeSystemCombo.activeModel || activeSystemCombo.models?.[0])) ||
            recentLogs[0]?.model ||
            'gemini-3.8-flash';
        const liveTraffic = tracker_1.usageTracker.getLiveTraffic();
        const rotationConfig = rotator.getRotationConfig();
        const ports = rotator.getPortStatuses().map(p => ({
            ...p,
            totalTokens: usageStats.tokensByAccount[p.profile] || (p.email ? usageStats.tokensByAccount[p.email] : 0) || 0
        }));
        res.json({
            status: 'online',
            activeProfile: active,
            totalProfiles: profiles.length,
            strategy: rotationConfig.strategy,
            rotationConfig,
            accountStats: rotator.getStats(),
            ports,
            serving: rotator.getCurrentlyServing(),
            autoModelFallback: fallbackMgr.isAutoFallbackEnabled(),
            liveTraffic,
            latestModel,
            usageStats,
            uplink: {
                totalTokens: usageStats.totalTokens || 0,
                totalPromptTokens: usageStats.totalPromptTokens || 0,
                totalCompletionTokens: usageStats.totalCompletionTokens || 0,
                totalRequests: usageStats.totalRequests || 0,
                tokensPerSecond: usageStats.tokensPerSecond || 0,
                avgLatencyMs: usageStats.avgLatencyMs || 0,
                clients: 'Hermes / Cursor / Cline'
            },
            timestamp: new Date().toISOString()
        });
    });
    // Realtime usage statistics with custom timeframe
    app.get('/api/usage/realtime', (req, res) => {
        const tf = req.query.timeframe || '24h';
        let ms = 24 * 60 * 60 * 1000;
        if (tf === '60s')
            ms = 60 * 1000;
        else if (tf === '1h')
            ms = 60 * 60 * 1000;
        else if (tf === '6h')
            ms = 6 * 60 * 60 * 1000;
        else if (tf === 'week' || tf === '7d')
            ms = 7 * 24 * 60 * 60 * 1000;
        else if (tf === 'month' || tf === '30d')
            ms = 30 * 24 * 60 * 60 * 1000;
        else if (tf === 'year' || tf === '365d')
            ms = 365 * 24 * 60 * 60 * 1000;
        res.json(tracker_1.usageTracker.getStats(ms));
    });
    // Analytics summary grouped by day, month, year, or model
    app.get('/api/analytics/summary', (req, res) => {
        try {
            const period = req.query.period || 'day'; // 'day' | 'month' | 'year' | 'hour' | 'week'
            const sqlite = manager.getStorage().getSqlite();
            let allLogs = sqlite.getUsageLogs(100000);
            const now = new Date();
            // Lọc log theo đúng khung thời gian người dùng chọn
            let filterStart = 0;
            if (period === 'hour') {
                // 24 giờ qua để hiển thị từng giờ
                filterStart = Date.now() - 24 * 3600 * 1000;
            }
            else if (period === 'day') {
                // 30 ngày qua để hiển thị từng ngày
                filterStart = Date.now() - 30 * 24 * 3600 * 1000;
            }
            else if (period === 'week') {
                // 12 tuần qua (khoảng 84 ngày)
                filterStart = Date.now() - 84 * 24 * 3600 * 1000;
            }
            else if (period === 'month') {
                // 12 tháng qua (khoảng 365 ngày)
                filterStart = Date.now() - 365 * 24 * 3600 * 1000;
            }
            else if (period === 'year') {
                // 5 năm qua
                filterStart = Date.now() - 5 * 365 * 24 * 3600 * 1000;
            }
            if (filterStart > 0) {
                allLogs = allLogs.filter((l) => l.timestamp >= filterStart);
            }
            // Phân nhóm theo period
            const timelineMap = {};
            const modelMap = {};
            const accountMap = {};
            const modelAccountMap = {};
            allLogs.forEach((log) => {
                const d = new Date(log.timestamp);
                let key = '';
                if (period === 'year') {
                    key = `${d.getFullYear()}`;
                }
                else if (period === 'month') {
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    key = `${d.getFullYear()}-${m}`;
                }
                else if (period === 'week') {
                    // Tính tuần trong năm (ISO Week hoặc tuần theo ngày đầu tuần)
                    const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
                    const pastDaysOfYear = (d.getTime() - firstDayOfYear.getTime()) / 86400000;
                    const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
                    key = `Tuần ${weekNum} (${d.getFullYear()})`;
                }
                else if (period === 'hour') {
                    const h = String(d.getHours()).padStart(2, '0');
                    key = `${h}:00`;
                }
                else {
                    // 'day'
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    key = `${d.getFullYear()}-${m}-${day}`;
                }
                if (!timelineMap[key]) {
                    timelineMap[key] = { prompt: 0, completion: 0, total: 0, requests: 0 };
                }
                timelineMap[key].prompt += log.promptTokens || 0;
                timelineMap[key].completion += log.completionTokens || 0;
                timelineMap[key].total += log.totalTokens || 0;
                timelineMap[key].requests += 1;
                // Model Map
                const modelName = log.model || 'unknown';
                modelMap[modelName] = (modelMap[modelName] || 0) + (log.totalTokens || 0);
                // Account Map
                const accName = log.profile || 'unknown';
                accountMap[accName] = (accountMap[accName] || 0) + (log.totalTokens || 0);
                // Model x Account Map
                if (!modelAccountMap[modelName]) {
                    modelAccountMap[modelName] = {};
                }
                if (!modelAccountMap[modelName][accName]) {
                    modelAccountMap[modelName][accName] = { totalTokens: 0, requests: 0 };
                }
                modelAccountMap[modelName][accName].totalTokens += log.totalTokens || 0;
                modelAccountMap[modelName][accName].requests += 1;
            });
            // Sắp xếp timeline theo thứ tự thời gian
            const timelineKeys = Object.keys(timelineMap).sort();
            const timeline = timelineKeys.map((k) => ({
                label: k,
                prompt: timelineMap[k].prompt,
                completion: timelineMap[k].completion,
                total: timelineMap[k].total,
                requests: timelineMap[k].requests
            }));
            // Quota status ước tính cho từng model theo thời gian thực 24h qua
            const now24h = Date.now() - 24 * 3600 * 1000;
            const recent24hLogs = sqlite.getUsageLogs(100000).filter(l => l.timestamp >= now24h);
            const recent24hModelMap = {};
            const recent24hModelAccountMap = {};
            recent24hLogs.forEach((log) => {
                const m = log.model || 'unknown';
                const a = log.profile || 'unknown';
                recent24hModelMap[m] = (recent24hModelMap[m] || 0) + (log.totalTokens || 0);
                if (!recent24hModelAccountMap[m])
                    recent24hModelAccountMap[m] = {};
                if (!recent24hModelAccountMap[m][a])
                    recent24hModelAccountMap[m][a] = { totalTokens: 0, requests: 0 };
                recent24hModelAccountMap[m][a].totalTokens += log.totalTokens || 0;
                recent24hModelAccountMap[m][a].requests += 1;
            });
            const totalAllTokens = allLogs.reduce((acc, l) => acc + (l.totalTokens || 0), 0);
            const totalCostVnd = Math.round((totalAllTokens / 1_000_000) * 9000);
            const activeProfiles = manager.listProfiles().filter(p => !p.isBlockedAntigravity);
            const poolCapacity = Math.max(1, activeProfiles.length);
            const portStatuses = rotator.getPortStatuses();
            const getAccountsForModel = (modelKeys, singleLimit) => {
                return portStatuses.map((p) => {
                    let usedTokens = 0;
                    let requests = 0;
                    for (const mk of modelKeys) {
                        if (recent24hModelAccountMap[mk]) {
                            const stat1 = recent24hModelAccountMap[mk][p.profile];
                            const stat2 = p.email ? recent24hModelAccountMap[mk][p.email] : null;
                            if (stat1) {
                                usedTokens += stat1.totalTokens;
                                requests += stat1.requests;
                            }
                            else if (stat2) {
                                usedTokens += stat2.totalTokens;
                                requests += stat2.requests;
                            }
                        }
                    }
                    const remainingTokens = Math.max(0, singleLimit - usedTokens);
                    const pctRemaining = Math.max(0, Math.min(100, 100 - Math.round((usedTokens / singleLimit) * 100)));
                    return {
                        portNumber: p.portNumber,
                        profile: p.profile,
                        email: p.email,
                        type: p.type,
                        linkStatus: p.linkStatus,
                        cooldownRemainingSeconds: p.cooldownRemainingSeconds,
                        isServingNow: p.isServingNow,
                        usedTokens,
                        requests,
                        limitTokens: singleLimit,
                        remainingTokens,
                        pctRemaining
                    };
                });
            };
            const quotaData = [
                {
                    id: 'claude-3-7-sonnet',
                    name: 'Claude 3.7 Sonnet (Thinking)',
                    badge: 'ĐỈNH CAO CODE',
                    color: '#7C3AED',
                    dailyLimit: poolCapacity * 10000000, // 10M per account/day
                    usedToday: recent24hModelMap['claude-3-7-sonnet'] || recent24hModelMap['claude-sonnet-5-5-high'] || 0,
                    rpmLimit: poolCapacity * 60,
                    tpmLimit: poolCapacity * 400000,
                    availableAccounts: poolCapacity,
                    status: 'healthy',
                    accounts: getAccountsForModel(['claude-3-7-sonnet', 'claude-sonnet-5-5-high'], 10000000)
                },
                {
                    id: 'gemini-3.8-flash',
                    name: 'Gemini 3.8 Flash',
                    badge: 'SIÊU TỐC ĐỘ',
                    color: '#0284C7',
                    dailyLimit: poolCapacity * 50000000, // 50M per account/day
                    usedToday: recent24hModelMap['gemini-3.8-flash'] || recent24hModelMap['gemini-3.8-flash-high'] || 0,
                    rpmLimit: poolCapacity * 120,
                    tpmLimit: poolCapacity * 1000000,
                    availableAccounts: poolCapacity,
                    status: 'healthy',
                    accounts: getAccountsForModel(['gemini-3.8-flash', 'gemini-3.8-flash-high'], 50000000)
                },
                {
                    id: 'gemini-4-argon',
                    name: 'Gemini 4 Argon / 2.5 Pro',
                    badge: 'TƯ DUY SÂU & 2M CONTEXT',
                    color: '#D97706',
                    dailyLimit: poolCapacity * 20000000, // 20M per account/day
                    usedToday: recent24hModelMap['gemini-4-argon'] || recent24hModelMap['gemini-2.5-pro'] || recent24hModelMap['gemini-4-argon-high'] || 0,
                    rpmLimit: poolCapacity * 60,
                    tpmLimit: poolCapacity * 500000,
                    availableAccounts: poolCapacity,
                    status: 'healthy',
                    accounts: getAccountsForModel(['gemini-4-argon', 'gemini-2.5-pro', 'gemini-4-argon-high'], 20000000)
                }
            ];
            res.json({
                period,
                totalAllTokens,
                totalCostVnd,
                timeline,
                modelDistribution: modelMap,
                accountDistribution: accountMap,
                quotas: quotaData
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Ping Google API for one or all profiles
    app.post('/api/ports/ping', async (req, res) => {
        try {
            const { profile } = req.body || {};
            const profiles = manager.listProfiles();
            const targetProfiles = profile
                ? profiles.filter(p => p.name === profile)
                : profiles;
            const results = {};
            for (const p of targetProfiles) {
                const t0 = Date.now();
                try {
                    const creds = await manager.getTokenForProfile(p.name);
                    let fetchRes = null;
                    if (creds.type === 'api_key' && creds.apiKey) {
                        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${creds.apiKey}`;
                        fetchRes = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
                        });
                    }
                    else if (creds.type === 'web_session') {
                        // Ping Gemini Web Session
                        try {
                            const { getSNlM0eToken } = await Promise.resolve().then(() => __importStar(require('../services/geminiWebClient')));
                            await getSNlM0eToken(creds.cookies || '');
                            fetchRes = { ok: true, status: 200 };
                        }
                        catch (wErr) {
                            fetchRes = { ok: false, status: 401, errorText: wErr.message };
                        }
                    }
                    else if (creds.type === 'token') {
                        const apiUrl = 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent';
                        fetchRes = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'antigravity/cli/1.3.3 (aidev_client; os_type=darwin; arch=arm64; cl=996823801; auth_method=consumer)',
                                'X-Goog-Api-Client': 'gl-go/1.22.0 gdcl/0.180.0',
                                'Authorization': `Bearer ${creds.access_token}`
                            },
                            body: JSON.stringify({
                                project: 'aicode-consumers',
                                model: 'gemini-3.8-flash-high',
                                userAgent: 'antigravity',
                                request: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }
                            })
                        });
                    }
                    else {
                        // OAuth account: thử daily-cloudcode-pa, nếu 403 thử generativelanguage
                        try {
                            fetchRes = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'antigravity/cli/1.3.3 (aidev_client; os_type=darwin; arch=arm64; cl=996823801; auth_method=consumer)',
                                    'X-Goog-Api-Client': 'gl-go/1.22.0 gdcl/0.180.0',
                                    'Authorization': `Bearer ${creds.access_token}`
                                },
                                body: JSON.stringify({
                                    project: 'aicode-consumers',
                                    model: 'gemini-3.8-flash-high',
                                    userAgent: 'antigravity',
                                    request: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }
                                })
                            });
                        }
                        catch (_) { }
                        if (!fetchRes || fetchRes.status === 403 || fetchRes.status === 401) {
                            fetchRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${creds.access_token}`
                                },
                                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
                            });
                        }
                    }
                    const latencyMs = Date.now() - t0;
                    const status = fetchRes ? fetchRes.status : 500;
                    const ok = fetchRes ? fetchRes.ok : false;
                    let message = ok ? 'Kết nối thành công (200 OK)' : `HTTP ${status}`;
                    if (status === 403) {
                        message = '403: Bị Google giới hạn quyền';
                    }
                    else if (status === 429) {
                        message = '429: Hết Quota / Cooldown';
                    }
                    results[p.name] = { status, ok, message, latencyMs };
                }
                catch (err) {
                    results[p.name] = {
                        status: 500,
                        ok: false,
                        message: `Lỗi: ${err.message}`,
                        latencyMs: Date.now() - t0
                    };
                }
            }
            res.json({ success: true, results });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Export full backup
    app.get('/api/backup/export', (req, res) => {
        try {
            const storageData = manager.getStorage().load();
            const settings = manager.getStorage().getSqlite().getAllSettings();
            const usageStats = tracker_1.usageTracker.getStats();
            const recentLogs = tracker_1.usageTracker.getRecentLogs(5000);
            const backup = {
                app: 'switch-google',
                version: '1.3.3',
                exportedAt: new Date().toISOString(),
                storage: storageData,
                settings,
                usageStats,
                logs: recentLogs
            };
            res.setHeader('Content-Disposition', `attachment; filename=switch-google-backup-${new Date().toISOString().slice(0, 10)}.json`);
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(backup, null, 2));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Import full backup
    app.post('/api/backup/import', (req, res) => {
        try {
            const backup = req.body;
            const storagePayload = backup?.storage || backup?.data || backup;
            if (!storagePayload || !storagePayload.profiles) {
                res.status(400).json({ error: 'File sao lưu không hợp lệ hoặc thiếu dữ liệu profiles.' });
                return;
            }
            const storage = manager.getStorage();
            // Tự động tạo snapshot dự phòng trước khi import để bảo toàn dữ liệu cũ
            try {
                storage.createLocalSnapshot('pre-import');
            }
            catch (_) { }
            const current = storage.load();
            // Merge profiles (giữ nguyên hoặc cập nhật không làm mất tài khoản cũ)
            for (const [name, prof] of Object.entries(storagePayload.profiles)) {
                current.profiles[name] = prof;
            }
            if (storagePayload.activeProfile) {
                current.activeProfile = storagePayload.activeProfile;
            }
            if (Array.isArray(storagePayload.apiKeys)) {
                const keyMap = new Map();
                for (const k of current.apiKeys || [])
                    keyMap.set(k.id, k);
                for (const k of storagePayload.apiKeys)
                    keyMap.set(k.id, k);
                current.apiKeys = Array.from(keyMap.values());
            }
            if (Array.isArray(storagePayload.combos)) {
                const comboMap = new Map();
                for (const c of current.combos || [])
                    comboMap.set(c.id, c);
                for (const c of storagePayload.combos)
                    comboMap.set(c.id, c);
                current.combos = Array.from(comboMap.values());
            }
            storage.save(current);
            // Khôi phục settings (bao gồm external_providers_config, rotation config)
            if (backup.settings && typeof backup.settings === 'object') {
                const sqlite = storage.getSqlite();
                for (const [k, v] of Object.entries(backup.settings)) {
                    if (typeof v === 'string') {
                        sqlite.setSetting(k, v);
                    }
                }
            }
            // Restore logs if any
            if (Array.isArray(backup.logs) && backup.logs.length > 0) {
                for (const log of backup.logs) {
                    tracker_1.usageTracker.record(log);
                }
            }
            res.json({
                success: true,
                message: `Đã phục hồi thành công ${Object.keys(storagePayload.profiles).length} tài khoản (Tổng: ${Object.keys(current.profiles).length} tài khoản)!`,
                totalProfiles: Object.keys(current.profiles).length
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Export Encrypted AES-256-GCM Backup (.enc.json)
    app.post('/api/backup/export-encrypted', (req, res) => {
        try {
            const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : '';
            const encContent = manager.getStorage().exportEncryptedBackup(passphrase);
            res.setHeader('Content-Disposition', `attachment; filename=switch-google-accounts-${new Date().toISOString().slice(0, 10)}.enc.json`);
            res.setHeader('Content-Type', 'application/json');
            res.send(encContent);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Import Encrypted AES-256-GCM Backup (.enc.json)
    app.post('/api/backup/import-encrypted', (req, res) => {
        try {
            const { encryptedContent, passphrase } = req.body || {};
            if (!encryptedContent) {
                res.status(400).json({ error: 'Thiếu nội dung file sao lưu mã hóa.' });
                return;
            }
            try {
                manager.getStorage().createLocalSnapshot('pre-encrypted-import');
            }
            catch (_) { }
            const rawStr = typeof encryptedContent === 'string' ? encryptedContent : JSON.stringify(encryptedContent);
            const result = manager.getStorage().importEncryptedBackup(rawStr, passphrase);
            res.json({
                success: true,
                message: `Đã giải mã và khôi phục thành công ${result.restoredProfiles} tài khoản (Tổng: ${result.totalProfiles} tài khoản)!`,
                ...result
            });
        }
        catch (err) {
            res.status(400).json({ error: err.message || 'Giải mã thất bại hoặc sai mật khẩu.' });
        }
    });
    // Local Snapshot Management (Auto & Manual Snapshots in ~/.switch-google/backups/)
    app.get('/api/backup/snapshots', (req, res) => {
        try {
            const snapshots = manager.getStorage().listLocalSnapshots();
            res.json({
                backupDir: manager.getStorage().getBackupDir(),
                snapshots
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/backup/snapshots', (req, res) => {
        try {
            const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual';
            const snap = manager.getStorage().createLocalSnapshot(reason);
            res.json({
                success: true,
                message: `Đã tạo bản sao lưu nhanh (${snap.profileCount} tài khoản) tại máy chủ!`,
                snapshot: snap
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/backup/snapshots/restore', (req, res) => {
        try {
            const { filename } = req.body || {};
            if (!filename) {
                res.status(400).json({ error: 'Thiếu tên file snapshot cần khôi phục.' });
                return;
            }
            const resData = manager.getStorage().restoreLocalSnapshot(filename);
            res.json({
                success: true,
                message: `Đã khôi phục ${resData.restoredProfiles} tài khoản từ bản sao lưu ${filename}!`,
                ...resData
            });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    app.delete('/api/backup/snapshots/:filename', (req, res) => {
        try {
            const ok = manager.getStorage().deleteLocalSnapshot(req.params.filename);
            res.json({ success: ok });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Export SQLite binary database
    app.get('/api/backup/sqlite', (req, res) => {
        try {
            const buffer = manager.getStorage().exportSqliteBuffer();
            res.setHeader('Content-Disposition', `attachment; filename=switch_google_${new Date().toISOString().slice(0, 10)}.sqlite`);
            res.setHeader('Content-Type', 'application/vnd.sqlite3');
            res.send(buffer);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Import SQLite binary database
    app.post('/api/backup/sqlite', (req, res) => {
        try {
            let buffer = null;
            if (Buffer.isBuffer(req.body) && req.body.length > 0) {
                buffer = req.body;
            }
            else if (req.body && typeof req.body.data === 'string') {
                buffer = Buffer.from(req.body.data, 'base64');
            }
            if (!buffer) {
                res.status(400).json({ error: 'Dữ liệu SQLite không hợp lệ' });
                return;
            }
            manager.getStorage().importSqliteBuffer(buffer);
            res.json({ success: true, message: 'Phục hồi cơ sở dữ liệu SQLite thành công!' });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Switch Ports Status & Management
    app.get('/api/ports', (req, res) => {
        const usageStats = tracker_1.usageTracker.getStats();
        const ports = rotator.getPortStatuses().map(p => ({
            ...p,
            totalTokens: usageStats.tokensByAccount[p.profile] || (p.email ? usageStats.tokensByAccount[p.email] : 0) || 0
        }));
        res.json({
            ports,
            serving: rotator.getCurrentlyServing(),
            strategy: rotator.getStrategy(),
            uplink: {
                totalTokens: usageStats.totalTokens || 0,
                totalPromptTokens: usageStats.totalPromptTokens || 0,
                totalCompletionTokens: usageStats.totalCompletionTokens || 0,
                totalRequests: usageStats.totalRequests || 0,
                clients: 'Hermes / Cursor / Cline'
            }
        });
    });
    app.post('/api/ports/toggle', (req, res) => {
        const { profile, disabled } = req.body;
        if (!profile) {
            res.status(400).json({ error: 'Missing profile' });
            return;
        }
        const isNowDisabled = rotator.toggleProfileDisabled(profile, disabled);
        res.json({ success: true, profile, disabled: isNowDisabled, ports: rotator.getPortStatuses() });
    });
    // Token Usage Stats & Audit Logs
    app.get('/api/usage/stats', (req, res) => {
        res.json(tracker_1.usageTracker.getStats());
    });
    app.get('/api/usage/logs', (req, res) => {
        const limit = Number(req.query.limit) || 100;
        const model = req.query.model ? String(req.query.model) : undefined;
        const account = req.query.account ? String(req.query.account) : undefined;
        res.json({ logs: tracker_1.usageTracker.getRecentLogs(limit, model, account) });
    });
    app.delete('/api/usage/logs', (req, res) => {
        tracker_1.usageTracker.clearLogs();
        res.json({ success: true, message: 'Logs cleared' });
    });
    // Strategy management (round-robin / least-traffic / fallback / fixed)
    app.get('/api/strategy', (req, res) => {
        res.json({
            strategy: rotator.getStrategy(),
            stats: rotator.getStats()
        });
    });
    app.post('/api/strategy', (req, res) => {
        const { strategy } = req.body;
        if (!strategy || !['round-robin', 'least-traffic', 'fallback', 'fixed'].includes(strategy)) {
            res.status(400).json({ error: 'Invalid strategy. Allowed: round-robin, least-traffic, fallback, fixed' });
            return;
        }
        rotator.setStrategy(strategy);
        res.json({ success: true, strategy: rotator.getStrategy() });
    });
    // Rotation configuration (requests per turn, tokens per turn, strategy)
    app.get('/api/rotation/config', (req, res) => {
        res.json(rotator.getRotationConfig());
    });
    app.post('/api/rotation/config', (req, res) => {
        const { requestsPerTurn, tokensPerTurn, strategy } = req.body;
        rotator.setRotationConfig({ requestsPerTurn, tokensPerTurn, strategy });
        res.json({ success: true, config: rotator.getRotationConfig() });
    });
    // Reset all banned/cooldown accounts in rotator
    app.post('/api/rotator/reset-bans', (req, res) => {
        try {
            const result = rotator.unbanAllAccounts();
            res.json({ success: true, ...result });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Auto-Model Fallback on 429 quota exhaustion settings
    app.get('/api/settings/fallback', (req, res) => {
        res.json({
            enabled: fallbackMgr.isAutoFallbackEnabled(),
            defaults: modelFallback_1.DEFAULT_MODEL_FALLBACKS
        });
    });
    app.post('/api/settings/fallback', (req, res) => {
        const { enabled } = req.body;
        fallbackMgr.setAutoFallbackEnabled(Boolean(enabled));
        res.json({
            success: true,
            enabled: fallbackMgr.isAutoFallbackEnabled()
        });
    });
    // List all available profiles
    app.get('/api/profiles', (req, res) => {
        try {
            const list = manager.listProfiles();
            const stats = rotator.getStats();
            const enriched = list.map((p) => ({
                ...p,
                stats: stats[p.name] || { totalRequests: 0, failedRequests: 0, isCooldown: false, cooldownRemainingSeconds: 0 }
            }));
            res.json({ profiles: enriched, strategy: rotator.getStrategy() });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Subscriptions & Plans Management
    app.post('/api/profiles/:name/subscription', (req, res) => {
        try {
            const { name } = req.params;
            const { planTier, planExpiresAt } = req.body;
            const sqlite = manager.getStorage().getSqlite();
            const prof = sqlite.getProfile(name);
            if (!prof) {
                res.status(404).json({ error: 'Tài khoản không tồn tại' });
                return;
            }
            prof.planTier = planTier;
            prof.planExpiresAt = planExpiresAt;
            sqlite.saveProfile(prof);
            res.json({ success: true, profile: prof });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Virtual API Keys Management
    app.get('/api/keys', (req, res) => {
        res.json({ keys: manager.getApiKeys() });
    });
    app.post('/api/keys', (req, res) => {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "name" for API Key' });
            return;
        }
        const newKey = manager.createApiKey(name);
        res.json(newKey);
    });
    app.delete('/api/keys/:id', (req, res) => {
        const success = manager.deleteApiKey(req.params.id);
        if (!success) {
            res.status(404).json({ error: 'API Key not found' });
            return;
        }
        res.json({ success: true, message: 'API Key deleted' });
    });
    // Model Combos Management
    app.get('/api/combos', (req, res) => {
        res.json({ combos: manager.getCombos() });
    });
    // External Multi-Providers Endpoints (Dịch Vụ AI Mở Rộng)
    app.get('/api/providers', (req, res) => {
        const sqlite = manager.getStorage().getSqlite();
        res.json({ providers: externalProviders_1.ExternalProviderManager.getMaskedProviders(sqlite) });
    });
    // Remote & Multi-Device Tunnel Endpoints (Tailscale & Cloudflare)
    tunnelManager_1.TunnelManager.registerExitHandler();
    app.get('/api/network/status', (req, res) => {
        try {
            const status = tunnelManager_1.TunnelManager.getNetworkStatus(port);
            res.json(status);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/network/cloudflare/toggle', async (req, res) => {
        try {
            const { enabled } = req.body;
            if (enabled) {
                const url = await tunnelManager_1.TunnelManager.startCloudflareTunnel(port);
                res.json({ success: true, running: true, url });
            }
            else {
                tunnelManager_1.TunnelManager.stopCloudflareTunnel();
                res.json({ success: true, running: false, url: null });
            }
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/providers/:id', (req, res) => {
        const sqlite = manager.getStorage().getSqlite();
        const updated = externalProviders_1.ExternalProviderManager.updateProvider(sqlite, req.params.id, req.body);
        res.json({ success: true, providers: updated });
    });
    app.delete('/api/providers/:id', (req, res) => {
        const sqlite = manager.getStorage().getSqlite();
        const updated = externalProviders_1.ExternalProviderManager.deleteProvider(sqlite, req.params.id);
        res.json({ success: true, providers: updated });
    });
    app.post('/api/combos', (req, res) => {
        const { name, strategy = 'fallback', models = [] } = req.body;
        if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "name" for Model Combo' });
            return;
        }
        if (!Array.isArray(models) || models.length === 0) {
            res.status(400).json({ error: 'At least one model must be specified in "models"' });
            return;
        }
        const combo = manager.createCombo(name, strategy, models);
        res.json(combo);
    });
    // Update combo details
    app.put('/api/combos/:id', (req, res) => {
        const { name, strategy, models } = req.body;
        const updated = manager.updateCombo(req.params.id, { name, strategy, models });
        if (!updated) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json(updated);
    });
    // Add a model to combo
    app.post('/api/combos/:id/models', (req, res) => {
        const { model } = req.body;
        if (!model || typeof model !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "model"' });
            return;
        }
        const updated = manager.addModelToCombo(req.params.id, model.trim());
        if (!updated) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json(updated);
    });
    // Get current active system combo
    app.get('/api/combos/active', (req, res) => {
        res.json({ activeCombo: manager.getActiveSystemCombo() });
    });
    // Select active model inside a combo
    app.post('/api/combos/:id/select-model', (req, res) => {
        const { model } = req.body;
        if (!model || typeof model !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "model"' });
            return;
        }
        const updated = manager.setActiveModelInCombo(req.params.id, model.trim());
        if (!updated) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json(updated);
    });
    // Activate / Deactivate a combo for the whole system
    app.post('/api/combos/:id/activate', (req, res) => {
        const active = req.body?.active !== undefined ? Boolean(req.body.active) : true;
        const updated = manager.setSystemActiveCombo(req.params.id, active);
        if (!updated) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json(updated);
    });
    // Delete a model from combo
    app.delete('/api/combos/:id/models/:model', (req, res) => {
        const { id, model } = req.params;
        const updated = manager.removeModelFromCombo(id, decodeURIComponent(model));
        if (!updated) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json(updated);
    });
    app.delete('/api/combos/:id', (req, res) => {
        const success = manager.deleteCombo(req.params.id);
        if (!success) {
            res.status(404).json({ error: 'Model Combo not found' });
            return;
        }
        res.json({ success: true, message: 'Model Combo deleted' });
    });
    // Mount OpenAI-compatible Gateway (/v1/chat/completions, /v1/models) with account rotation & auto-failover
    app.use('/v1', (0, openaiAdapter_1.createOpenAiRouter)(manager, rotator, port));
    // Add profile via API Key (Google AI Studio Gemini Key)
    app.post('/api/profiles/apikey', (req, res) => {
        try {
            const { profile, apiKey, email } = req.body;
            if (!profile || !apiKey) {
                res.status(400).json({ error: 'Missing "profile" or "apiKey" in request body' });
                return;
            }
            const saved = manager.addApiKeyProfile(profile.trim(), apiKey.trim(), email?.trim());
            res.json(saved);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Add profile via direct Access/Refresh Token
    app.post('/api/profiles/token', (req, res) => {
        try {
            const { profile, email, accessToken, refreshToken, expiryDate } = req.body;
            if (!profile || !accessToken) {
                res.status(400).json({ error: 'Missing "profile" or "accessToken" in request body' });
                return;
            }
            const saved = manager.addDirectTokenProfile(profile.trim(), email || 'manual-token@google.com', accessToken.trim(), refreshToken, expiryDate);
            res.json(saved);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Add profile via Gemini Web Session Cookies (Tận dụng tài khoản bị chặn Antigravity)
    app.post('/api/profiles/cookie', (req, res) => {
        try {
            const { profile, email, cookies } = req.body;
            if (!profile || !cookies) {
                res.status(400).json({ error: 'Missing "profile" or "cookies" in request body' });
                return;
            }
            const saved = manager.addWebSessionProfile(profile.trim(), cookies.trim(), email?.trim());
            res.json(saved);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    let isWebLoginInProgress = false;
    // Tự động mở Google Login và bắt Cookie Gemini Web Mode (1-Click OAuth Web Mode)
    app.post('/api/login/web', async (req, res) => {
        if (isWebLoginInProgress) {
            return res.status(409).json({
                error: 'Đang có một tiến trình đăng nhập Web Mode khác đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ trình duyệt hiện tại.'
            });
        }
        isWebLoginInProgress = true;
        try {
            const { profile } = req.body || {};
            const captured = await (0, webAuthAutomator_1.autoCaptureGeminiWebSession)(180000);
            const targetProfile = profile?.trim() || captured.email;
            const saved = manager.addWebSessionProfile(targetProfile, captured.cookies, captured.email);
            res.json({
                success: true,
                profile: saved,
                email: captured.email,
                message: 'Đã tự động xác thực và kích hoạt Gemini Web Mode thành công!'
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
        finally {
            isWebLoginInProgress = false;
        }
    });
    // Login and create a new profile via OAuth (Tự động lấy Email nếu không truyền profile)
    app.post('/api/login', async (req, res) => {
        try {
            const { profile } = req.body || {};
            const profileName = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;
            const saved = await manager.loginAndSave(profileName);
            res.json(saved);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Kiểm tra trạng thái Antigravity của một tài khoản cụ thể
    app.post('/api/profiles/:profile/check-antigravity', async (req, res) => {
        try {
            const profile = req.params.profile;
            const raw = manager.getRawProfile(profile);
            if (!raw) {
                return res.status(404).json({ error: `Profile '${profile}' không tồn tại` });
            }
            if (raw.type === 'web_session') {
                return res.json({
                    profile,
                    type: raw.type,
                    isBlockedAntigravity: false,
                    status: 200,
                    message: 'Tài khoản Web Session hoạt động bình thường'
                });
            }
            const tokenData = await manager.getTokenForProfile(profile);
            const health = await manager.checkAntigravityHealth(tokenData.access_token);
            const isBlocked = !health.ok && health.status === 403;
            manager.setBlockedAntigravity(profile, isBlocked);
            if (isBlocked) {
                rotator.markBanned(profile);
            }
            else if (health.ok) {
                rotator.unbanAccount(profile);
            }
            res.json({
                profile,
                type: raw.type,
                isBlockedAntigravity: isBlocked,
                status: health.status,
                message: isBlocked
                    ? 'Tài khoản bị Google chặn Antigravity / CloudCode (TOS hoặc Bản quyền)'
                    : (health.ok ? 'Tài khoản hoạt động tốt với Antigravity' : (health.message || 'Lỗi không xác định'))
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Nâng cấp / chuyển đổi tài khoản OAuth bị chặn sang Web Mode (1-Click)
    app.post('/api/profiles/:profile/upgrade-web', async (req, res) => {
        if (isWebLoginInProgress) {
            return res.status(409).json({
                error: 'Đang có một tiến trình đăng nhập Web Mode khác đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ trình duyệt hiện tại.'
            });
        }
        const profile = req.params.profile;
        const raw = manager.getRawProfile(profile);
        if (!raw) {
            return res.status(404).json({ error: `Profile '${profile}' không tồn tại` });
        }
        isWebLoginInProgress = true;
        try {
            const captured = await (0, webAuthAutomator_1.autoCaptureGeminiWebSession)(180000, raw.email);
            const upgraded = manager.upgradeOauthToWebSession(profile, captured.cookies, captured.email);
            rotator.unbanAccount(profile);
            res.json({
                success: true,
                profile: upgraded,
                email: captured.email,
                message: `Đã chuyển đổi tài khoản [${profile}] sang Gemini Web Mode thành công!`
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
        finally {
            isWebLoginInProgress = false;
        }
    });
    // Nạp trực tiếp Cookie cho profile đã có sẵn (Instant Web Mode Activation)
    app.post('/api/profiles/:profile/set-cookies', async (req, res) => {
        const profile = req.params.profile;
        const { cookies } = req.body || {};
        if (!cookies || typeof cookies !== 'string' || !cookies.trim()) {
            return res.status(400).json({ error: 'Chuỗi Cookie không được để trống' });
        }
        const raw = manager.getRawProfile(profile);
        if (!raw) {
            return res.status(404).json({ error: `Profile '${profile}' không tồn tại` });
        }
        try {
            const { getSNlM0eToken, normalizeCookieString } = await Promise.resolve().then(() => __importStar(require('../services/geminiWebClient')));
            const normalizedCookies = normalizeCookieString(cookies);
            let snlm0e = '';
            try {
                snlm0e = await getSNlM0eToken(normalizedCookies);
            }
            catch (_) { }
            // Nếu không lấy được snlm0e và chuỗi không chứa SID tối thiểu thì báo lỗi
            const hasCoreCookie = normalizedCookies.includes('__Secure-1PSID') || normalizedCookies.includes('SID');
            if (!snlm0e && !hasCoreCookie) {
                return res.status(400).json({
                    error: 'Cookie không hợp lệ hoặc thiếu cookie cốt lõi __Secure-1PSID.'
                });
            }
            const upgraded = manager.upgradeOauthToWebSession(profile, normalizedCookies, raw.email);
            rotator.unbanAccount(profile);
            res.json({
                success: true,
                profile: upgraded,
                message: `Đã kích hoạt Web Mode thành công cho [${profile}]!`
            });
        }
        catch (err) {
            res.status(500).json({ error: `Lỗi kích hoạt Cookie: ${err.message}` });
        }
    });
    // Tự động quét và kích hoạt chuyển sang Web Mode cho tất cả tài khoản bị chặn (Zero-Touch Auto-Heal)
    app.post('/api/auto-recover', async (req, res) => {
        try {
            const result = await rotator.autoRecoverBlockedAccounts();
            res.json({
                success: true,
                triggered: result.triggered,
                message: result.triggered.length > 0
                    ? `Đã tự động kích hoạt chuyển Web Mode cho [${result.triggered.join(', ')}]`
                    : 'Không có tài khoản nào bị chặn cần chuyển đổi'
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Delete a profile
    app.delete('/api/profiles/:profile', (req, res) => {
        try {
            const profile = req.params.profile;
            const success = manager.deleteProfile(profile);
            if (!success) {
                res.status(404).json({ error: `Profile '${profile}' không tồn tại` });
                return;
            }
            rotator.removeAccount(profile);
            res.json({ success: true, message: `Profile '${profile}' đã được xóa` });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Switch active profile
    app.post('/api/switch', (req, res) => {
        try {
            const { profile } = req.body;
            if (!profile) {
                res.status(400).json({ error: 'Missing "profile" in request body' });
                return;
            }
            manager.setActiveProfile(profile);
            res.json({ success: true, message: `Switched active profile to '${profile}'` });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // Get active token (auto-refreshed)
    app.get('/api/token', async (req, res) => {
        try {
            const tokenInfo = await manager.getActiveToken();
            res.json(tokenInfo);
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // Get token for a specific profile
    app.get('/api/token/:profile', async (req, res) => {
        try {
            const profile = req.params.profile;
            const tokenInfo = await manager.getTokenForProfile(profile);
            res.json(tokenInfo);
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // Optional Proxy Endpoint for 3rd party requests
    app.post('/api/proxy', async (req, res) => {
        try {
            const { url, method = 'GET', headers = {}, body, profile } = req.body;
            if (!url) {
                res.status(400).json({ error: 'Missing "url" in request body' });
                return;
            }
            const tokenData = profile
                ? await manager.getTokenForProfile(profile)
                : await manager.getActiveToken();
            const fetchHeaders = {
                ...headers,
                Authorization: `Bearer ${tokenData.access_token}`
            };
            const fetchOptions = {
                method,
                headers: fetchHeaders
            };
            if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
                fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json';
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            }
            const response = await fetch(url, fetchOptions);
            const data = await response.text();
            res.status(response.status);
            const contentType = response.headers.get('content-type');
            if (contentType) {
                res.setHeader('content-type', contentType);
            }
            res.send(data);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Check version and GitHub updates
    app.get('/api/system/version', async (req, res) => {
        try {
            const updateInfo = await daemon.checkGithubUpdates();
            const daemonStatus = daemon.getStatus(port);
            const autoUpdate = daemon.getAutoUpdateConfig();
            res.json({
                ...updateInfo,
                daemon: daemonStatus,
                autoUpdate
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Get and set auto-update configuration
    app.get('/api/system/update/config', (req, res) => {
        try {
            res.json(daemon.getAutoUpdateConfig());
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/system/update/config', (req, res) => {
        try {
            const { enabled, intervalMinutes } = req.body;
            const updated = daemon.saveAutoUpdateConfig({
                enabled: typeof enabled === 'boolean' ? enabled : undefined,
                intervalMinutes: typeof intervalMinutes === 'number' ? intervalMinutes : undefined
            });
            res.json({ success: true, config: updated });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Check update now
    app.post('/api/system/update/check-now', async (req, res) => {
        try {
            const updateInfo = await daemon.checkGithubUpdates();
            res.json(updateInfo);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Perform self-update from GitHub
    app.post('/api/system/update', (req, res) => {
        try {
            const result = daemon.performSelfUpdate();
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Restart server daemon
    app.post('/api/system/restart', (req, res) => {
        try {
            res.json({ success: true, message: 'Server đang khởi động lại...' });
            setTimeout(() => {
                if (serverInstance) {
                    serverInstance.close(() => {
                        daemon.performSelfRestart(port);
                    });
                }
                else {
                    daemon.performSelfRestart(port);
                }
            }, 300);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Get daemon status
    app.get('/api/system/daemon', (req, res) => {
        res.json(daemon.getStatus(port));
    });
    // Toggle auto-start on boot
    app.post('/api/system/daemon/autostart', (req, res) => {
        try {
            const { enabled } = req.body;
            const result = enabled ? daemon.enableAutoStart(port) : daemon.disableAutoStart();
            res.json({ ...result, autoStartEnabled: daemon.isAutoStartEnabled() });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // ----------------------------------------------------
    // Antigravity Direct Link (Transparent Fast-Pipe MITM)
    // ----------------------------------------------------
    const mitm = mitmServer_1.MitmServer.getInstance(manager, rotator);
    dnsManager_1.DnsManager.registerExitRollback();
    app.get('/api/mitm/status', (req, res) => {
        try {
            const status = mitm.getStatus();
            const dnsEnabled = dnsManager_1.DnsManager.isEnabled();
            const targetMitmPort = (status.port && status.port !== 443) ? status.port : 8443;
            res.json({
                running: status.running,
                port: status.port,
                isFallback: status.isFallback,
                needsPortForward: status.port !== 443,
                certTrusted: status.certTrusted,
                dnsEnabled,
                trustCommand: certManager_1.CertManager.getTrustCommand(),
                enableDnsCommand: dnsManager_1.DnsManager.getEnableCommand(),
                disableDnsCommand: dnsManager_1.DnsManager.getDisableCommand(),
                portForwardCommand: portForwardManager_1.PortForwardManager.getEnableCommand(443, targetMitmPort),
                disablePortForwardCommand: portForwardManager_1.PortForwardManager.getDisableCommand(443, targetMitmPort)
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/mitm/toggle', async (req, res) => {
        try {
            const { enabled, port: mitmPort = 443 } = req.body;
            if (enabled) {
                await mitm.start(mitmPort);
            }
            else {
                await mitm.stop();
            }
            res.json({
                success: true,
                status: mitm.getStatus(),
                dnsEnabled: dnsManager_1.DnsManager.isEnabled()
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    let serverInstance = null;
    serverInstance = app.listen(port, '0.0.0.0', () => {
        console.log(`\n======================================================`);
        console.log(`  🚀 switch-google Web Dashboard & API Server:`);
        console.log(`  🌐 Dashboard: http://localhost:${port} hoặc http://0.0.0.0:${port}`);
        console.log(`  🤖 OpenAI Gateway: http://localhost:${port}/v1 (hoặc http://<IP-may>:${port}/v1)`);
        console.log(`======================================================`);
        console.log(`- Web UI: Mở http://localhost:${port} trên trình duyệt`);
        console.log(`- OpenAI Proxy: Cấu hình Base URL http://localhost:${port}/v1 cho Hermes Agent/Cursor/Cline`);
        console.log(`- Hỗ trợ kết nối từ máy khác trong mạng LAN qua port ${port}`);
        console.log(`- Tự động cập nhật ngầm qua CI/CD: Đang hoạt động`);
        console.log(`======================================================\n`);
    });
    // Khởi động tiến trình tự động kiểm tra và nâng cấp ngầm thông qua bộ lọc CI/CD
    daemon.startAutoUpdateWorker(port, () => {
        console.log('[AutoUpdate] Đang bàn giao cổng mạng và khởi động lại Web Server...');
        if (serverInstance) {
            serverInstance.close(() => {
                daemon.performSelfRestart(port);
            });
        }
        else {
            daemon.performSelfRestart(port);
        }
    });
    return serverInstance;
}
