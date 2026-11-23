import { ProfileManager } from '../profiles/manager';

export const DEFAULT_MODEL_FALLBACKS: Record<string, string[]> = {
  // Flash family
  'gemini-3.8-flash': ['gemini-3.8-flash', 'gemini-4-argon', 'claude-3-7-sonnet'],
  'gemini-3.8-flash-high': ['gemini-3.8-flash-high', 'gemini-4-argon-high', 'claude-sonnet-5-5-high'],
  'gemini-flash': ['gemini-3.8-flash', 'gemini-4-argon', 'claude-3-7-sonnet'],
  'flash': ['gemini-3.8-flash', 'gemini-4-argon', 'claude-3-7-sonnet'],

  // Pro / Argon family
  'gemini-3.8-pro': ['gemini-3.8-pro', 'gemini-3.8-flash', 'claude-3-7-sonnet'],
  'gemini-4-argon': ['gemini-4-argon', 'gemini-3.8-flash', 'claude-3-7-sonnet'],
  'gemini-4-argon-high': ['gemini-4-argon-high', 'gemini-3.8-flash-high', 'claude-sonnet-5-5-high'],
  'gemini-pro': ['gemini-4-argon', 'gemini-3.8-flash', 'claude-3-7-sonnet'],
  'gpt-4o': ['gemini-4-argon', 'gemini-3.8-flash', 'claude-3-7-sonnet'],

  // Claude family
  'claude-3-7-sonnet': ['claude-3-7-sonnet', 'gemini-4-argon', 'gemini-3.8-flash'],
  'claude-sonnet-5-5-high': ['claude-sonnet-5-5-high', 'gemini-4-argon-high', 'gemini-3.8-flash-high'],
  'claude-3-5-sonnet': ['claude-3-7-sonnet', 'gemini-4-argon', 'gemini-3.8-flash'],
  'claude-3-opus': ['claude-3-7-sonnet', 'gemini-4-argon', 'gemini-3.8-flash']
};

export class ModelFallbackManager {
  private manager: ProfileManager;

  constructor(manager: ProfileManager) {
    this.manager = manager;
  }

  public isAutoFallbackEnabled(): boolean {
    const val = this.manager.getStorage().getSqlite().getSetting('auto_model_fallback', 'true');
    return val !== 'false';
  }

  public setAutoFallbackEnabled(enabled: boolean): void {
    this.manager.getStorage().getSqlite().setSetting('auto_model_fallback', enabled ? 'true' : 'false');
  }

  public getFallbackChain(model: string): string[] {
    if (!this.isAutoFallbackEnabled()) {
      return [model];
    }

    const key = model.toLowerCase().trim();
    if (DEFAULT_MODEL_FALLBACKS[key]) {
      return [...DEFAULT_MODEL_FALLBACKS[key]];
    }

    if (key.includes('flash')) {
      return [model, 'gemini-4-argon', 'claude-3-7-sonnet'];
    }
    if (key.includes('argon') || key.includes('pro') || key.includes('gpt')) {
      return [model, 'gemini-3.8-flash', 'claude-3-7-sonnet'];
    }
    if (key.includes('claude') || key.includes('sonnet') || key.includes('opus')) {
      return [model, 'gemini-4-argon', 'gemini-3.8-flash'];
    }

    return [model, 'gemini-3.8-flash', 'gemini-4-argon'];
  }

  public getUpstreamFallbackChain(upstreamModel: string): string[] {
    if (!this.isAutoFallbackEnabled()) {
      return [upstreamModel];
    }

    const key = upstreamModel.toLowerCase().trim();
    if (DEFAULT_MODEL_FALLBACKS[key]) {
      return [...DEFAULT_MODEL_FALLBACKS[key]];
    }

    if (key.includes('flash')) {
      return [upstreamModel, 'gemini-4-argon-high', 'claude-sonnet-5-5-high'];
    }
    if (key.includes('argon') || key.includes('pro')) {
      return [upstreamModel, 'gemini-3.8-flash-high', 'claude-sonnet-5-5-high'];
    }
    if (key.includes('claude') || key.includes('sonnet')) {
      return [upstreamModel, 'gemini-4-argon-high', 'gemini-3.8-flash-high'];
    }

    return [upstreamModel, 'gemini-3.8-flash-high', 'gemini-4-argon-high'];
  }
}

