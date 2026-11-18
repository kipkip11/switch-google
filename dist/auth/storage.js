"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileStorage = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
class ProfileStorage {
    baseDir;
    storageFile;
    keyFile;
    encryptionKey;
    constructor(customBaseDir) {
        this.baseDir = customBaseDir || path_1.default.join(os_1.default.homedir(), '.switch-google');
        this.storageFile = path_1.default.join(this.baseDir, 'profiles.enc.json');
        this.keyFile = path_1.default.join(this.baseDir, 'master.key');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
        }
        this.encryptionKey = this.getOrCreateKey();
    }
    getOrCreateKey() {
        if (fs_1.default.existsSync(this.keyFile)) {
            return fs_1.default.readFileSync(this.keyFile);
        }
        const newKey = crypto_1.default.randomBytes(32);
        fs_1.default.writeFileSync(this.keyFile, newKey, { mode: 0o600 });
        return newKey;
    }
    encrypt(text) {
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }
    decrypt(ciphertext) {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    load() {
        if (!fs_1.default.existsSync(this.storageFile)) {
            return { activeProfile: null, profiles: {}, apiKeys: [], combos: [] };
        }
        try {
            const encryptedData = fs_1.default.readFileSync(this.storageFile, 'utf8');
            const decryptedJson = this.decrypt(encryptedData);
            const data = JSON.parse(decryptedJson);
            data.apiKeys = data.apiKeys || [];
            data.combos = data.combos || [];
            return data;
        }
        catch (err) {
            console.error('Lỗi giải mã file lưu trữ token, khởi tạo dữ liệu mặc định:', err);
            return { activeProfile: null, profiles: {}, apiKeys: [], combos: [] };
        }
    }
    save(data) {
        data.apiKeys = data.apiKeys || [];
        data.combos = data.combos || [];
        const jsonStr = JSON.stringify(data, null, 2);
        const encryptedData = this.encrypt(jsonStr);
        fs_1.default.writeFileSync(this.storageFile, encryptedData, { mode: 0o600 });
    }
    getApiKeys() {
        const data = this.load();
        return data.apiKeys || [];
    }
    createApiKey(name) {
        const data = this.load();
        data.apiKeys = data.apiKeys || [];
        const randomHex = crypto_1.default.randomBytes(24).toString('hex');
        const newKey = {
            id: 'key_' + Date.now().toString(36),
            name: name.trim(),
            key: `sk-switch-${randomHex}`,
            createdAt: Date.now()
        };
        data.apiKeys.push(newKey);
        this.save(data);
        return newKey;
    }
    deleteApiKey(id) {
        const data = this.load();
        data.apiKeys = data.apiKeys || [];
        const prevLen = data.apiKeys.length;
        data.apiKeys = data.apiKeys.filter((k) => k.id !== id && k.key !== id);
        if (data.apiKeys.length !== prevLen) {
            this.save(data);
            return true;
        }
        return false;
    }
    touchApiKey(keyString) {
        const data = this.load();
        const item = data.apiKeys?.find((k) => k.key === keyString);
        if (item) {
            item.lastUsedAt = Date.now();
            this.save(data);
        }
    }
    getCombos() {
        const data = this.load();
        return data.combos || [];
    }
    createCombo(name, strategy, models) {
        const data = this.load();
        data.combos = data.combos || [];
        const existingIndex = data.combos.findIndex((c) => c.name.toLowerCase() === name.trim().toLowerCase());
        const combo = {
            id: 'combo_' + Date.now().toString(36),
            name: name.trim(),
            strategy,
            models: models.filter((m) => m && m.trim().length > 0),
            createdAt: Date.now()
        };
        if (existingIndex >= 0) {
            data.combos[existingIndex] = combo;
        }
        else {
            data.combos.push(combo);
        }
        this.save(data);
        return combo;
    }
    deleteCombo(id) {
        const data = this.load();
        data.combos = data.combos || [];
        const prevLen = data.combos.length;
        data.combos = data.combos.filter((c) => c.id !== id && c.name !== id);
        if (data.combos.length !== prevLen) {
            this.save(data);
            return true;
        }
        return false;
    }
    getStorageDirectory() {
        return this.baseDir;
    }
    exportBackup() {
        const data = this.load();
        const backup = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            data
        };
        return JSON.stringify(backup, null, 2);
    }
    importBackup(backupJson) {
        const parsed = JSON.parse(backupJson);
        const backupData = parsed.data || parsed.storage || parsed;
        const current = this.load();
        let importedCount = 0;
        if (backupData.profiles) {
            for (const [name, prof] of Object.entries(backupData.profiles)) {
                current.profiles[name] = prof;
                importedCount++;
            }
        }
        if (backupData.activeProfile && current.profiles[backupData.activeProfile]) {
            current.activeProfile = backupData.activeProfile;
        }
        if (Array.isArray(backupData.apiKeys)) {
            current.apiKeys = backupData.apiKeys;
        }
        if (Array.isArray(backupData.combos)) {
            current.combos = backupData.combos;
        }
        this.save(current);
        return importedCount;
    }
}
exports.ProfileStorage = ProfileStorage;
