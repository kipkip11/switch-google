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
exports.ProfileManager = void 0;
const storage_1 = require("../auth/storage");
const oauth_1 = require("../auth/oauth");
class ProfileManager {
    storage;
    oauthHandler;
    constructor(storage) {
        this.storage = storage || new storage_1.ProfileStorage();
        this.oauthHandler = new oauth_1.GoogleOAuthHandler();
    }
    getStorage() {
        return this.storage;
    }
    getApiKeys() {
        return this.storage.getApiKeys();
    }
    createApiKey(name) {
        return this.storage.createApiKey(name);
    }
    deleteApiKey(id) {
        return this.storage.deleteApiKey(id);
    }
    touchApiKey(key) {
        this.storage.touchApiKey(key);
    }
    getCombos() {
        return this.storage.getCombos();
    }
    createCombo(name, strategy, models) {
        return this.storage.createCombo(name, strategy, models);
    }
    updateCombo(id, updates) {
        return this.storage.updateCombo(id, updates);
    }
    addModelToCombo(comboId, model) {
        return this.storage.addModelToCombo(comboId, model);
    }
    removeModelFromCombo(comboId, model) {
        return this.storage.removeModelFromCombo(comboId, model);
    }
    deleteCombo(id) {
        return this.storage.deleteCombo(id);
    }
    listProfiles() {
        const data = this.storage.load();
        const result = [];
        for (const [name, prof] of Object.entries(data.profiles)) {
            const type = prof.type || (prof.apiKey ? 'api_key' : 'oauth');
            let isExpired = false;
            let expiresAt = 'Không hết hạn';
            if (type === 'api_key') {
                expiresAt = 'API Key Vĩnh Viễn';
            }
            else if (prof.tokens.expiry_date) {
                isExpired = prof.tokens.expiry_date <= Date.now();
                expiresAt = new Date(prof.tokens.expiry_date).toLocaleString();
            }
            result.push({
                name,
                email: prof.email,
                type,
                isActive: data.activeProfile === name,
                isExpired,
                expiresAt,
                isBlockedAntigravity: prof.isBlockedAntigravity || false,
                createdAt: new Date(prof.createdAt).toLocaleString()
            });
        }
        return result;
    }
    getActiveProfileName() {
        const data = this.storage.load();
        return data.activeProfile;
    }
    setActiveProfile(name) {
        const data = this.storage.load();
        if (!data.profiles[name]) {
            throw new Error(`Profile '${name}' không tồn tại trong danh sách.`);
        }
        data.activeProfile = name;
        this.storage.save(data);
    }
    getRawProfile(name) {
        const data = this.storage.load();
        return data.profiles[name] || null;
    }
    setBlockedAntigravity(profileName, blocked) {
        const data = this.storage.load();
        const prof = data.profiles[profileName];
        if (prof) {
            prof.isBlockedAntigravity = blocked;
            prof.updatedAt = Date.now();
            data.profiles[profileName] = prof;
            this.storage.save(data);
        }
    }
    async checkAntigravityHealth(accessToken) {
        try {
            const res = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/cli/1.3.3 (aidev_client; os_type=darwin; arch=arm64; cl=996823801; auth_method=consumer)',
                    'X-Goog-Api-Client': 'gl-go/1.22.0 gdcl/0.180.0',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    project: 'aicode-consumers',
                    model: 'gemini-3.8-flash-high',
                    userAgent: 'antigravity',
                    request: {
                        contents: [{ role: 'user', parts: [{ text: 'ping' }] }]
                    }
                })
            });
            if (res.ok) {
                return { ok: true, status: 200 };
            }
            const text = await res.text();
            return { ok: false, status: res.status, message: text };
        }
        catch (err) {
            return { ok: false, status: 500, message: err.message };
        }
    }
    upgradeOauthToWebSession(profileName, cookies, email) {
        const data = this.storage.load();
        const prof = data.profiles[profileName];
        if (!prof) {
            throw new Error(`Profile '${profileName}' không tồn tại.`);
        }
        const now = Date.now();
        prof.type = 'web_session';
        prof.cookies = cookies.trim();
        prof.isBlockedAntigravity = false;
        if (email && email.trim()) {
            prof.email = email.trim();
        }
        prof.updatedAt = now;
        data.profiles[profileName] = prof;
        this.storage.save(data);
        return prof;
    }
    async loginAndSave(profileName) {
        const data = this.storage.load();
        const { tokens, email } = await this.oauthHandler.authorizeInteractive();
        // Tự động dùng chính email của tài khoản Google nếu không truyền profileName
        const resolvedName = profileName && profileName.trim().length > 0 ? profileName.trim() : email;
        // Kiểm tra ngay tài khoản có bị Google chặn CloudCode/Antigravity không
        let isBlockedAntigravity = false;
        if (tokens.access_token) {
            const health = await this.checkAntigravityHealth(tokens.access_token);
            if (!health.ok && health.status === 403) {
                isBlockedAntigravity = true;
            }
        }
        // Nếu bị Google chặn Antigravity, tự động kích hoạt luồng Web Mode để cứu tài khoản ngay lập tức
        if (isBlockedAntigravity) {
            console.log(`[OAuth Auto-Heal] ⚠️ Tài khoản [${email}] bị Google chặn Antigravity API (403). Đang tự động chuyển sang Gemini Web Mode...`);
            try {
                const { autoCaptureGeminiWebSession } = await Promise.resolve().then(() => __importStar(require('../services/webAuthAutomator')));
                const captured = await autoCaptureGeminiWebSession(180000, email);
                const webProfile = this.addWebSessionProfile(resolvedName, captured.cookies, captured.email);
                return webProfile;
            }
            catch (e) {
                console.warn(`[OAuth Auto-Heal] Chưa lấy được cookie tự động: ${e.message}. Lưu profile OAuth với cờ bị chặn.`);
            }
        }
        const now = Date.now();
        const profile = {
            name: resolvedName,
            email,
            type: 'oauth',
            tokens,
            isBlockedAntigravity,
            createdAt: data.profiles[resolvedName]?.createdAt || now,
            updatedAt: now
        };
        data.profiles[resolvedName] = profile;
        if (!data.activeProfile) {
            data.activeProfile = resolvedName;
        }
        this.storage.save(data);
        return profile;
    }
    addApiKeyProfile(profileName, apiKey, email) {
        const data = this.storage.load();
        const now = Date.now();
        const profile = {
            name: profileName,
            email: email || `gemini-key-${profileName.slice(0, 8)}@google.ai`,
            type: 'api_key',
            apiKey: apiKey.trim(),
            tokens: {},
            createdAt: data.profiles[profileName]?.createdAt || now,
            updatedAt: now
        };
        data.profiles[profileName] = profile;
        if (!data.activeProfile) {
            data.activeProfile = profileName;
        }
        this.storage.save(data);
        return profile;
    }
    addDirectTokenProfile(profileName, email, accessToken, refreshToken, expiryDate) {
        const data = this.storage.load();
        const now = Date.now();
        const profile = {
            name: profileName,
            email,
            type: 'token',
            tokens: {
                access_token: accessToken.trim(),
                refresh_token: refreshToken ? refreshToken.trim() : null,
                expiry_date: expiryDate || now + 3600 * 1000
            },
            createdAt: data.profiles[profileName]?.createdAt || now,
            updatedAt: now
        };
        data.profiles[profileName] = profile;
        if (!data.activeProfile) {
            data.activeProfile = profileName;
        }
        this.storage.save(data);
        return profile;
    }
    addWebSessionProfile(name, cookies, email = '') {
        const data = this.storage.load();
        const resolvedEmail = email || `${name}@gemini-web.google.com`;
        const profile = {
            name,
            email: resolvedEmail,
            type: 'web_session',
            cookies,
            tokens: {
                access_token: 'web_session_cookie',
                token_type: 'Bearer',
                expiry_date: null
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        data.profiles[name] = profile;
        if (!data.activeProfile) {
            data.activeProfile = name;
        }
        this.storage.save(data);
        return profile;
    }
    importAntigravityKeychainSession() {
        if (process.platform !== 'darwin')
            return null;
        try {
            const { execSync } = require('child_process');
            const raw = execSync('security find-generic-password -a "antigravity" -s "gemini" -w', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            if (!raw)
                return null;
            const b64 = raw.replace(/^go-keyring-base64:/, '');
            const jsonStr = Buffer.from(b64, 'base64').toString('utf-8');
            const parsed = JSON.parse(jsonStr);
            const email = parsed.id_token_email || 'antigravity-hub@google.com';
            const tokenObj = parsed.token || {};
            const accessToken = tokenObj.access_token;
            if (!accessToken)
                return null;
            const refreshToken = tokenObj.refresh_token;
            const expiry = tokenObj.expiry ? new Date(tokenObj.expiry).getTime() : Date.now() + 3600 * 1000;
            const prof = this.addDirectTokenProfile(email, email, accessToken, refreshToken, expiry);
            console.log(`[Auto-Import] Đã tự động kết nối tài khoản Antigravity từ macOS Keychain: ${email}`);
            return prof;
        }
        catch (_) {
            return null;
        }
    }
    deleteProfile(name) {
        const data = this.storage.load();
        if (!data.profiles[name]) {
            return false;
        }
        delete data.profiles[name];
        if (data.activeProfile === name) {
            const remaining = Object.keys(data.profiles);
            data.activeProfile = remaining.length > 0 ? remaining[0] : null;
        }
        this.storage.save(data);
        return true;
    }
    async getTokenForProfile(name) {
        const data = this.storage.load();
        const prof = data.profiles[name];
        if (!prof) {
            throw new Error(`Profile '${name}' không tồn tại.`);
        }
        if (prof.type === 'api_key' || prof.apiKey) {
            return {
                profile: name,
                email: prof.email,
                type: 'api_key',
                apiKey: prof.apiKey,
                access_token: prof.apiKey || '',
                expiry_date: null
            };
        }
        if (prof.type === 'web_session' || prof.cookies) {
            return {
                profile: name,
                email: prof.email,
                type: 'web_session',
                cookies: prof.cookies,
                access_token: 'web_session_cookie',
                expiry_date: null
            };
        }
        // Refresh if needed
        const updatedTokens = await this.oauthHandler.refreshTokenIfNeeded(prof.tokens);
        if (updatedTokens.access_token !== prof.tokens.access_token) {
            prof.tokens = updatedTokens;
            prof.updatedAt = Date.now();
            data.profiles[name] = prof;
            this.storage.save(data);
        }
        if (!updatedTokens.access_token) {
            throw new Error(`Không lấy được access_token cho profile '${name}'.`);
        }
        return {
            profile: name,
            email: prof.email,
            type: prof.type || 'oauth',
            access_token: updatedTokens.access_token,
            expiry_date: updatedTokens.expiry_date
        };
    }
    async getActiveToken() {
        const active = this.getActiveProfileName();
        if (!active) {
            throw new Error('Chưa có profile nào được kích hoạt. Hãy dùng lệnh: switch-google login <name>');
        }
        return this.getTokenForProfile(active);
    }
}
exports.ProfileManager = ProfileManager;
