"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStorage = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
let DatabaseSyncClass = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqliteMod = require('node:sqlite');
    DatabaseSyncClass = sqliteMod.DatabaseSync;
}
catch (_) {
    // Node.js version < 22.5.0
}
class SqliteStorage {
    static instance;
    db;
    dbPath;
    baseDir;
    isSqliteSupported = true;
    constructor(customBaseDir) {
        this.baseDir = customBaseDir || path_1.default.join(os_1.default.homedir(), '.switch-google');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
        }
        this.dbPath = path_1.default.join(this.baseDir, 'switch_google.sqlite');
        if (DatabaseSyncClass) {
            this.db = new DatabaseSyncClass(this.dbPath);
            this.isSqliteSupported = true;
            this.initTables();
            this.migrateFromLegacyIfNeeded();
        }
        else {
            this.isSqliteSupported = false;
            console.warn('[SQLite] Node.js hiện tại chưa tích hợp module node:sqlite (cần Node >= 22.5.0). Chuyển sang chế độ lưu trữ an toàn.');
        }
    }
    static getInstance(customBaseDir) {
        if (customBaseDir) {
            return new SqliteStorage(customBaseDir);
        }
        if (!SqliteStorage.instance) {
            SqliteStorage.instance = new SqliteStorage();
        }
        return SqliteStorage.instance;
    }
    close() {
        try {
            this.db.close();
        }
        catch (_) { }
    }
    getDbPath() {
        return this.dbPath;
    }
    initTables() {
        // Tạo bảng profiles
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        email TEXT,
        type TEXT,
        api_key TEXT,
        tokens_json TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
        // Tạo bảng virtual_keys
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS virtual_keys (
        id TEXT PRIMARY KEY,
        name TEXT,
        key TEXT UNIQUE,
        created_at INTEGER,
        last_used_at INTEGER
      );
    `);
        // Tạo bảng model_combos
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_combos (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        strategy TEXT,
        models_json TEXT,
        created_at INTEGER
      );
    `);
        // Tạo bảng settings
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
        // Tạo bảng usage_logs
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        profile TEXT,
        email TEXT,
        model TEXT,
        virtual_key TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        latency_ms INTEGER,
        status_code INTEGER,
        stream INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_profile ON usage_logs(profile);
    `);
    }
    migrateFromLegacyIfNeeded() {
        try {
            // 1. Migrate JSON profiles if table is empty
            const countRow = this.db.prepare('SELECT COUNT(*) as count FROM profiles').get();
            if (countRow && countRow.count === 0) {
                const legacyFile = path_1.default.join(this.baseDir, 'profiles.enc.json');
                const keyFile = path_1.default.join(this.baseDir, 'master.key');
                if (fs_1.default.existsSync(legacyFile) && fs_1.default.existsSync(keyFile)) {
                    const encKey = fs_1.default.readFileSync(keyFile);
                    const ciphertext = fs_1.default.readFileSync(legacyFile, 'utf8');
                    const parts = ciphertext.split(':');
                    if (parts.length === 3) {
                        const iv = Buffer.from(parts[0], 'hex');
                        const authTag = Buffer.from(parts[1], 'hex');
                        const enc = parts[2];
                        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', encKey, iv);
                        decipher.setAuthTag(authTag);
                        let dec = decipher.update(enc, 'hex', 'utf8');
                        dec += decipher.final('utf8');
                        const data = JSON.parse(dec);
                        if (data.profiles) {
                            for (const [name, p] of Object.entries(data.profiles)) {
                                this.saveProfile(p);
                            }
                        }
                        if (data.activeProfile) {
                            this.setSetting('active_profile', data.activeProfile);
                        }
                        if (Array.isArray(data.apiKeys)) {
                            for (const k of data.apiKeys) {
                                this.saveApiKey(k);
                            }
                        }
                        if (Array.isArray(data.combos)) {
                            for (const c of data.combos) {
                                this.saveCombo(c);
                            }
                        }
                        console.log('[SQLite] Đã tự động di chuyển dữ liệu từ profiles.enc.json sang switch_google.sqlite thành công!');
                    }
                }
            }
            // 2. Migrate usage logs if empty
            const logsCount = this.db.prepare('SELECT COUNT(*) as count FROM usage_logs').get();
            if (logsCount && logsCount.count === 0) {
                const logsFile = path_1.default.join(this.baseDir, 'usage_logs.json');
                if (fs_1.default.existsSync(logsFile)) {
                    const raw = fs_1.default.readFileSync(logsFile, 'utf8');
                    const logs = JSON.parse(raw);
                    if (Array.isArray(logs)) {
                        const stmt = this.db.prepare(`
              INSERT OR REPLACE INTO usage_logs 
              (id, timestamp, profile, email, model, virtual_key, prompt_tokens, completion_tokens, total_tokens, latency_ms, status_code, stream)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
                        for (const r of logs) {
                            stmt.run(r.id, r.timestamp, r.profile || '', r.email || '', r.model || '', r.virtualKey || '', r.promptTokens || 0, r.completionTokens || 0, r.totalTokens || 0, r.latencyMs || 0, r.statusCode || 200, r.stream ? 1 : 0);
                        }
                        console.log(`[SQLite] Đã di chuyển ${logs.length} bản ghi nhật ký sang switch_google.sqlite.`);
                    }
                }
            }
        }
        catch (e) {
            console.warn('[SQLite] Cảnh báo di chuyển dữ liệu cũ:', e.message);
        }
    }
    // Settings
    getSetting(key, defaultValue = '') {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : defaultValue;
    }
    setSetting(key, value) {
        this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
    getRotationConfig() {
        const reqStr = this.getSetting('rotation_requests_per_turn', '1');
        const tokStr = this.getSetting('rotation_tokens_per_turn', '50000');
        const strat = this.getSetting('rotation_strategy', 'round-robin');
        return {
            requestsPerTurn: Math.max(1, parseInt(reqStr, 10) || 1),
            tokensPerTurn: Math.max(1000, parseInt(tokStr, 10) || 50000),
            strategy: ['round-robin', 'least-traffic', 'fallback', 'fixed'].includes(strat) ? strat : 'round-robin'
        };
    }
    setRotationConfig(config) {
        if (config.requestsPerTurn !== undefined) {
            this.setSetting('rotation_requests_per_turn', String(Math.max(1, config.requestsPerTurn)));
        }
        if (config.tokensPerTurn !== undefined) {
            this.setSetting('rotation_tokens_per_turn', String(Math.max(1000, config.tokensPerTurn)));
        }
        if (config.strategy !== undefined) {
            this.setSetting('rotation_strategy', config.strategy);
        }
    }
    // Profiles
    getAllProfiles() {
        const rows = this.db.prepare('SELECT * FROM profiles ORDER BY name ASC').all();
        return rows.map((r) => ({
            name: r.name,
            email: r.email,
            type: r.type,
            apiKey: r.api_key || undefined,
            tokens: r.tokens_json ? JSON.parse(r.tokens_json) : {},
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }));
    }
    getProfile(name) {
        const r = this.db.prepare('SELECT * FROM profiles WHERE name = ?').get(name);
        if (!r)
            return null;
        return {
            name: r.name,
            email: r.email,
            type: r.type,
            apiKey: r.api_key || undefined,
            tokens: r.tokens_json ? JSON.parse(r.tokens_json) : {},
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    }
    saveProfile(profile) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO profiles 
      (name, email, type, api_key, tokens_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(profile.name, profile.email || '', profile.type || 'oauth', profile.apiKey || null, JSON.stringify(profile.tokens || {}), profile.createdAt || Date.now(), profile.updatedAt || Date.now());
    }
    deleteProfile(name) {
        const res = this.db.prepare('DELETE FROM profiles WHERE name = ?').run(name);
        const active = this.getSetting('active_profile');
        if (active === name) {
            const remaining = this.getAllProfiles();
            this.setSetting('active_profile', remaining.length > 0 ? remaining[0].name : '');
        }
        return res.changes > 0;
    }
    getActiveProfile() {
        const active = this.getSetting('active_profile');
        if (active && this.getProfile(active))
            return active;
        const all = this.getAllProfiles();
        return all.length > 0 ? all[0].name : null;
    }
    setActiveProfile(name) {
        this.setSetting('active_profile', name);
    }
    // Virtual API Keys
    getApiKeys() {
        const rows = this.db.prepare('SELECT * FROM virtual_keys ORDER BY created_at DESC').all();
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            key: r.key,
            createdAt: r.created_at,
            lastUsedAt: r.last_used_at || undefined
        }));
    }
    saveApiKey(k) {
        this.db.prepare(`
      INSERT OR REPLACE INTO virtual_keys (id, name, key, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(k.id, k.name, k.key, k.createdAt, k.lastUsedAt || null);
    }
    createApiKey(name) {
        const randomHex = crypto_1.default.randomBytes(24).toString('hex');
        const newKey = {
            id: 'key_' + Date.now().toString(36),
            name: name.trim(),
            key: `sk-switch-${randomHex}`,
            createdAt: Date.now()
        };
        this.saveApiKey(newKey);
        return newKey;
    }
    deleteApiKey(id) {
        const res = this.db.prepare('DELETE FROM virtual_keys WHERE id = ? OR key = ?').run(id, id);
        return res.changes > 0;
    }
    touchApiKey(keyString) {
        this.db.prepare('UPDATE virtual_keys SET last_used_at = ? WHERE key = ?').run(Date.now(), keyString);
    }
    // Model Combos
    getCombos() {
        const rows = this.db.prepare('SELECT * FROM model_combos ORDER BY created_at ASC').all();
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            strategy: r.strategy,
            models: r.models_json ? JSON.parse(r.models_json) : [],
            createdAt: r.created_at
        }));
    }
    getCombo(idOrName) {
        const r = this.db.prepare('SELECT * FROM model_combos WHERE id = ? OR name = ?').get(idOrName, idOrName);
        if (!r)
            return null;
        return {
            id: r.id,
            name: r.name,
            strategy: r.strategy,
            models: r.models_json ? JSON.parse(r.models_json) : [],
            createdAt: r.created_at
        };
    }
    saveCombo(combo) {
        this.db.prepare(`
      INSERT OR REPLACE INTO model_combos (id, name, strategy, models_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(combo.id, combo.name, combo.strategy, JSON.stringify(combo.models || []), combo.createdAt);
    }
    createCombo(name, strategy, models) {
        const existing = this.getCombo(name.trim());
        const combo = {
            id: existing ? existing.id : 'combo_' + Date.now().toString(36),
            name: name.trim(),
            strategy,
            models: models.filter((m) => m && m.trim().length > 0),
            createdAt: existing ? existing.createdAt : Date.now()
        };
        this.saveCombo(combo);
        return combo;
    }
    updateCombo(id, updates) {
        const combo = this.getCombo(id);
        if (!combo)
            return null;
        if (updates.name !== undefined)
            combo.name = updates.name.trim();
        if (updates.strategy !== undefined)
            combo.strategy = updates.strategy;
        if (updates.models !== undefined) {
            combo.models = updates.models.filter((m) => m && m.trim().length > 0);
        }
        this.saveCombo(combo);
        return combo;
    }
    addModelToCombo(comboId, model) {
        const combo = this.getCombo(comboId);
        if (!combo)
            return null;
        const cleanModel = model.trim();
        if (cleanModel && !combo.models.includes(cleanModel)) {
            combo.models.push(cleanModel);
            this.saveCombo(combo);
        }
        return combo;
    }
    removeModelFromCombo(comboId, model) {
        const combo = this.getCombo(comboId);
        if (!combo)
            return null;
        combo.models = combo.models.filter((m) => m !== model && m !== model.trim());
        this.saveCombo(combo);
        return combo;
    }
    deleteCombo(id) {
        const res = this.db.prepare('DELETE FROM model_combos WHERE id = ? OR name = ?').run(id, id);
        return res.changes > 0;
    }
    // Usage Logs
    recordUsage(r) {
        const entry = {
            id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
            timestamp: Date.now(),
            ...r
        };
        this.db.prepare(`
      INSERT INTO usage_logs 
      (id, timestamp, profile, email, model, virtual_key, prompt_tokens, completion_tokens, total_tokens, latency_ms, status_code, stream)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.timestamp, entry.profile || '', entry.email || '', entry.model || '', entry.virtualKey || '', entry.promptTokens || 0, entry.completionTokens || 0, entry.totalTokens || 0, entry.latencyMs || 0, entry.statusCode || 200, entry.stream ? 1 : 0);
        // Keep table size manageable (limit to latest 10,000 entries)
        try {
            this.db.exec(`
        DELETE FROM usage_logs WHERE id NOT IN (
          SELECT id FROM usage_logs ORDER BY timestamp DESC LIMIT 10000
        );
      `);
        }
        catch (_) { }
        return entry;
    }
    getUsageLogs(limit = 100) {
        const rows = this.db.prepare(`
      SELECT * FROM usage_logs ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
        return rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            profile: r.profile,
            email: r.email,
            model: r.model,
            virtualKey: r.virtual_key,
            promptTokens: r.prompt_tokens,
            completionTokens: r.completion_tokens,
            totalTokens: r.total_tokens,
            latencyMs: r.latency_ms,
            statusCode: r.status_code,
            stream: Boolean(r.stream)
        }));
    }
    getUsageStats(timeframeMs) {
        const cutoff = timeframeMs ? Date.now() - timeframeMs : 0;
        const rows = this.db.prepare(`
      SELECT * FROM usage_logs WHERE timestamp >= ? ORDER BY timestamp ASC
    `).all(cutoff);
        let totalTokens = 0;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        const tokensByModel = {};
        const tokensByAccount = {};
        const requestsByAccount = {};
        for (const r of rows) {
            totalTokens += r.total_tokens || 0;
            totalPromptTokens += r.prompt_tokens || 0;
            totalCompletionTokens += r.completion_tokens || 0;
            const m = r.model || 'unknown';
            tokensByModel[m] = (tokensByModel[m] || 0) + (r.total_tokens || 0);
            const acc = r.profile || r.email || 'unknown';
            tokensByAccount[acc] = (tokensByAccount[acc] || 0) + (r.total_tokens || 0);
            requestsByAccount[acc] = (requestsByAccount[acc] || 0) + 1;
        }
        return {
            totalRequests: rows.length,
            totalTokens,
            totalPromptTokens,
            totalCompletionTokens,
            tokensByModel,
            tokensByAccount,
            requestsByAccount
        };
    }
    // Backup & Restore SQLite Binary File
    exportDatabaseBuffer() {
        // Flush any pending WAL/changes
        try {
            this.db.exec('PRAGMA wal_checkpoint(FULL);');
        }
        catch (_) { }
        return fs_1.default.readFileSync(this.dbPath);
    }
    importDatabaseBuffer(buffer) {
        try {
            this.db.close();
        }
        catch (_) { }
        // Lưu backup trước khi ghi đè
        const backupOld = this.dbPath + '.bak.' + Date.now();
        if (fs_1.default.existsSync(this.dbPath)) {
            fs_1.default.copyFileSync(this.dbPath, backupOld);
        }
        fs_1.default.writeFileSync(this.dbPath, buffer);
        // Khởi tạo lại kết nối database
        if (DatabaseSyncClass) {
            this.db = new DatabaseSyncClass(this.dbPath);
            this.initTables();
        }
    }
}
exports.SqliteStorage = SqliteStorage;
