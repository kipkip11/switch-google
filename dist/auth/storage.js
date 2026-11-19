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
const sqliteStorage_1 = require("../storage/sqliteStorage");
class ProfileStorage {
    baseDir;
    sqlite;
    storageFile;
    keyFile;
    encryptionKey;
    constructor(customBaseDir) {
        this.baseDir = customBaseDir || path_1.default.join(os_1.default.homedir(), '.switch-google');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
        }
        this.storageFile = path_1.default.join(this.baseDir, 'profiles.enc.json');
        this.keyFile = path_1.default.join(this.baseDir, 'master.key');
        this.encryptionKey = this.getOrCreateKey();
        this.sqlite = sqliteStorage_1.SqliteStorage.getInstance(this.baseDir);
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
    getSqlite() {
        return this.sqlite;
    }
    close() {
        this.sqlite.close();
    }
    load() {
        const profilesList = this.sqlite.getAllProfiles();
        const profiles = {};
        for (const p of profilesList) {
            profiles[p.name] = p;
        }
        const activeProfile = this.sqlite.getActiveProfile();
        const apiKeys = this.sqlite.getApiKeys();
        const combos = this.sqlite.getCombos();
        return {
            activeProfile,
            profiles,
            apiKeys,
            combos
        };
    }
    save(data) {
        data.apiKeys = data.apiKeys || [];
        data.combos = data.combos || [];
        // 1. Lưu vào SQLite
        if (data.activeProfile) {
            this.sqlite.setActiveProfile(data.activeProfile);
        }
        if (data.profiles) {
            const currentSqliteProfiles = this.sqlite.getAllProfiles();
            const newNames = new Set(Object.keys(data.profiles));
            for (const oldP of currentSqliteProfiles) {
                if (!newNames.has(oldP.name)) {
                    this.sqlite.deleteProfile(oldP.name);
                }
            }
            for (const p of Object.values(data.profiles)) {
                this.sqlite.saveProfile(p);
            }
        }
        if (data.apiKeys) {
            const currentKeys = this.sqlite.getApiKeys();
            const newKeyIds = new Set(data.apiKeys.map(k => k.id));
            for (const oldK of currentKeys) {
                if (!newKeyIds.has(oldK.id)) {
                    this.sqlite.deleteApiKey(oldK.id);
                }
            }
            for (const k of data.apiKeys) {
                this.sqlite.saveApiKey(k);
            }
        }
        if (data.combos) {
            const currentCombos = this.sqlite.getCombos();
            const newComboIds = new Set(data.combos.map(c => c.id));
            for (const oldC of currentCombos) {
                if (!newComboIds.has(oldC.id)) {
                    this.sqlite.deleteCombo(oldC.id);
                }
            }
            for (const c of data.combos) {
                this.sqlite.saveCombo(c);
            }
        }
        // 2. Lưu đồng thời bản sao lưu mã hóa AES-256-GCM profiles.enc.json
        try {
            const jsonStr = JSON.stringify(data, null, 2);
            const encryptedData = this.encrypt(jsonStr);
            fs_1.default.writeFileSync(this.storageFile, encryptedData, { mode: 0o600 });
        }
        catch (_) { }
    }
    getApiKeys() {
        return this.sqlite.getApiKeys();
    }
    createApiKey(name) {
        const key = this.sqlite.createApiKey(name);
        // sync encrypted json
        this.save(this.load());
        return key;
    }
    deleteApiKey(id) {
        const res = this.sqlite.deleteApiKey(id);
        if (res)
            this.save(this.load());
        return res;
    }
    touchApiKey(keyString) {
        this.sqlite.touchApiKey(keyString);
    }
    getCombos() {
        return this.sqlite.getCombos();
    }
    createCombo(name, strategy, models) {
        const combo = this.sqlite.createCombo(name, strategy, models);
        this.save(this.load());
        return combo;
    }
    updateCombo(id, updates) {
        const res = this.sqlite.updateCombo(id, updates);
        if (res)
            this.save(this.load());
        return res;
    }
    addModelToCombo(comboId, model) {
        const res = this.sqlite.addModelToCombo(comboId, model);
        if (res)
            this.save(this.load());
        return res;
    }
    removeModelFromCombo(comboId, model) {
        const res = this.sqlite.removeModelFromCombo(comboId, model);
        if (res)
            this.save(this.load());
        return res;
    }
    deleteCombo(id) {
        const res = this.sqlite.deleteCombo(id);
        if (res)
            this.save(this.load());
        return res;
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
        let importedCount = 0;
        const current = this.load();
        if (backupData.profiles) {
            for (const prof of Object.values(backupData.profiles)) {
                this.sqlite.saveProfile(prof);
                current.profiles[prof.name] = prof;
                importedCount++;
            }
        }
        if (backupData.activeProfile) {
            this.sqlite.setActiveProfile(backupData.activeProfile);
            current.activeProfile = backupData.activeProfile;
        }
        if (Array.isArray(backupData.apiKeys)) {
            for (const k of backupData.apiKeys) {
                this.sqlite.saveApiKey(k);
            }
            current.apiKeys = backupData.apiKeys;
        }
        if (Array.isArray(backupData.combos)) {
            for (const c of backupData.combos) {
                this.sqlite.saveCombo(c);
            }
            current.combos = backupData.combos;
        }
        this.save(current);
        return importedCount;
    }
    exportSqliteBuffer() {
        return this.sqlite.exportDatabaseBuffer();
    }
    importSqliteBuffer(buffer) {
        this.sqlite.importDatabaseBuffer(buffer);
    }
}
exports.ProfileStorage = ProfileStorage;
