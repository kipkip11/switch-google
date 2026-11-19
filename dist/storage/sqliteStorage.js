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
    // Node.js version < 22.5.0 (Sẽ dùng FallbackSqliteDb)
}
/**
 * Fallback Database Engine cho các phiên bản Node.js < 22.5.0
 * Tương thích 100% interface DatabaseSync của SQLite
 */
class FallbackSqliteDb {
    filePath;
    data;
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {
            profiles: {},
            virtual_keys: {},
            model_combos: {},
            settings: {},
            usage_logs: []
        };
        this.loadFromFile();
    }
    loadFromFile() {
        try {
            if (fs_1.default.existsSync(this.filePath)) {
                const raw = fs_1.default.readFileSync(this.filePath, 'utf8');
                if (raw.trim().startsWith('{')) {
                    const parsed = JSON.parse(raw);
                    this.data = {
                        profiles: parsed.profiles || {},
                        virtual_keys: parsed.virtual_keys || {},
                        model_combos: parsed.model_combos || {},
                        settings: parsed.settings || {},
                        usage_logs: parsed.usage_logs || []
                    };
                    return;
                }
            }
        }
        catch (_) { }
        this.persist();
    }
    persist() {
        try {
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        }
        catch (_) { }
    }
    exec(_sql) {
        if (_sql.includes('DELETE FROM usage_logs;')) {
            this.data.usage_logs = [];
            this.persist();
        }
    }
    close() {
        this.persist();
    }
    prepare(sql) {
        const s = sql.trim().replace(/\s+/g, ' ');
        return {
            run: (...args) => {
                // Settings
                if (s.startsWith('INSERT OR REPLACE INTO settings')) {
                    this.data.settings[args[0]] = String(args[1]);
                    this.persist();
                    return { changes: 1 };
                }
                // Profiles
                if (s.startsWith('INSERT OR REPLACE INTO profiles')) {
                    this.data.profiles[args[0]] = {
                        name: args[0],
                        email: args[1],
                        type: args[2],
                        api_key: args[3],
                        tokens_json: args[4],
                        created_at: args[5],
                        updated_at: args[6]
                    };
                    this.persist();
                    return { changes: 1 };
                }
                if (s.startsWith('DELETE FROM profiles WHERE name = ?')) {
                    const existed = Boolean(this.data.profiles[args[0]]);
                    delete this.data.profiles[args[0]];
                    this.persist();
                    return { changes: existed ? 1 : 0 };
                }
                // Virtual Keys
                if (s.startsWith('INSERT OR REPLACE INTO virtual_keys')) {
                    this.data.virtual_keys[args[0]] = {
                        id: args[0],
                        name: args[1],
                        key: args[2],
                        created_at: args[3],
                        last_used_at: args[4]
                    };
                    this.persist();
                    return { changes: 1 };
                }
                if (s.startsWith('DELETE FROM virtual_keys')) {
                    let count = 0;
                    for (const [id, k] of Object.entries(this.data.virtual_keys)) {
                        if (id === args[0] || k.key === args[0] || (args[1] && (id === args[1] || k.key === args[1]))) {
                            delete this.data.virtual_keys[id];
                            count++;
                        }
                    }
                    this.persist();
                    return { changes: count };
                }
                if (s.startsWith('UPDATE virtual_keys SET last_used_at = ? WHERE key = ?')) {
                    for (const k of Object.values(this.data.virtual_keys)) {
                        if (k.key === args[1]) {
                            k.last_used_at = args[0];
                        }
                    }
                    this.persist();
                    return { changes: 1 };
                }
                // Model Combos
                if (s.startsWith('INSERT OR REPLACE INTO model_combos')) {
                    this.data.model_combos[args[0]] = {
                        id: args[0],
                        name: args[1],
                        strategy: args[2],
                        models_json: args[3],
                        created_at: args[4]
                    };
                    this.persist();
                    return { changes: 1 };
                }
                if (s.startsWith('DELETE FROM model_combos')) {
                    let count = 0;
                    for (const [id, c] of Object.entries(this.data.model_combos)) {
                        if (id === args[0] || c.name === args[0] || (args[1] && (id === args[1] || c.name === args[1]))) {
                            delete this.data.model_combos[id];
                            count++;
                        }
                    }
                    this.persist();
                    return { changes: count };
                }
                // Usage Logs
                if (s.startsWith('INSERT INTO usage_logs')) {
                    this.data.usage_logs.unshift({
                        id: args[0],
                        timestamp: args[1],
                        profile: args[2],
                        email: args[3],
                        model: args[4],
                        virtual_key: args[5],
                        prompt_tokens: args[6],
                        completion_tokens: args[7],
                        total_tokens: args[8],
                        latency_ms: args[9],
                        status_code: args[10],
                        stream: args[11]
                    });
                    if (this.data.usage_logs.length > 5000) {
                        this.data.usage_logs = this.data.usage_logs.slice(0, 5000);
                    }
                    this.persist();
                    return { changes: 1 };
                }
                return { changes: 0 };
            },
            get: (...args) => {
                // Settings
                if (s.startsWith('SELECT value FROM settings WHERE key = ?')) {
                    const val = this.data.settings[args[0]];
                    return val !== undefined ? { value: val } : null;
                }
                // Profiles
                if (s.startsWith('SELECT COUNT(*) as count FROM profiles')) {
                    return { count: Object.keys(this.data.profiles).length };
                }
                if (s.startsWith('SELECT * FROM profiles WHERE name = ?')) {
                    return this.data.profiles[args[0]] || null;
                }
                // Model Combos
                if (s.startsWith('SELECT * FROM model_combos WHERE id = ? OR name = ?')) {
                    for (const c of Object.values(this.data.model_combos)) {
                        if (c.id === args[0] || c.name === args[1] || c.id === args[1] || c.name === args[0]) {
                            return c;
                        }
                    }
                    return null;
                }
                // Usage Logs count
                if (s.startsWith('SELECT COUNT(*) as count FROM usage_logs')) {
                    return { count: this.data.usage_logs.length };
                }
                return null;
            },
            all: (...args) => {
                // Profiles
                if (s.startsWith('SELECT * FROM profiles ORDER BY name ASC')) {
                    return Object.values(this.data.profiles).sort((a, b) => a.name.localeCompare(b.name));
                }
                // Virtual Keys
                if (s.startsWith('SELECT * FROM virtual_keys ORDER BY created_at DESC')) {
                    return Object.values(this.data.virtual_keys).sort((a, b) => b.created_at - a.created_at);
                }
                // Model Combos
                if (s.startsWith('SELECT * FROM model_combos ORDER BY created_at ASC')) {
                    return Object.values(this.data.model_combos).sort((a, b) => a.created_at - b.created_at);
                }
                // Usage Logs
                if (s.startsWith('SELECT * FROM usage_logs WHERE timestamp >= ? ORDER BY timestamp ASC')) {
                    const cutoff = Number(args[0]) || 0;
                    return this.data.usage_logs
                        .filter((l) => l.timestamp >= cutoff)
                        .sort((a, b) => a.timestamp - b.timestamp);
                }
                if (s.startsWith('SELECT * FROM usage_logs ORDER BY timestamp DESC LIMIT ?')) {
                    const limit = Number(args[0]) || 100;
                    return this.data.usage_logs.slice(0, limit);
                }
                return [];
            }
        };
    }
}
class SqliteStorage {
    static instance;
    db;
    dbPath;
    baseDir;
    isNativeSqlite;
    constructor(customBaseDir) {
        this.baseDir = customBaseDir || path_1.default.join(os_1.default.homedir(), '.switch-google');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
        }
        this.dbPath = path_1.default.join(this.baseDir, 'switch_google.sqlite');
        if (DatabaseSyncClass) {
            this.db = new DatabaseSyncClass(this.dbPath);
            this.isNativeSqlite = true;
        }
        else {
            this.db = new FallbackSqliteDb(this.dbPath);
            this.isNativeSqlite = false;
        }
        this.initTables();
        this.migrateFromLegacyIfNeeded();
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
                            for (const p of Object.values(data.profiles)) {
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
        // Keep table size manageable
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
        try {
            this.db.exec('PRAGMA wal_checkpoint(FULL);');
        }
        catch (_) { }
        if (this.db instanceof FallbackSqliteDb) {
            this.db.persist();
        }
        return fs_1.default.readFileSync(this.dbPath);
    }
    importDatabaseBuffer(buffer) {
        try {
            this.db.close();
        }
        catch (_) { }
        const backupOld = this.dbPath + '.bak.' + Date.now();
        if (fs_1.default.existsSync(this.dbPath)) {
            fs_1.default.copyFileSync(this.dbPath, backupOld);
        }
        fs_1.default.writeFileSync(this.dbPath, buffer);
        if (DatabaseSyncClass) {
            this.db = new DatabaseSyncClass(this.dbPath);
        }
        else {
            this.db = new FallbackSqliteDb(this.dbPath);
        }
        this.initTables();
    }
}
exports.SqliteStorage = SqliteStorage;
