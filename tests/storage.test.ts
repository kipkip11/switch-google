import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProfileStorage, GoogleProfile } from '../src/auth/storage';

describe('ProfileStorage', () => {
  let tempDir: string;
  let storage: ProfileStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-google-test-'));
    storage = new ProfileStorage(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should initialize empty storage if no file exists', () => {
    const data = storage.load();
    expect(data.activeProfile).toBeNull();
    expect(Object.keys(data.profiles)).toHaveLength(0);
    expect(data.apiKeys).toEqual([]);
    expect(data.combos).toEqual([]);
  });

  test('should securely save and reload encrypted profile data', () => {
    const mockProfile: GoogleProfile = {
      name: 'test-account',
      email: 'test@example.com',
      type: 'oauth',
      tokens: {
        access_token: 'mock-access-token-12345',
        refresh_token: 'mock-refresh-token-67890',
        expiry_date: Date.now() + 3600000
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const initialData = {
      activeProfile: 'test-account',
      profiles: {
        'test-account': mockProfile
      },
      apiKeys: [],
      combos: []
    };

    storage.save(initialData);

    // Verify file on disk is encrypted and not plain json
    const rawFileContent = fs.readFileSync(path.join(tempDir, 'profiles.enc.json'), 'utf8');
    expect(rawFileContent).not.toContain('mock-access-token-12345');
    expect(rawFileContent.split(':')).toHaveLength(3); // iv:authTag:ciphertext

    // Verify load decrypts correctly
    const loadedData = storage.load();
    expect(loadedData.activeProfile).toBe('test-account');
    expect(loadedData.profiles['test-account']).toBeDefined();
    expect(loadedData.profiles['test-account'].tokens.access_token).toBe('mock-access-token-12345');
  });

  test('should create, list, and delete Virtual API Keys', () => {
    const key = storage.createApiKey('Claude Desktop Key');
    expect(key.id).toBeDefined();
    expect(key.name).toBe('Claude Desktop Key');
    expect(key.key.startsWith('sk-switch-')).toBe(true);

    const keys = storage.getApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe('Claude Desktop Key');

    const deleted = storage.deleteApiKey(key.id);
    expect(deleted).toBe(true);
    expect(storage.getApiKeys()).toHaveLength(0);
  });

  test('should create, list, and delete Model Combos', () => {
    const combo = storage.createCombo('Auto Pro Fallback', 'fallback', ['gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(combo.id).toBeDefined();
    expect(combo.name).toBe('Auto Pro Fallback');
    expect(combo.models).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);

    const combos = storage.getCombos();
    expect(combos).toHaveLength(1);

    const deleted = storage.deleteCombo(combo.id);
    expect(deleted).toBe(true);
    expect(storage.getCombos()).toHaveLength(0);
  });

  test('should export and import backup data successfully', () => {
    storage.createApiKey('Backup Key');
    const backupJson = storage.exportBackup();
    const parsed = JSON.parse(backupJson);
    expect(parsed.version).toBe('1.0');
    expect(parsed.data.apiKeys).toHaveLength(1);

    // Create fresh storage in new temp dir
    const secondTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-google-test2-'));
    const secondStorage = new ProfileStorage(secondTempDir);
    expect(secondStorage.getApiKeys()).toHaveLength(0);

    const restoredCount = secondStorage.importBackup(backupJson);
    expect(restoredCount).toBe(0); // 0 profiles
    expect(secondStorage.getApiKeys()).toHaveLength(1);
    expect(secondStorage.getApiKeys()[0].name).toBe('Backup Key');

    fs.rmSync(secondTempDir, { recursive: true, force: true });
  });
});
