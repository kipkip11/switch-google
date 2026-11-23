import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorage } from '../src/storage/sqliteStorage';

describe('SqliteStorage Engine', () => {
  let tempDir: string;
  let sqlite: SqliteStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-sqlite-test-'));
    sqlite = new SqliteStorage(tempDir);
  });

  afterEach(() => {
    sqlite.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should initialize sqlite database file on disk', () => {
    expect(fs.existsSync(sqlite.getDbPath())).toBe(true);
    expect(sqlite.getAllProfiles()).toEqual([]);
    expect(sqlite.getApiKeys()).toEqual([]);
    expect(sqlite.getCombos()).toEqual([]);
  });

  test('should configure and persist rotation config in sqlite settings table', () => {
    const initialConfig = sqlite.getRotationConfig();
    expect(initialConfig.requestsPerTurn).toBe(1);
    expect(initialConfig.strategy).toBe('round-robin');

    sqlite.setRotationConfig({
      requestsPerTurn: 3,
      tokensPerTurn: 75000,
      strategy: 'least-traffic'
    });

    const updatedConfig = sqlite.getRotationConfig();
    expect(updatedConfig.requestsPerTurn).toBe(3);
    expect(updatedConfig.tokensPerTurn).toBe(75000);
    expect(updatedConfig.strategy).toBe('least-traffic');
  });

  test('should support model combo full operations: add model, remove model, update combo', () => {
    const combo = sqlite.createCombo('Pro Suite', 'fallback', ['gemini-2.5-pro', 'claude-3-7-sonnet']);
    expect(combo.models).toHaveLength(2);

    // Add model
    const afterAdd = sqlite.addModelToCombo(combo.id, 'deepseek-r1');
    expect(afterAdd?.models).toContain('deepseek-r1');
    expect(afterAdd?.models).toHaveLength(3);

    // Remove model
    const afterRemove = sqlite.removeModelFromCombo(combo.id, 'claude-3-7-sonnet');
    expect(afterRemove?.models).not.toContain('claude-3-7-sonnet');
    expect(afterRemove?.models).toHaveLength(2);

    // Update combo
    const updated = sqlite.updateCombo(combo.id, { name: 'Pro Suite v2', strategy: 'round-robin' });
    expect(updated?.name).toBe('Pro Suite v2');
    expect(updated?.strategy).toBe('round-robin');

    // Select active model in combo
    const withActive = sqlite.setActiveModelInCombo(combo.id, 'deepseek-r1');
    expect(withActive?.activeModel).toBe('deepseek-r1');

    // Activate combo as system default
    const activated = sqlite.setSystemActiveCombo(combo.id, true);
    expect(activated?.isActive).toBe(true);
    const activeSystem = sqlite.getActiveSystemCombo();
    expect(activeSystem?.id).toBe(combo.id);
    expect(activeSystem?.activeModel).toBe('deepseek-r1');

    // Delete combo
    const deleted = sqlite.deleteCombo(combo.id);
    expect(deleted).toBe(true);
    expect(sqlite.getCombos()).toHaveLength(0);
  });

  test('should record usage logs and calculate stats correctly', () => {
    sqlite.recordUsage({
      profile: 'acc1',
      email: 'acc1@gmail.com',
      model: 'gemini-3.8-flash',
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      latencyMs: 350,
      statusCode: 200,
      stream: true
    });

    const logs = sqlite.getUsageLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].totalTokens).toBe(700);

    const stats = sqlite.getUsageStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalTokens).toBe(700);
    expect(stats.tokensByAccount['acc1']).toBe(700);
  });

  test('should export and import binary SQLite database buffer', () => {
    sqlite.setSetting('app_title', 'Google Switch Test');
    const exportedBuffer = sqlite.exportDatabaseBuffer();
    expect(Buffer.isBuffer(exportedBuffer)).toBe(true);
    expect(exportedBuffer.length).toBeGreaterThan(0);

    // Create another clean database and import the buffer
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-sqlite-import-test-'));
    const sqlite2 = new SqliteStorage(tempDir2);
    sqlite2.importDatabaseBuffer(exportedBuffer);

    expect(sqlite2.getSetting('app_title')).toBe('Google Switch Test');

    sqlite2.close();
    fs.rmSync(tempDir2, { recursive: true, force: true });
  });
});
