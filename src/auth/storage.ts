import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SqliteStorage } from '../storage/sqliteStorage';

export interface TokenData {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

export type ProfileType = 'oauth' | 'api_key' | 'token' | 'web_session';

export interface GoogleProfile {
  name: string;
  email: string;
  tokens: TokenData;
  apiKey?: string;
  cookies?: string;
  type?: ProfileType;
  isBlockedAntigravity?: boolean;
  planTier?: string;
  planExpiresAt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VirtualApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface ModelCombo {
  id: string;
  name: string;
  strategy: 'fallback' | 'round-robin' | 'smart-routing';
  models: string[];
  activeModel?: string;
  isActive?: boolean;
  createdAt: number;
}

export interface StorageData {
  activeProfile: string | null;
  profiles: Record<string, GoogleProfile>;
  apiKeys?: VirtualApiKey[];
  combos?: ModelCombo[];
}

export class ProfileStorage {
  private baseDir: string;
  private sqlite: SqliteStorage;
  private storageFile: string;
  private keyFile: string;
  private encryptionKey: Buffer;
  private memCache: { data: StorageData; timestamp: number } | null = null;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.switch-google');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    this.storageFile = path.join(this.baseDir, 'profiles.enc.json');
    this.keyFile = path.join(this.baseDir, 'master.key');
    this.encryptionKey = this.getOrCreateKey();
    this.sqlite = SqliteStorage.getInstance(this.baseDir);
  }

  private getOrCreateKey(): Buffer {
    if (fs.existsSync(this.keyFile)) {
      return fs.readFileSync(this.keyFile);
    }
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(this.keyFile, newKey, { mode: 0o600 });
    return newKey;
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  public getSqlite(): SqliteStorage {
    return this.sqlite;
  }

  public close(): void {
    this.sqlite.close();
  }

  public invalidateCache(): void {
    this.memCache = null;
  }

  public load(): StorageData {
    const now = Date.now();
    if (this.memCache && now - this.memCache.timestamp < 2000) {
      return this.memCache.data;
    }

    const profilesList = this.sqlite.getAllProfiles();
    const profiles: Record<string, GoogleProfile> = {};
    for (const p of profilesList) {
      profiles[p.name] = p;
    }

    const activeProfile = this.sqlite.getActiveProfile();
    const apiKeys = this.sqlite.getApiKeys();
    const combos = this.sqlite.getCombos();

    const data: StorageData = {
      activeProfile,
      profiles,
      apiKeys,
      combos
    };
    this.memCache = { data, timestamp: now };
    return data;
  }

  public save(data: StorageData): void {
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
      fs.writeFileSync(this.storageFile, encryptedData, { mode: 0o600 });
    } catch (_) {}
  }

  public getApiKeys(): VirtualApiKey[] {
    return this.load().apiKeys || [];
  }

  public createApiKey(name: string): VirtualApiKey {
    const key = this.sqlite.createApiKey(name);
    this.invalidateCache();
    this.save(this.load());
    return key;
  }

