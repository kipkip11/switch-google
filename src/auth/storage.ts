import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface TokenData {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

export type ProfileType = 'oauth' | 'api_key' | 'token';

export interface GoogleProfile {
  name: string;
  email: string;
  type?: ProfileType;
  apiKey?: string;
  tokens: TokenData;
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
  private storageFile: string;
  private keyFile: string;
  private encryptionKey: Buffer;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.switch-google');
    this.storageFile = path.join(this.baseDir, 'profiles.enc.json');
    this.keyFile = path.join(this.baseDir, 'master.key');

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }

    this.encryptionKey = this.getOrCreateKey();
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

  public load(): StorageData {
    if (!fs.existsSync(this.storageFile)) {
      return { activeProfile: null, profiles: {}, apiKeys: [], combos: [] };
    }

    try {
      const encryptedData = fs.readFileSync(this.storageFile, 'utf8');
      const decryptedJson = this.decrypt(encryptedData);
      const data = JSON.parse(decryptedJson) as StorageData;
      data.apiKeys = data.apiKeys || [];
      data.combos = data.combos || [];
      return data;
    } catch (err) {
      console.error('Lỗi giải mã file lưu trữ token, khởi tạo dữ liệu mặc định:', err);
      return { activeProfile: null, profiles: {}, apiKeys: [], combos: [] };
    }
  }

  public save(data: StorageData): void {
    data.apiKeys = data.apiKeys || [];
    data.combos = data.combos || [];
    const jsonStr = JSON.stringify(data, null, 2);
    const encryptedData = this.encrypt(jsonStr);
    fs.writeFileSync(this.storageFile, encryptedData, { mode: 0o600 });
  }

  public getApiKeys(): VirtualApiKey[] {
    const data = this.load();
    return data.apiKeys || [];
  }

  public createApiKey(name: string): VirtualApiKey {
    const data = this.load();
    data.apiKeys = data.apiKeys || [];
    const randomHex = crypto.randomBytes(24).toString('hex');
    const newKey: VirtualApiKey = {
      id: 'key_' + Date.now().toString(36),
      name: name.trim(),
      key: `sk-switch-${randomHex}`,
      createdAt: Date.now()
    };
    data.apiKeys.push(newKey);
    this.save(data);
    return newKey;
  }

  public deleteApiKey(id: string): boolean {
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

  public touchApiKey(keyString: string): void {
    const data = this.load();
    const item = data.apiKeys?.find((k) => k.key === keyString);
    if (item) {
      item.lastUsedAt = Date.now();
      this.save(data);
    }
  }

  public getCombos(): ModelCombo[] {
    const data = this.load();
    return data.combos || [];
  }

  public createCombo(name: string, strategy: 'fallback' | 'round-robin', models: string[]): ModelCombo {
    const data = this.load();
    data.combos = data.combos || [];
    const existingIndex = data.combos.findIndex((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    const combo: ModelCombo = {
      id: 'combo_' + Date.now().toString(36),
      name: name.trim(),
      strategy,
      models: models.filter((m) => m && m.trim().length > 0),
      createdAt: Date.now()
    };
    if (existingIndex >= 0) {
      data.combos[existingIndex] = combo;
    } else {
      data.combos.push(combo);
    }
    this.save(data);
    return combo;
  }

  public deleteCombo(id: string): boolean {
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
    const current = this.load();
    let importedCount = 0;

    if (backupData.profiles) {
      for (const [name, prof] of Object.entries(backupData.profiles as Record<string, GoogleProfile>)) {
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
