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
  strategy: 'fallback' | 'round-robin';
  models: string[];
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

  public load(): StorageData {
    const profilesList = this.sqlite.getAllProfiles();
    const profiles: Record<string, GoogleProfile> = {};
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

  public save(data: StorageData): void {
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
    return this.sqlite.getApiKeys();
  }

  public createApiKey(name: string): VirtualApiKey {
    const key = this.sqlite.createApiKey(name);
    // sync encrypted json
    this.save(this.load());
    return key;
  }

  public deleteApiKey(id: string): boolean {
    const res = this.sqlite.deleteApiKey(id);
    if (res) this.save(this.load());
    return res;
  }

  public touchApiKey(keyString: string): void {
    this.sqlite.touchApiKey(keyString);
  }

  public getCombos(): ModelCombo[] {
    return this.sqlite.getCombos();
  }

  public createCombo(name: string, strategy: 'fallback' | 'round-robin', models: string[]): ModelCombo {
    const combo = this.sqlite.createCombo(name, strategy, models);
    this.save(this.load());
    return combo;
  }

  public updateCombo(id: string, updates: { name?: string; strategy?: 'fallback' | 'round-robin'; models?: string[] }): ModelCombo | null {
    const res = this.sqlite.updateCombo(id, updates);
    if (res) this.save(this.load());
    return res;
  }

  public addModelToCombo(comboId: string, model: string): ModelCombo | null {
    const res = this.sqlite.addModelToCombo(comboId, model);
    if (res) this.save(this.load());
    return res;
  }

  public removeModelFromCombo(comboId: string, model: string): ModelCombo | null {
    const res = this.sqlite.removeModelFromCombo(comboId, model);
    if (res) this.save(this.load());
    return res;
  }

  public deleteCombo(id: string): boolean {
    const res = this.sqlite.deleteCombo(id);
    if (res) this.save(this.load());
    return res;
  }

  public getStorageDirectory(): string {
    return this.baseDir;
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