  public deleteApiKey(id: string): boolean {
    const res = this.sqlite.deleteApiKey(id);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  private lastTouchMap: Map<string, number> = new Map();
  public touchApiKey(keyString: string): void {
    const now = Date.now();
    const last = this.lastTouchMap.get(keyString) || 0;
    // Chỉ ghi xuống SQLite tối đa 1 lần mỗi 30 giây cho mỗi key để triệt tiêu độ trễ Disk I/O trên luồng chính
    if (now - last > 30000) {
      this.lastTouchMap.set(keyString, now);
      setImmediate(() => {
        try {
          this.sqlite.touchApiKey(keyString);
        } catch (_) {}
      });
    }
  }

  public getCombos(): ModelCombo[] {
    return this.load().combos || [];
  }

  public createCombo(name: string, strategy: 'fallback' | 'round-robin' | 'smart-routing', models: string[]): ModelCombo {
    const combo = this.sqlite.createCombo(name, strategy, models);
    this.invalidateCache();
    this.save(this.load());
    return combo;
  }

  public updateCombo(id: string, updates: { name?: string; strategy?: 'fallback' | 'round-robin' | 'smart-routing'; models?: string[] }): ModelCombo | null {
    const res = this.sqlite.updateCombo(id, updates);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public addModelToCombo(comboId: string, model: string): ModelCombo | null {
    const res = this.sqlite.addModelToCombo(comboId, model);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public removeModelFromCombo(comboId: string, model: string): ModelCombo | null {
    const res = this.sqlite.removeModelFromCombo(comboId, model);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public deleteCombo(id: string): boolean {
    const res = this.sqlite.deleteCombo(id);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public setActiveModelInCombo(comboId: string, model: string): ModelCombo | null {
    const res = this.sqlite.setActiveModelInCombo(comboId, model);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public setSystemActiveCombo(comboId: string, active = true): ModelCombo | null {
    const res = this.sqlite.setSystemActiveCombo(comboId, active);
    this.invalidateCache();
    if (res) this.save(this.load());
    return res;
  }

  public getActiveSystemCombo(): ModelCombo | null {
    const combos = this.load().combos || [];
    return combos.find((c) => c.isActive) || null;
  }

  public getStorageDirectory(): string {
    return this.baseDir;
  }

  public getBackupDir(): string {
    const dir = path.join(this.baseDir, 'backups');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  public createLocalSnapshot(reason = 'manual'): { filename: string; path: string; size: number; createdAt: number; profileCount: number } {
    const data = this.load();
    const settings = this.sqlite.getAllSettings();
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `snapshot-${stamp}-${safeReason}.json`;
    const filePath = path.join(this.getBackupDir(), filename);
    const payload = {
      app: 'switch-google',
      version: '1.3.3',
      exportedAt: now.toISOString(),
      reason,
      storage: data,
      settings
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    fs.writeFileSync(filePath, jsonStr, { mode: 0o600 });

    // Giữ tối đa 20 bản snapshot gần nhất để tiết kiệm dung lượng ổ cứng
    try {
      const files = fs.readdirSync(this.getBackupDir())
        .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          fullPath: path.join(this.getBackupDir(), f),
          mtime: fs.statSync(path.join(this.getBackupDir(), f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of files.slice(20)) {
        try { fs.unlinkSync(old.fullPath); } catch (_) {}
      }
    } catch (_) {}

    const stat = fs.statSync(filePath);
    return {
      filename,
      path: filePath,
      size: stat.size,
      createdAt: stat.mtimeMs,
      profileCount: Object.keys(data.profiles || {}).length
    };
  }

  public listLocalSnapshots(): Array<{ filename: string; size: number; createdAt: number; profileCount: number; reason: string }> {
    try {
      const dir = this.getBackupDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        let profileCount = 0;
        let reason = 'snapshot';
        try {
          const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
          const profs = parsed?.storage?.profiles || parsed?.data?.profiles || parsed?.profiles || {};
          profileCount = Object.keys(profs).length;
          if (parsed?.reason) reason = parsed.reason;
        } catch (_) {}
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtimeMs,
          profileCount,
          reason
        };
      });
      return list.sort((a, b) => b.createdAt - a.createdAt);
    } catch (_) {
      return [];
    }
  }

  public restoreLocalSnapshot(filename: string): { restoredProfiles: number; totalProfiles: number } {
    const safeName = path.basename(filename);
    const full = path.join(this.getBackupDir(), safeName);
    if (!fs.existsSync(full)) {
      throw new Error('Không tìm thấy bản sao lưu: ' + safeName);
    }
    const raw = fs.readFileSync(full, 'utf8');
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

  public deleteLocalSnapshot(filename: string): boolean {
    const safeName = path.basename(filename);
    const full = path.join(this.getBackupDir(), safeName);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
      return true;
    }
    return false;
  }

  public exportEncryptedBackup(passphrase?: string): string {
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
      const salt = crypto.randomBytes(16);
      const key = crypto.scryptSync(passphrase.trim(), salt, 32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
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

  public importEncryptedBackup(rawContent: string, passphrase?: string): { restoredProfiles: number; totalProfiles: number } {
    const parsed = JSON.parse(rawContent);
    let decryptedJson = '';
    if (parsed.kdf === 'scrypt') {
      if (!passphrase || !passphrase.trim()) {
        throw new Error('Bản sao lưu này được bảo vệ bằng mật khẩu. Vui lòng nhập mật khẩu giải mã.');
      }
      const salt = Buffer.from(parsed.salt, 'hex');
      const iv = Buffer.from(parsed.iv, 'hex');
      const tag = Buffer.from(parsed.tag, 'hex');
      const key = crypto.scryptSync(passphrase.trim(), salt, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      decryptedJson = decipher.update(parsed.ciphertext, 'hex', 'utf8');
      decryptedJson += decipher.final('utf8');
    } else if (parsed.cipher === 'aes-256-gcm-masterkey' && parsed.ciphertext) {
      decryptedJson = this.decrypt(parsed.ciphertext);
    } else {
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

  public exportBackup(): string {
    const data = this.load();
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      data
    };
    return JSON.stringify(backup, null, 2);
  }

  public importBackup(backupJson: string): number {
    const parsed = JSON.parse(backupJson);
    const backupData = parsed.data || parsed.storage || parsed;
    let importedCount = 0;

    const current = this.load();
    if (backupData.profiles) {
      for (const prof of Object.values(backupData.profiles as Record<string, GoogleProfile>)) {
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

  public exportSqliteBuffer(): Buffer {
    return this.sqlite.exportDatabaseBuffer();
  }

  public importSqliteBuffer(buffer: Buffer): void {
    this.sqlite.importDatabaseBuffer(buffer);
  }
}
