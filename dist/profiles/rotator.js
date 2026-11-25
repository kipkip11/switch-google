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
exports.AccountRotator = void 0;
const tracker_1 = require("../usage/tracker");
class AccountRotator {
    manager;
    sqlite;
    currentIndex = 0;
    stats = new Map();
    disabledProfiles = new Set();
    upgradingProfiles = new Set();
    currentlyServingAccount = null;
    lastServedAt = 0;
    // Turn management (Số lượt gọi và token cho mỗi vòng)
    currentTurnAccount = null;
    currentTurnRequests = 0;
    currentTurnTokens = 0;
    constructor(manager) {
        this.manager = manager;
        this.sqlite = manager.getStorage().getSqlite();
        this.startBackgroundTokenPrewarmer();
    }
    /**
     * Background Token Pre-Warmer: Tự động làm mới OAuth access_token trước khi hết hạn 5 phút
     * Giúp request thực tế luôn có sẵn token nóng trong RAM (0ms OAuth handshake wait)
     */
    startBackgroundTokenPrewarmer() {
        setInterval(async () => {
            try {
                const profiles = this.manager.listProfiles();
                const now = Date.now();
                for (const p of profiles) {
                    if (p.type === 'oauth' || p.type === 'token') {
                        const exp = p.tokens?.expiry_date;
                        // Nếu sắp hết hạn trong vòng 5 phút tới và có refresh_token
                        if (exp && exp - now < 5 * 60 * 1000 && p.tokens?.refresh_token) {
                            await this.manager.getTokenForProfile(p.name, true).catch(() => { });
                        }
                    }
                }
            }
            catch (_) { }
        }, 60 * 1000).unref();
    }
    async triggerAutoUpgradeToWeb(profileName) {
        if (this.upgradingProfiles.has(profileName)) {
            return;
        }
        const raw = this.manager.getRawProfile(profileName);
        if (!raw || raw.type === 'web_session') {
            return;
        }
        this.upgradingProfiles.add(profileName);
        console.log(`[Auto-Recovery] 🚀 Phát hiện tài khoản [${profileName}] bị chặn Antigravity. Đang tự động kích hoạt chuyển sang Gemini Web Mode...`);
        // Chạy ngầm không chặn luồng chính
        (async () => {
            try {
                const { autoCaptureGeminiWebSession } = await Promise.resolve().then(() => __importStar(require('../services/webAuthAutomator')));
                const captured = await autoCaptureGeminiWebSession(180000, raw.email);
                this.manager.upgradeOauthToWebSession(profileName, captured.cookies, captured.email);
                this.unbanAccount(profileName);
                console.log(`[Auto-Recovery] ✓ Đã tự động phục hồi và chuyển [${profileName}] sang Web Mode thành công!`);
            }
            catch (err) {
                console.warn(`[Auto-Recovery] ✗ Tự động chuyển Web Mode cho [${profileName}] chưa hoàn tất: ${err.message}`);
            }
            finally {
                this.upgradingProfiles.delete(profileName);
            }
        })();
    }
    async autoRecoverBlockedAccounts() {
        const profiles = this.manager.listProfiles();
        const triggered = [];
        for (const p of profiles) {
            if (p.isBlockedAntigravity && p.type === 'oauth' && !this.upgradingProfiles.has(p.name)) {
                triggered.push(p.name);
                this.triggerAutoUpgradeToWeb(p.name);
                break; // Tự động phục hồi từng tài khoản một để không mở nhiều trình duyệt cùng lúc
            }
        }
        return { triggered };
    }
    getRotationConfig() {
        return this.sqlite.getRotationConfig();
    }
    setRotationConfig(config) {
        this.sqlite.setRotationConfig(config);
    }
    getCurrentlyServing() {
        return {
            account: this.currentlyServingAccount,
            lastServedAt: this.lastServedAt
        };
    }
    toggleProfileDisabled(profileName, state) {
        const isCurrentlyDisabled = this.disabledProfiles.has(profileName);
        const shouldDisable = state !== undefined ? state : !isCurrentlyDisabled;
        if (shouldDisable) {
            this.disabledProfiles.add(profileName);
        }
        else {
            this.disabledProfiles.delete(profileName);
        }
        return shouldDisable;
    }
    removeAccount(profileName) {
        this.stats.delete(profileName);
        this.disabledProfiles.delete(profileName);
        if (this.currentlyServingAccount === profileName) {
            this.currentlyServingAccount = null;
        }
        if (this.currentTurnAccount === profileName) {
            this.currentTurnAccount = null;
            this.currentTurnRequests = 0;
            this.currentTurnTokens = 0;
        }
    }
    getPortStatuses() {
        const profiles = this.manager.listProfiles();
        const activeName = this.manager.getActiveProfileName();
        const now = Date.now();
        const usage = tracker_1.usageTracker.getStats();
        return profiles.map((p, idx) => {
            const s = this.stats.get(p.name);
            const isBanned = s?.isBanned || false;
            const isDisabled = this.disabledProfiles.has(p.name);
            const isCooldown = (s?.cooldownUntil && s.cooldownUntil > now) || false;
            const cooldownRemainingSeconds = isCooldown ? Math.ceil((s.cooldownUntil - now) / 1000) : 0;
            let linkStatus = 'up';
            if (isDisabled)
                linkStatus = 'down';
            else if (isBanned)
                linkStatus = 'banned';
            else if (isCooldown)
                linkStatus = 'cooldown';
            const accountTokens = usage.tokensByAccount[p.name] || (p.email ? usage.tokensByAccount[p.email] : 0) || 0;
            // Quy đổi chi phí ước tính theo VNĐ (Trung bình ~ 9.000 VNĐ / 1M token đối với Gemini Flash / Pro)
            const costVnd = Math.round((accountTokens / 1_000_000) * 9000);
            const isUpgradingWeb = this.upgradingProfiles.has(p.name);
            return {
                portNumber: idx + 1,
                profile: p.name,
                email: p.email,
                type: p.type,
                planTier: p.planTier || (p.type === 'web_session' ? 'Web Session Cookie' : p.type === 'token' ? 'OAuth Access Token' : 'Google AI Studio Key'),
                planExpiresAt: p.planExpiresAt || (p.tokens?.expiry_date ? new Date(p.tokens.expiry_date).toLocaleDateString('vi-VN') : undefined),
                costVnd,
                isActiveDefault: p.name === activeName,
                isServingNow: p.name === this.currentlyServingAccount || (now - this.lastServedAt < 3500 && p.name === this.currentlyServingAccount),
                isDisabled,
                isBlockedAntigravity: p.isBlockedAntigravity || false,
                isUpgradingWeb,
                linkStatus,
                cooldownRemainingSeconds,
                totalRequests: s?.totalRequests || 0,
                failedRequests: s?.failedRequests || 0,
                lastUsedAt: s?.lastUsedAt ? new Date(s.lastUsedAt).toLocaleTimeString() : undefined,
                totalTokens: accountTokens
            };
        });
    }
    getStrategy() {
        return this.getRotationConfig().strategy;
    }
    setStrategy(strategy) {
        this.setRotationConfig({ strategy });
    }
    getStats() {
        const now = Date.now();
        const result = {};
        for (const [name, s] of this.stats.entries()) {
            const isCooldown = (s.cooldownUntil && s.cooldownUntil > now) || false;
            const cooldownRemainingSeconds = isCooldown ? Math.ceil((s.cooldownUntil - now) / 1000) : 0;
            result[name] = {
                totalRequests: s.totalRequests,
                failedRequests: s.failedRequests,
                isCooldown,
                cooldownRemainingSeconds,
                lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleTimeString() : undefined
            };
        }
        return result;
    }
    getOrCreateStats(profileName) {
        let s = this.stats.get(profileName);
        if (!s) {
            s = { totalRequests: 0, failedRequests: 0 };
            this.stats.set(profileName, s);
        }
        return s;
    }
    markCooldown(profileName, durationSeconds) {
        const s = this.getOrCreateStats(profileName);
        s.failedRequests += 1;
        // Exponential Backoff with Full Jitter để triệt tiêu hiện tượng Thundering Herd
        // Base: 20s, nhân đôi theo số lần fail liên tiếp (tối đa 300s), cộng thêm jitter ngẫu nhiên 5-15s
        let actualDuration = durationSeconds;
        if (!actualDuration) {
            const baseDelay = 20;
            const failCount = Math.min(s.failedRequests, 4);
            const backoff = baseDelay * Math.pow(1.5, failCount);
            const jitter = Math.floor(Math.random() * 10) + 5;
            actualDuration = Math.min(300, Math.round(backoff + jitter));
        }
        s.cooldownUntil = Date.now() + actualDuration * 1000;
        console.warn(`[Rotator] Tài khoản [${profileName}] cooldown (Jitter Backoff) trong ${actualDuration}s.`);
        // Reset turn nếu tài khoản bị cooldown
        if (this.currentTurnAccount === profileName) {
            this.currentTurnAccount = null;
            this.currentTurnRequests = 0;
            this.currentTurnTokens = 0;
        }
    }
    recordSuccess(profileName, tokensUsed = 0) {
        const s = this.getOrCreateStats(profileName);
        s.totalRequests += 1;
        s.lastUsedAt = Date.now();
        if (this.currentTurnAccount === profileName) {
            this.currentTurnRequests += 1;
            this.currentTurnTokens += tokensUsed;
        }
    }
    clearCooldowns() {
        for (const [, s] of this.stats) {
            s.cooldownUntil = undefined;
        }
    }
    markBanned(profileName) {
        const s = this.getOrCreateStats(profileName);
        s.failedRequests += 1;
        s.isBanned = true;
        s.cooldownUntil = Date.now() + 86400 * 1000; // 24h
        console.warn(`[Rotator] Tài khoản [${profileName}] tạm thời bị hạn chế quyền truy cập.`);
        if (this.currentTurnAccount === profileName) {
            this.currentTurnAccount = null;
            this.currentTurnRequests = 0;
            this.currentTurnTokens = 0;
        }
    }
    unbanAccount(profileName) {
        const s = this.stats.get(profileName);
        if (s) {
            s.isBanned = false;
            s.cooldownUntil = 0;
        }
    }
    unbanAllAccounts() {
        const unbanned = [];
        const profiles = this.manager.listProfiles();
        for (const p of profiles) {
            const s = this.stats.get(p.name);
            if (s) {
                s.isBanned = false;
                s.cooldownUntil = 0;
                s.failedRequests = 0;
            }
            this.manager.setBlockedAntigravity(p.name, false);
            unbanned.push(p.name);
        }
        console.log(`[Rotator] ✓ Đã khôi phục toàn bộ cổng (${unbanned.length} tài khoản). Tất cả tài khoản đã sẵn sàng.`);
        return { unbanned };
    }
    async getAvailableAccounts() {
        const profiles = this.manager.listProfiles();
        const now = Date.now();
        // Lọc ra các tài khoản không bị disable thủ công, không bị ban, không bị cooldown
        // VÀ LOẠI BỎ các tài khoản web_session đã hết hạn cookie (tránh failover lặp đi lặp lại gây tăng độ trễ)
        const available = profiles
            .filter((p) => {
            if (this.disabledProfiles.has(p.name))
                return false;
            if (p.type === 'web_session' && p.isExpired)
                return false;
            const s = this.stats.get(p.name);
            if (s?.isBanned)
                return false;
            if (p.isBlockedAntigravity && p.type === 'oauth')
                return false;
            return !(s?.cooldownUntil && s.cooldownUntil > now);
        })
            .map((p) => p.name);
        // Nếu tất cả tài khoản sạch đều hết, mở lại các tài khoản OAuth/Token còn hạn (tránh kích hoạt cookie hỏng)
        if (available.length === 0 && profiles.length > 0) {
            const nonBanned = profiles
                .filter((p) => !this.disabledProfiles.has(p.name) && !(p.type === 'web_session' && p.isExpired) && !this.stats.get(p.name)?.isBanned)
                .map((p) => p.name);
            return nonBanned.length > 0 ? nonBanned : profiles.filter(p => !(p.type === 'web_session' && p.isExpired)).map((p) => p.name);
        }
        return available;
    }
    async getNextAccount(excludedAccounts = []) {
        const allProfiles = this.manager.listProfiles();
        if (allProfiles.length === 0) {
            throw new Error('Chưa có tài khoản nào được kết nối.');
        }
        const availableNames = (await this.getAvailableAccounts()).filter((name) => !excludedAccounts.includes(name));
        if (availableNames.length === 0) {
            const fallbackRemaining = allProfiles
                .filter((p) => !(p.type === 'web_session' && p.isExpired) && !this.disabledProfiles.has(p.name))
                .map((p) => p.name)
                .filter((name) => !excludedAccounts.includes(name));
            if (fallbackRemaining.length === 0) {
                throw new Error('Tất cả tài khoản hợp lệ trong pool đều đã được thử và gặp lỗi.');
            }
            availableNames.push(...fallbackRemaining);
        }
        const config = this.getRotationConfig();
        let targetName;
        // Kiểm tra xem có cấu hình turn nhiều lượt liên tiếp không (requestsPerTurn > 1)
        const isMultiTurn = config.requestsPerTurn > 1;
        const canContinueCurrentTurn = isMultiTurn &&
            this.currentTurnAccount &&
            availableNames.includes(this.currentTurnAccount) &&
            this.currentTurnRequests < config.requestsPerTurn &&
            this.currentTurnTokens < config.tokensPerTurn;
        if (canContinueCurrentTurn) {
            targetName = this.currentTurnAccount;
            this.currentTurnRequests += 1;
        }
        else {
            // Bắt đầu lượt mới cho tài khoản tiếp theo
            const profileMap = new Map(allProfiles.map((p) => [p.name, p]));
            const getFastTier = (name) => {
                const t = profileMap.get(name)?.type;
                // Ưu tiên cổng kết nối trực tiếp API Google (OAuth / Token / API Key) tốc độ cao trước, Web Session Cookie sau
                if (t === 'oauth' || t === 'token' || t === 'api_key')
                    return 0;
                return 1;
            };
            if (config.strategy === 'least-traffic') {
                // Cân bằng tải theo lưu lượng: ưu tiên cổng tốc độ cao + chọn tài khoản có tổng token ít nhất
                const usage = tracker_1.usageTracker.getStats();
                const sortedByTraffic = [...availableNames].sort((a, b) => {
                    const tierDiff = getFastTier(a) - getFastTier(b);
                    if (tierDiff !== 0)
                        return tierDiff;
                    const tokensA = usage.tokensByAccount[a] || 0;
                    const tokensB = usage.tokensByAccount[b] || 0;
                    if (tokensA !== tokensB)
                        return tokensA - tokensB;
                    // Nếu bằng token, ưu tiên tài khoản chưa dùng gần đây
                    const statA = this.stats.get(a)?.lastUsedAt || 0;
                    const statB = this.stats.get(b)?.lastUsedAt || 0;
                    return statA - statB;
                });
                targetName = sortedByTraffic[0];
            }
            else if (config.strategy === 'fixed') {
                const activeName = this.manager.getActiveProfileName();
                targetName = activeName && availableNames.includes(activeName) ? activeName : availableNames[0];
            }
            else if (config.strategy === 'fallback') {
                targetName = availableNames[0];
            }
            else {
                // Round-robin
                this.currentIndex = this.currentIndex % availableNames.length;
                targetName = availableNames[this.currentIndex];
                this.currentIndex = (this.currentIndex + 1) % availableNames.length;
            }
            this.currentTurnAccount = targetName;
            this.currentTurnRequests = 1;
            this.currentTurnTokens = 0;
        }
        const tokenData = await this.manager.getTokenForProfile(targetName);
        return {
            profile: tokenData.profile,
            email: tokenData.email,
            type: tokenData.type,
            apiKey: tokenData.apiKey,
            cookies: tokenData.cookies,
            access_token: tokenData.access_token,
            expiry_date: tokenData.expiry_date
        };
    }
    async executeWithFailover(fn) {
        const validAvailable = await this.getAvailableAccounts();
        const maxAttempts = Math.max(1, validAvailable.length);
        const triedAccounts = [];
        let lastError = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let creds;
            try {
                creds = await this.getNextAccount(triedAccounts);
            }
            catch (err) {
                const remaining = validAvailable.filter((n) => !triedAccounts.includes(n));
                if (remaining.length > 0) {
                    const badAccount = remaining[0];
                    triedAccounts.push(badAccount);
                    this.markCooldown(badAccount, 120);
                    console.warn(`[Failover] Không lấy được token cho [${badAccount}]: ${err.message}. Thử tài khoản khác...`);
                    continue;
                }
                throw lastError || err;
            }
            triedAccounts.push(creds.profile);
            this.currentlyServingAccount = creds.profile;
            this.lastServedAt = Date.now();
            try {
                const result = await fn(creds);
                // Note: tokens used will be updated when usage is recorded
                this.recordSuccess(creds.profile);
                return { result, accountUsed: creds.profile };
            }
            catch (err) {
                lastError = err;
                const errMsg = err.message || '';
                console.warn(`[Failover] Tài khoản [${creds.profile}] thất bại (${err.status || ''} ${errMsg.slice(0, 100)}). Chuyển tài khoản...`);
                // Nếu lỗi HTTP 400 invalid_request_error (do payload hoặc model không được Google hỗ trợ),
                // ngắt ngay để chuyển sang model dự phòng tiếp theo thay vì thử lặp lại trên các tài khoản khác!
                if (err.status === 400 && (errMsg.includes('invalid_request') || errMsg.includes('INVALID_ARGUMENT'))) {
                    throw err;
                }
                const isBannedIssue = errMsg.includes('TOS_VIOLATION') ||
                    errMsg.includes('VALIDATION_REQUIRED') ||
                    errMsg.includes('Terms of Service') ||
                    errMsg.includes('ACCOUNT_SUSPENDED');
                if (isBannedIssue) {
                    this.markBanned(creds.profile);
                    this.manager.setBlockedAntigravity(creds.profile, true);
                    if (creds.type === 'oauth') {
                        this.triggerAutoUpgradeToWeb(creds.profile);
                    }
                }
                else if (err.status === 401 || errMsg.includes('UNAUTHENTICATED') || errMsg.includes('ACCESS_TOKEN_EXPIRED')) {
                    console.warn(`[Failover] Tài khoản [${creds.profile}] gặp lỗi 401/Expired. Kích hoạt làm mới token...`);
                    try {
                        await this.manager.getTokenForProfile(creds.profile, true);
                    }
                    catch (refErr) {
                        console.warn(`[Failover] Không thể tự động làm mới token cho [${creds.profile}]: ${refErr.message}`);
                    }
                    this.markCooldown(creds.profile, 30);
                }
                else {
                    const cooldownTime = err.status === 429 ? 60 : 20;
                    this.markCooldown(creds.profile, cooldownTime);
                }
                if (attempt < maxAttempts - 1) {
                    continue;
                }
            }
        }
        throw lastError || new Error('Đã thử tất cả các tài khoản nhưng không tài khoản nào khả dụng.');
    }
}
exports.AccountRotator = AccountRotator;
