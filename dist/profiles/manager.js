"use strict";
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
    async loginAndSave(profileName) {
        const data = this.storage.load();
        const { tokens, email } = await this.oauthHandler.authorizeInteractive();
        // Tự động dùng chính email của tài khoản Google nếu không truyền profileName
        const resolvedName = profileName && profileName.trim().length > 0 ? profileName.trim() : email;
        const now = Date.now();
        const profile = {
            name: resolvedName,
            email,
            type: 'oauth',
            tokens,
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
