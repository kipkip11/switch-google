import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProfileStorage } from '../src/auth/storage';
import { ProfileManager } from '../src/profiles/manager';
import { ModelFallbackManager, DEFAULT_MODEL_FALLBACKS, normalizeDisplayModel } from '../src/services/modelFallback';

describe('ModelFallbackManager', () => {
  let tempDir: string;
  let storage: ProfileStorage;
  let manager: ProfileManager;
  let fallbackMgr: ModelFallbackManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-fallback-test-'));
    storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    fallbackMgr = new ModelFallbackManager(manager);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should have auto-fallback enabled by default', () => {
    expect(fallbackMgr.isAutoFallbackEnabled()).toBe(true);
  });

  test('should allow toggling auto-fallback setting', () => {
    fallbackMgr.setAutoFallbackEnabled(false);
    expect(fallbackMgr.isAutoFallbackEnabled()).toBe(false);

    fallbackMgr.setAutoFallbackEnabled(true);
    expect(fallbackMgr.isAutoFallbackEnabled()).toBe(true);
  });

  test('should return default fallback chain for gemini-3.8-flash', () => {
    const chain = fallbackMgr.getFallbackChain('gemini-3.8-flash');
    expect(chain[0]).toBe('gemini-3.8-flash');
    expect(chain).toContain('gemini-4-argon');
    expect(chain).toContain('claude-3-7-sonnet');
  });

  test('should return upstream fallback chain for gemini-3.8-flash-high', () => {
    const chain = fallbackMgr.getUpstreamFallbackChain('gemini-3.8-flash-high');
    expect(chain[0]).toBe('gemini-3.8-flash-high');
    expect(chain).toContain('gemini-4-argon-high');
    expect(chain).toContain('claude-sonnet-5-5-high');
  });

  test('should return fallback chain for claude-3-7-sonnet', () => {
    const chain = fallbackMgr.getFallbackChain('claude-3-7-sonnet');
    expect(chain[0]).toBe('claude-3-7-sonnet');
    expect(chain).toContain('gemini-4-argon');
    expect(chain).toContain('gemini-3.8-flash');
  });

  test('should return only single model when auto-fallback is disabled', () => {
    fallbackMgr.setAutoFallbackEnabled(false);
    const chain = fallbackMgr.getFallbackChain('gemini-3.8-flash');
    expect(chain).toEqual(['gemini-3.8-flash']);

    const upstreamChain = fallbackMgr.getUpstreamFallbackChain('gemini-3.8-flash-high');
    expect(upstreamChain).toEqual(['gemini-3.8-flash-high']);
  });

  test('should handle unknown models with heuristic fallback', () => {
    const customFlash = fallbackMgr.getFallbackChain('custom-flash-model');
    expect(customFlash[0]).toBe('custom-flash-model');
    expect(customFlash).toContain('gemini-4-argon');

    const customPro = fallbackMgr.getFallbackChain('custom-pro-model');
    expect(customPro[0]).toBe('custom-pro-model');
    expect(customPro).toContain('gemini-3.8-flash');
  });

  describe('normalizeDisplayModel', () => {
    test('should normalize CloudCode internal names and aliases to clean display names', () => {
      // Claude
      expect(normalizeDisplayModel('claude-sonnet-5-5-high')).toBe('claude-3-7-sonnet');
      expect(normalizeDisplayModel('claude-3-7-sonnet')).toBe('claude-3-7-sonnet');
      expect(normalizeDisplayModel('claude-opus-5-5-high')).toBe('claude-3-opus');
      expect(normalizeDisplayModel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet');

      // Gemini Flash & Pro
      expect(normalizeDisplayModel('gemini-3.8-flash-high')).toBe('gemini-3.8-flash');
      expect(normalizeDisplayModel('gemini-3.8-flash')).toBe('gemini-3.8-flash');
      expect(normalizeDisplayModel('gemini-4-argon-high')).toBe('gemini-4-argon');
      expect(normalizeDisplayModel('gemini-4-argon')).toBe('gemini-4-argon');
      expect(normalizeDisplayModel('gemini-3.8-pro')).toBe('gemini-4-argon');
      expect(normalizeDisplayModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');

      // GPT & DeepSeek
      expect(normalizeDisplayModel('gpt-4o')).toBe('gpt-4o');
      expect(normalizeDisplayModel('deepseek-r1-distill-qwen-32b')).toBe('deepseek-r1');

      // Fallback
      expect(normalizeDisplayModel('')).toBe('gemini-3.8-flash');
      expect(normalizeDisplayModel('custom-company-model')).toBe('custom-company-model');
    });
  });
});
