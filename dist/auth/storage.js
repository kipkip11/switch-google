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
    memCache = null;
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
    invalidateCache() {
        this.memCache = null;
    }
    load() {
        const now = Date.now();
        if (this.memCache && now - this.memCache.timestamp < 2000) {
            return this.memCache.data;
        }
        const profilesList = this.sqlite.getAllProfiles();
        const profiles = {};
        for (const p of profilesList) {
            profiles[p.name] = p;
        }
        const activeProfile = this.sqlite.getActiveProfile();
        const apiKeys = this.sqlite.getApiKeys();
        const combos = this.sqlite.getCombos();
        const data = {
            activeProfile,
            profiles,
            apiKeys,
            combos
        };
        this.memCache = { data, timestamp: now };
        return data;
    }
    save(data) {
        this.memCache = null;
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
        return this.load().apiKeys || [];
    }
    createApiKey(name) {
        const key = this.sqlite.createApiKey(name);
        this.invalidateCache();
        this.save(this.load());
        return key;
    }
    deleteApiKey(id) {
        const res = this.sqlite.deleteApiKey(id);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    lastTouchMap = new Map();
    touchApiKey(keyString) {
        const now = Date.now();
        const last = this.lastTouchMap.get(keyString) || 0;
        // Chỉ ghi xuống SQLite tối đa 1 lần mỗi 30 giây cho mỗi key để triệt tiêu độ trễ Disk I/O trên luồng chính
        if (now - last > 30000) {
            this.lastTouchMap.set(keyString, now);
            setImmediate(() => {
                try {
                    this.sqlite.touchApiKey(keyString);
                }
                catch (_) { }
            });
        }
    }
    getCombos() {
        return this.load().combos || [];
    }
    createCombo(name, strategy, models) {
        const combo = this.sqlite.createCombo(name, strategy, models);
        this.invalidateCache();
        this.save(this.load());
        return combo;
    }
    updateCombo(id, updates) {
        const res = this.sqlite.updateCombo(id, updates);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    addModelToCombo(comboId, model) {
        const res = this.sqlite.addModelToCombo(comboId, model);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    removeModelFromCombo(comboId, model) {
        const res = this.sqlite.removeModelFromCombo(comboId, model);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    deleteCombo(id) {
        const res = this.sqlite.deleteCombo(id);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    setActiveModelInCombo(comboId, model) {
        const res = this.sqlite.setActiveModelInCombo(comboId, model);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    setSystemActiveCombo(comboId, active = true) {
        const res = this.sqlite.setSystemActiveCombo(comboId, active);
        this.invalidateCache();
        if (res)
            this.save(this.load());
        return res;
    }
    getActiveSystemCombo() {
        const combos = this.load().combos || [];
        return combos.find((c) => c.isActive) || null;
    }
    getStorageDirectory() {
        return this.baseDir;
    }
    getBackupDir() {
        const dir = path_1.default.join(this.baseDir, 'backups');
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        return dir;
    }
    createLocalSnapshot(reason = 'manual') {
        const data = this.load();
        const settings = this.sqlite.getAllSettings();
        const now = new Date();
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '');
        const filename = `snapshot-${stamp}-${safeReason}.json`;
        const filePath = path_1.default.join(this.getBackupDir(), filename);
        const payload = {
            app: 'switch-google',
            version: '1.3.3',
            exportedAt: now.toISOString(),
            reason,
            storage: data,
            settings
        };
        const jsonStr = JSON.stringify(payload, null, 2);
        fs_1.default.writeFileSync(filePath, jsonStr, { mode: 0o600 });
        // Giữ tối đa 15 bản snapshot tự động (auto- / pre-) gần nhất; KHÔNG tự động xóa các bản manual của User (SPEC-007 Điều kiện 4)
        try {
            const files = fs_1.default.readdirSync(this.getBackupDir())
                .filter(f => f.startsWith('snapshot-') && f.endsWith('.json') && !f.endsWith('-manual.json'))
                .map(f => ({
                name: f,
                fullPath: path_1.default.join(this.getBackupDir(), f),
                mtime: fs_1.default.statSync(path_1.default.join(this.getBackupDir(), f)).mtimeMs
            }))
                .sort((a, b) => b.mtime - a.mtime);
            for (const old of files.slice(15)) {
                try {
                    fs_1.default.unlinkSync(old.fullPath);
                }
                catch (_) { }
            }
        }
        catch (_) { }
        const stat = fs_1.default.statSync(filePath);
        return {
            filename,
            path: filePath,
            size: stat.size,
            createdAt: stat.mtimeMs,
            profileCount: Object.keys(data.profiles || {}).length
        };
    }
    listLocalSnapshots() {
        try {
            const dir = this.getBackupDir();
            const files = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json'));
            const list = files.map(f => {
                const full = path_1.default.join(dir, f);
                const stat = fs_1.default.statSync(full);
                let profileCount = 0;
                let reason = 'snapshot';
                try {
                    const parsed = JSON.parse(fs_1.default.readFileSync(full, 'utf8'));
                    const profs = parsed?.storage?.profiles || parsed?.data?.profiles || parsed?.profiles || {};
                    profileCount = Object.keys(profs).length;
                    if (parsed?.reason)
                        reason = parsed.reason;
                }
                catch (_) { }
                return {
                    filename: f,
                    size: stat.size,
                    createdAt: stat.mtimeMs,
                    profileCount,
                    reason
                };
            });
            return list.sort((a, b) => b.createdAt - a.createdAt);
        }
        catch (_) {
            return [];
        }
    }
    restoreLocalSnapshot(filename) {
        const safeName = path_1.default.basename(filename);
        const full = path_1.default.join(this.getBackupDir(), safeName);
        if (!fs_1.default.existsSync(full)) {
            throw new Error('Không tìm thấy bản sao lưu: ' + safeName);
        }
        const raw = fs_1.default.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        const storageObj = parsed.storage || parsed.data || parsed;
        const restoredProfiles = this.importBackup(JSON.stringify({ data: storageObj }));
        if (parsed.settings && typeof parsed.settings === 'object') {
            for (const [k, v] of Object.entries(parsed.settings)) {
                if (typeof v === 'string') {
                    this.sqlite.setSetting(k, v);
                }
            }
        }
        this.invalidateCache();
        return {
            restoredProfiles,
            totalProfiles: Object.keys(this.load().profiles || {}).length
        };
    }
    deleteLocalSnapshot(filename) {
        const safeName = path_1.default.basename(filename);
        const full = path_1.default.join(this.getBackupDir(), safeName);
        if (fs_1.default.existsSync(full)) {
            fs_1.default.unlinkSync(full);
            return true;
        }
        return false;
    }
    exportEncryptedBackup(passphrase) {
        const data = this.load();
        const settings = this.sqlite.getAllSettings();
        const plainPayload = JSON.stringify({
            app: 'switch-google',
            version: '1.3.3',
            exportedAt: new Date().toISOString(),
            storage: data,
            settings
        });
        if (passphrase && passphrase.trim().length > 0) {
            const salt = crypto_1.default.randomBytes(16);
            const key = crypto_1.default.scryptSync(passphrase.trim(), salt, 32);
            const iv = crypto_1.default.randomBytes(12);
            const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
            let enc = cipher.update(plainPayload, 'utf8', 'hex');
            enc += cipher.final('hex');
            const tag = cipher.getAuthTag().toString('hex');
            return JSON.stringify({
                app: 'switch-google-encrypted-backup',
                version: '1.3.3',
                cipher: 'aes-256-gcm',
                kdf: 'scrypt',
                exportedAt: new Date().toISOString(),
                salt: salt.toString('hex'),
                iv: iv.toString('hex'),
                tag,
                ciphertext: enc
            }, null, 2);
        }
        return JSON.stringify({
            app: 'switch-google-encrypted-backup',
            version: '1.3.3',
            cipher: 'aes-256-gcm-masterkey',
            exportedAt: new Date().toISOString(),
            ciphertext: this.encrypt(plainPayload)
        }, null, 2);
    }
    importEncryptedBackup(rawContent, passphrase) {
        const parsed = JSON.parse(rawContent);
        let decryptedJson = '';
        if (parsed.kdf === 'scrypt') {
            if (!passphrase || !passphrase.trim()) {
                throw new Error('Bản sao lưu này được bảo vệ bằng mật khẩu. Vui lòng nhập mật khẩu giải mã.');
            }
            const salt = Buffer.from(parsed.salt, 'hex');
            const iv = Buffer.from(parsed.iv, 'hex');
            const tag = Buffer.from(parsed.tag, 'hex');
            const key = crypto_1.default.scryptSync(passphrase.trim(), salt, 32);
            const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            decryptedJson = decipher.update(parsed.ciphertext, 'hex', 'utf8');
            decryptedJson += decipher.final('utf8');
        }
        else if (parsed.cipher === 'aes-256-gcm-masterkey' && parsed.ciphertext) {
            decryptedJson = this.decrypt(parsed.ciphertext);
        }
        else {
            throw new Error('Định dạng file sao lưu mã hóa không hợp lệ.');
        }
        const payload = JSON.parse(decryptedJson);
        const storageObj = payload.storage || payload.data || payload;
        const restoredProfiles = this.importBackup(JSON.stringify({ data: storageObj }));
        if (payload.settings && typeof payload.settings === 'object') {
            for (const [k, v] of Object.entries(payload.settings)) {
                if (typeof v === 'string') {
                    this.sqlite.setSetting(k, v);
                }
            }
        }
        this.invalidateCache();
        return {
            restoredProfiles,
            totalProfiles: Object.keys(this.load().profiles || {}).length
        };
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
            const keyMap = new Map();
            for (const k of current.apiKeys || [])
                keyMap.set(k.id, k);
            for (const k of backupData.apiKeys) {
                this.sqlite.saveApiKey(k);
                keyMap.set(k.id, k);
            }
            current.apiKeys = Array.from(keyMap.values());
        }
        if (Array.isArray(backupData.combos)) {
            const comboMap = new Map();
            for (const c of current.combos || [])
                comboMap.set(c.id, c);
            for (const c of backupData.combos) {
                this.sqlite.saveCombo(c);
                comboMap.set(c.id, c);
            }
            current.combos = Array.from(comboMap.values());
        }
        this.save(current);
        this.invalidateCache();
        return importedCount;
    }
    exportSqliteBuffer() {
        return this.sqlite.exportDatabaseBuffer();
    }
    importSqliteBuffer(buffer) {
        try {
            this.createLocalSnapshot('auto-pre-restore-sqlite');
        }
        catch (_) { }
        this.sqlite.importDatabaseBuffer(buffer);
        this.invalidateCache();
    }
}
exports.ProfileStorage = ProfileStorage;
