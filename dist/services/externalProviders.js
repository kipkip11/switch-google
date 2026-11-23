"use strict";
/* ==========================================================================
   Switch Google — Multi-Provider Services & Smart Fallback Manager
   ========================================================================== */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalProviderManager = exports.DEFAULT_PROVIDERS = void 0;
exports.DEFAULT_PROVIDERS = [
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
        id: 'kiro_ai',
        name: 'Kiro AI (Free Quota Tier)',
        baseUrl: 'https://api.kiro.ai/v1',
        apiKey: '',
        enabled: false,
        priority: 2,
        models: ['claude-3-7-sonnet', 'glm-5', 'minimax-m2.5'],
        isFree: true
    },
    {
        id: 'deepseek',
        name: 'DeepSeek Official',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        enabled: false,
        priority: 3,
        models: ['deepseek-chat', 'deepseek-reasoner'],
        isFree: false
    },
    {
        id: 'glm_zhipu',
        name: 'GLM / ZhipuAI BigModel',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: '',
        enabled: false,
        priority: 4,
        models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
        isFree: false
    },
    {
        id: 'groq',
        name: 'Groq Cloud (Ultra-Fast)',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: '',
        enabled: false,
        priority: 5,
        models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
        isFree: false
    },
    {
        id: 'openrouter',
        name: 'OpenRouter.ai',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: '',
        enabled: false,
        priority: 6,
        models: ['anthropic/claude-3.7-sonnet', 'deepseek/deepseek-r1'],
        isFree: false
    }
];
class ExternalProviderManager {
    static STORAGE_KEY = 'external_providers_config';
    static getProviders(sqlite) {
        try {
            const raw = sqlite.getSetting(this.STORAGE_KEY, '');
            if (!raw) {
                return exports.DEFAULT_PROVIDERS;
            }
            const parsed = JSON.parse(raw);
            // Merge with default if missing
            const existingIds = new Set(parsed.map((p) => p.id));
            for (const def of exports.DEFAULT_PROVIDERS) {
                if (!existingIds.has(def.id)) {
                    parsed.push(def);
                }
            }
            return parsed.sort((a, b) => a.priority - b.priority);
        }
        catch {
            return exports.DEFAULT_PROVIDERS;
        }
    }
    static saveProviders(sqlite, providers) {
        sqlite.setSetting(this.STORAGE_KEY, JSON.stringify(providers));
    }
    static getMaskedProviders(sqlite) {
        const list = this.getProviders(sqlite);
        return list.map((p) => ({
            ...p,
            apiKey: p.apiKey ? `${p.apiKey.slice(0, 3)}••••••••${p.apiKey.slice(-3)}` : ''
        }));
    }
    static updateProvider(sqlite, id, patch) {
        const list = this.getProviders(sqlite);
        const idx = list.findIndex((p) => p.id === id);
        if (idx !== -1) {
            // Do not overwrite key with masked stars
            if (patch.apiKey && patch.apiKey.includes('••••')) {
                delete patch.apiKey;
            }
            list[idx] = { ...list[idx], ...patch };
        }
        else if (patch.name && patch.baseUrl) {
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
    static deleteProvider(sqlite, id) {
        const list = this.getProviders(sqlite).filter((p) => p.id !== id);
        this.saveProviders(sqlite, list);
        return this.getMaskedProviders(sqlite);
    }
    static getActiveFallbackProvider(sqlite) {
        const list = this.getProviders(sqlite);
        const active = list.filter((p) => p.enabled && (p.isFree || (p.apiKey && p.apiKey.trim().length > 0)));
        return active.length > 0 ? active[0] : null;
    }
}
exports.ExternalProviderManager = ExternalProviderManager;