/**
 * Chuẩn hóa tên model hiển thị sạch cho người dùng và dashboard UI
 * (Bao gồm các định danh nội bộ Google CloudCode như -high suffix)
 */
export function normalizeDisplayModel(model: string): string {
  if (!model) return 'gemini-3.8-flash';
  const m = model.toLowerCase().trim();

  // Claude models
  if (m === 'claude-sonnet-5-5-high' || m.includes('claude-3-7-sonnet') || m.includes('claude-3.7-sonnet') || m === 'claude-sonnet') {
    return 'claude-3-7-sonnet';
  }
  if (m === 'claude-opus-5-5-high' || m.includes('claude-3-opus') || m === 'claude-opus') {
    return 'claude-3-opus';
  }
  if (m.includes('claude-3-5-sonnet') || m.includes('claude-3.5-sonnet')) {
    return 'claude-3-5-sonnet';
  }

  // Gemini models
  if (m === 'gemini-3.8-flash-high' || m === 'gemini-3.8-flash' || m === 'gemini-flash' || m === 'flash') {
    return 'gemini-3.8-flash';
  }
  if (m === 'gemini-4-argon-high' || m === 'gemini-4-argon' || m === 'gemini-3.8-pro' || m === 'gemini-pro' || m === 'argon') {
    return 'gemini-4-argon';
  }
  if (m === 'gemini-2.5-pro' || m === 'gemini-2.5-pro-preview') {
    return 'gemini-2.5-pro';
  }
  if (m === 'gemini-2.5-flash' || m === 'gemini-2.5-flash-preview') {
    return 'gemini-2.5-flash';
  }
  if (m === 'gemini-1.5-pro') {
    return 'gemini-1.5-pro';
  }
  if (m === 'gemini-1.5-flash') {
    return 'gemini-1.5-flash';
  }

  // OpenAI & DeepSeek
  if (m === 'gpt-4o' || m === 'gpt-4' || m === 'gpt-4-turbo') {
    return 'gpt-4o';
  }
  if (m.includes('deepseek-r1')) {
    return 'deepseek-r1';
  }
  if (m.includes('deepseek-v3')) {
    return 'deepseek-v3';
  }

  return model;
}

/**
 * Ánh xạ model người dùng/client chọn sang upstream model của Google CloudCode
 */
export function resolveUpstreamModel(model: string): string {
  if (!model) return 'gemini-3.8-flash-high';
  const m = model.toLowerCase().trim();

  if (m === 'claude-sonnet-5-5-high' || m.includes('claude-3-7-sonnet') || m.includes('claude-3.7-sonnet') || m.includes('claude-3-5-sonnet') || m === 'claude-sonnet') {
    return 'claude-sonnet-5-5-high';
  }
  if (m === 'claude-opus-5-5-high' || m.includes('claude-3-opus') || m === 'claude-opus') {
    return 'claude-opus-5-5-high';
  }
  if (m === 'gemini-3.8-flash-high' || m === 'gemini-3.8-flash' || m === 'gemini-flash' || m === 'flash') {
    return 'gemini-3.8-flash-high';
  }
  if (m === 'gemini-4-argon-high' || m === 'gemini-4-argon' || m === 'gemini-3.8-pro' || m === 'gemini-pro' || m.includes('argon')) {
    return 'gemini-4-argon-high';
  }
  if (m === 'gemini-2.5-pro' || m === 'gemini-2.5-pro-preview') {
    return 'gemini-2.5-pro';
  }
  if (m === 'gemini-2.5-flash' || m === 'gemini-2.5-flash-preview') {
    return 'gemini-2.5-flash';
  }
  if (m === 'gemini-1.5-pro') {
    return 'gemini-1.5-pro';
  }
  if (m === 'gemini-1.5-flash') {
    return 'gemini-1.5-flash';
  }
  if (m === 'gpt-4o' || m === 'gpt-4' || m.includes('deepseek')) {
    return 'gemini-4-argon-high';
  }

  return model;
}
