/* ==========================================================================
   Switch Google — Multi-Provider Services & Smart Fallback Manager
   ========================================================================== */

export interface ExternalProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  priority: number;
  models: string[];
  isFree: boolean;
}

export const DEFAULT_PROVIDERS: ExternalProvider[] = [
  {
    id: 'opencode_free',
    name: 'OpenCode Free (Cộng đồng)',
    baseUrl: 'https://free.opencode.ai/v1',
    apiKey: '',
    enabled: true,
    priority: 1,
    models: ['glm-4-flash', 'deepseek-chat', 'qwen-2.5-coder-32b'],
    isFree: true
  },
  {
    id: 'lm_studio_local',
    name: 'LM Studio / Local Server (Offline)',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    enabled: false,
    priority: 2,
    models: ['local-model', 'qwen2.5-coder-7b', 'gemma-4-12b'],
    isFree: true
  },
  {
    id: 'ollama_local',
    name: 'Ollama Local (Tự lưu trữ)',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    enabled: false,
    priority: 3,
    models: ['llama3.3:latest', 'qwen2.5-coder:32b', 'deepseek-r1:latest'],
    isFree: true
  },
  {
    id: 'cerebras',
    name: 'Cerebras Cloud (Siêu Tốc 1800+ tok/s)',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: '',
    enabled: false,
    priority: 4,
    models: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-2.5-32b'],
    isFree: false
  },
  {
    id: 'groq',
    name: 'Groq Cloud (Ultra-Fast LPU)',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    enabled: false,
    priority: 5,
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'qwen-2.5-coder-32b'],
    isFree: false
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (DeepSeek & Qwen Ecosystem)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    enabled: false,
    priority: 6,
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    isFree: false
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Official API',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    enabled: false,
    priority: 7,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    isFree: false
  },
  {
    id: 'google_ai_studio',
    name: 'Google AI Studio (Gemini OpenAI Direct)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    enabled: false,
    priority: 8,
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    isFree: true
  },
  {
    id: 'kiro_ai',
    name: 'Kiro AI (Free Quota Tier)',
    baseUrl: 'https://api.kiro.ai/v1',
    apiKey: '',
    enabled: false,
    priority: 9,
    models: ['claude-3-7-sonnet', 'glm-5', 'minimax-m2.5'],
    isFree: true
  },
  {
    id: 'together_ai',
    name: 'Together AI (Open-Source Cloud)',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    enabled: false,
    priority: 10,
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'],
    isFree: false
  },
  {
    id: 'mistral_ai',
    name: 'Mistral AI Official (Codestral)',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: '',
    enabled: false,
    priority: 11,
    models: ['codestral-latest', 'mistral-large-latest', 'mistral-small-latest'],
    isFree: false
  },
  {
    id: 'github_models',
    name: 'GitHub Models / Azure AI (Free GitHub Token)',
    baseUrl: 'https://models.inference.ai.azure.com',
    apiKey: '',
    enabled: false,
    priority: 12,
    models: ['gpt-4o', 'gpt-4o-mini', 'Meta-Llama-3.3-70B-Instruct'],
    isFree: true
  },
  {
    id: 'glm_zhipu',
    name: 'GLM / ZhipuAI BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    enabled: false,
    priority: 13,
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
    isFree: false
  },
  {
    id: 'openrouter',
    name: 'OpenRouter.ai (Toàn bộ 200+ models)',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    enabled: false,
    priority: 14,
    models: ['anthropic/claude-3.7-sonnet', 'deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct'],
    isFree: false
  }
];

export class ExternalProviderManager {
  private static STORAGE_KEY = 'external_providers_config';

  public static getProviders(sqlite: any): ExternalProvider[] {
    try {
      const raw = sqlite.getSetting(this.STORAGE_KEY, '');
      if (!raw) {
        return DEFAULT_PROVIDERS;
      }
      const parsed: ExternalProvider[] = JSON.parse(raw);
      // Merge with default if missing or if default was expanded
      const existingMap = new Map<string, ExternalProvider>();
      for (const p of parsed) {
        existingMap.set(p.id, p);
      }
      for (const def of DEFAULT_PROVIDERS) {
        if (!existingMap.has(def.id)) {
          existingMap.set(def.id, def);
        }
      }
      const merged = Array.from(existingMap.values()).sort((a, b) => a.priority - b.priority);
      return merged;
    } catch {
      return DEFAULT_PROVIDERS;
    }
  }

  public static saveProviders(sqlite: any, providers: ExternalProvider[]): void {
    sqlite.setSetting(this.STORAGE_KEY, JSON.stringify(providers));
  }

  public static getMaskedProviders(sqlite: any): ExternalProvider[] {
    const list = this.getProviders(sqlite);
    return list.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 3)}••••••••${p.apiKey.slice(-3)}` : ''
    }));
  }

  public static updateProvider(sqlite: any, id: string, patch: Partial<ExternalProvider>): ExternalProvider[] {
    const list = this.getProviders(sqlite);
    const idx = list.findIndex((p) => p.id === id);
    if (idx !== -1) {
      // Do not overwrite key with masked stars
      if (patch.apiKey && patch.apiKey.includes('••••')) {
        delete patch.apiKey;
      }
      list[idx] = { ...list[idx], ...patch };
    } else if (patch.name && patch.baseUrl) {
      list.push({
        id,
        name: patch.name,
        baseUrl: patch.baseUrl,
        apiKey: patch.apiKey || '',
        enabled: patch.enabled !== undefined ? patch.enabled : true,
        priority: patch.priority || list.length + 1,
        models: patch.models || ['default'],
        isFree: patch.isFree || false
      });
    }
    this.saveProviders(sqlite, list);
    return this.getMaskedProviders(sqlite);
  }

  public static deleteProvider(sqlite: any, id: string): ExternalProvider[] {
    const list = this.getProviders(sqlite).filter((p) => p.id !== id);
    this.saveProviders(sqlite, list);
    return this.getMaskedProviders(sqlite);
  }

  public static getActiveFallbackProvider(sqlite: any): ExternalProvider | null {
    const list = this.getProviders(sqlite);
    const active = list.filter((p) => p.enabled && (p.isFree || (p.apiKey && p.apiKey.trim().length > 0)));
    return active.length > 0 ? active[0] : null;
  }
}
