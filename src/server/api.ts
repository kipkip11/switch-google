import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { ProfileManager } from '../profiles/manager';
import { AccountRotator } from '../profiles/rotator';
import { createOpenAiRouter } from './openaiAdapter';
import { usageTracker } from '../usage/tracker';

export function startApiServer(port = Number(process.env.PORT) || 1909): void {
  const app = express();
  const manager = new ProfileManager();
  const rotator = new AccountRotator(manager);

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Serve static files for Web UI
  const publicPaths = [
    path.join(__dirname, '../../public'),
    path.join(__dirname, '../public'),
    path.join(process.cwd(), 'public')
  ];
  for (const p of publicPaths) {
    if (fs.existsSync(p)) {
      app.use(express.static(p));
      break;
    }
  }

  // CORS middleware for 3rd party web or local applications
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health and active profile info
  app.get('/api/status', (req: Request, res: Response) => {
    const active = manager.getActiveProfileName();
    const profiles = manager.listProfiles();
    const usageStats = usageTracker.getStats();
    const recentLogs = usageTracker.getRecentLogs(1);
    const latestModel = recentLogs[0]?.model || 'gemini-3.8-flash';
    const ports = rotator.getPortStatuses().map(p => ({
      ...p,
      totalTokens: usageStats.tokensByAccount[p.profile] || (p.email ? usageStats.tokensByAccount[p.email] : 0) || 0
    }));
    res.json({
      status: 'online',
      activeProfile: active,
      totalProfiles: profiles.length,
      strategy: rotator.getStrategy(),
      accountStats: rotator.getStats(),
      ports,
      serving: rotator.getCurrentlyServing(),
      latestModel,
      uplink: {
        totalTokens: usageStats.totalTokens || 0,
        totalPromptTokens: usageStats.totalPromptTokens || 0,
        totalCompletionTokens: usageStats.totalCompletionTokens || 0,
        totalRequests: usageStats.totalRequests || 0,
        clients: 'Hermes / Cursor / Cline'
      },
      timestamp: new Date().toISOString()
    });
  });

  // Ping Google API for one or all profiles
  app.post('/api/ports/ping', async (req: Request, res: Response) => {
    try {
      const { profile } = req.body || {};
      const profiles = manager.listProfiles();
      const targetProfiles = profile 
        ? profiles.filter(p => p.name === profile)
        : profiles;

      const results: Record<string, { status: number; ok: boolean; message: string; latencyMs: number }> = {};

      for (const p of targetProfiles) {
        const t0 = Date.now();
        try {
          const creds = await manager.getTokenForProfile(p.name);
          let apiUrl = 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent';
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/hub/2.24.0 darwin/arm64'
          };
          let bodyObj: any = {
            project: 'aicode-consumers',
            model: 'gemini-3.8-flash-high',
            userAgent: 'antigravity',
            request: {
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }]
            }
          };

          if (creds.type === 'api_key' && creds.apiKey) {
            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${creds.apiKey}`;
            bodyObj = { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] };
          } else {
            headers['Authorization'] = `Bearer ${creds.access_token}`;
          }

          const fetchRes = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyObj)
          });
          const latencyMs = Date.now() - t0;
          const status = fetchRes.status;
          const ok = fetchRes.ok;
          let message = ok ? 'Kết nối thành công (200 OK)' : `HTTP ${status}`;
          if (status === 403) {
            const errData: any = await fetchRes.json().catch(() => ({}));
            const errMsg = errData?.error?.message || '';
            if (errMsg.includes('Verify your account')) {
              message = '403: Cần Verify trên Google';
            } else {
              message = '403: Bị Google chặn quyền';
            }
          } else if (status === 429) {
            message = '429: Hết Quota / Cooldown';
          }
          results[p.name] = { status, ok, message, latencyMs };
        } catch (err: any) {
          results[p.name] = {
            status: 500,
            ok: false,
            message: `Lỗi: ${err.message}`,
            latencyMs: Date.now() - t0
          };
        }
      }

      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export full backup
  app.get('/api/backup/export', (req: Request, res: Response) => {
    try {
      const storageData = manager.getStorage().load();
      const usageStats = usageTracker.getStats();
      const recentLogs = usageTracker.getRecentLogs(5000);
      const backup = {
        app: 'switch-google',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        storage: storageData,
        usageStats,
        logs: recentLogs
      };
      res.setHeader('Content-Disposition', `attachment; filename=switch-google-backup-${new Date().toISOString().slice(0, 10)}.json`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(backup, null, 2));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import full backup
  app.post('/api/backup/import', (req: Request, res: Response) => {
    try {
      const backup = req.body;
      if (!backup || !backup.storage || !backup.storage.profiles) {
        res.status(400).json({ error: 'File sao lưu không hợp lệ hoặc thiếu dữ liệu profiles.' });
        return;
      }
      const storage = manager.getStorage();
      const current = storage.load();
      // Merge profiles
      for (const [name, prof] of Object.entries(backup.storage.profiles)) {
        current.profiles[name] = prof as any;
      }
      if (backup.storage.activeProfile) {
        current.activeProfile = backup.storage.activeProfile;
      }
      if (Array.isArray(backup.storage.apiKeys)) {
        current.apiKeys = backup.storage.apiKeys;
      }
      if (Array.isArray(backup.storage.combos)) {
        current.combos = backup.storage.combos;
      }
      storage.save(current);

      // Restore logs if any
      if (Array.isArray(backup.logs) && backup.logs.length > 0) {
        for (const log of backup.logs) {
          usageTracker.record(log);
        }
      }

      res.json({
        success: true,
        message: `Đã phục hồi thành công ${Object.keys(backup.storage.profiles).length} tài khoản!`,
        totalProfiles: Object.keys(current.profiles).length
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Switch Ports Status & Management
  app.get('/api/ports', (req: Request, res: Response) => {
    const usageStats = usageTracker.getStats();
    const ports = rotator.getPortStatuses().map(p => ({
      ...p,
      totalTokens: usageStats.tokensByAccount[p.profile] || (p.email ? usageStats.tokensByAccount[p.email] : 0) || 0
    }));
    res.json({
      ports,
      serving: rotator.getCurrentlyServing(),
      strategy: rotator.getStrategy(),
      uplink: {
        totalTokens: usageStats.totalTokens || 0,
        totalPromptTokens: usageStats.totalPromptTokens || 0,
        totalCompletionTokens: usageStats.totalCompletionTokens || 0,
        totalRequests: usageStats.totalRequests || 0,
        clients: 'Hermes / Cursor / Cline'
      }
    });
  });

  app.post('/api/ports/toggle', (req: Request, res: Response) => {
    const { profile, disabled } = req.body;
    if (!profile) {
      res.status(400).json({ error: 'Missing profile' });
      return;
    }
    const isNowDisabled = rotator.toggleProfileDisabled(profile, disabled);
    res.json({ success: true, profile, disabled: isNowDisabled, ports: rotator.getPortStatuses() });
  });

  // Token Usage Stats & Audit Logs
  app.get('/api/usage/stats', (req: Request, res: Response) => {
    res.json(usageTracker.getStats());
  });

  app.get('/api/usage/logs', (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 100;
    const model = req.query.model ? String(req.query.model) : undefined;
    const account = req.query.account ? String(req.query.account) : undefined;
    res.json({ logs: usageTracker.getRecentLogs(limit, model, account) });
  });

  app.delete('/api/usage/logs', (req: Request, res: Response) => {
    usageTracker.clearLogs();
    res.json({ success: true, message: 'Logs cleared' });
  });

  // Strategy management (round-robin / fallback / fixed)
  app.get('/api/strategy', (req: Request, res: Response) => {
    res.json({
      strategy: rotator.getStrategy(),
      stats: rotator.getStats()
    });
  });

  app.post('/api/strategy', (req: Request, res: Response) => {
    const { strategy } = req.body;
    if (!strategy || !['round-robin', 'fallback', 'fixed'].includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy. Allowed: round-robin, fallback, fixed' });
      return;
    }
    rotator.setStrategy(strategy);
    res.json({ success: true, strategy: rotator.getStrategy() });
  });

  // List all available profiles
  app.get('/api/profiles', (req: Request, res: Response) => {
    try {
      const list = manager.listProfiles();
      const stats = rotator.getStats();
      const enriched = list.map((p) => ({
        ...p,
        stats: stats[p.name] || { totalRequests: 0, failedRequests: 0, isCooldown: false, cooldownRemainingSeconds: 0 }
      }));
      res.json({ profiles: enriched, strategy: rotator.getStrategy() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Virtual API Keys Management
  app.get('/api/keys', (req: Request, res: Response) => {
    res.json({ keys: manager.getApiKeys() });
  });

  app.post('/api/keys', (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "name" for API Key' });
      return;
    }
    const newKey = manager.createApiKey(name);
    res.json(newKey);
  });

  app.delete('/api/keys/:id', (req: Request, res: Response) => {
    const success = manager.deleteApiKey(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'API Key not found' });
      return;
    }
    res.json({ success: true, message: 'API Key deleted' });
  });

  // Model Combos Management
  app.get('/api/combos', (req: Request, res: Response) => {
    res.json({ combos: manager.getCombos() });
  });

  app.post('/api/combos', (req: Request, res: Response) => {
    const { name, strategy = 'fallback', models = [] } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "name" for Model Combo' });
      return;
    }
    if (!Array.isArray(models) || models.length === 0) {
      res.status(400).json({ error: 'At least one model must be specified in "models"' });
      return;
    }
    const combo = manager.createCombo(name, strategy, models);
    res.json(combo);
  });

  app.delete('/api/combos/:id', (req: Request, res: Response) => {
    const success = manager.deleteCombo(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Model Combo not found' });
      return;
    }
    res.json({ success: true, message: 'Model Combo deleted' });
  });

  // Mount OpenAI-compatible Gateway (/v1/chat/completions, /v1/models) with account rotation & auto-failover
  app.use('/v1', createOpenAiRouter(manager, rotator));

  // Add profile via API Key (Google AI Studio Gemini Key)
  app.post('/api/profiles/apikey', (req: Request, res: Response) => {
    try {
      const { profile, apiKey, email } = req.body;
      if (!profile || !apiKey) {
        res.status(400).json({ error: 'Missing "profile" or "apiKey" in request body' });
        return;
      }
      const saved = manager.addApiKeyProfile(profile.trim(), apiKey.trim(), email?.trim());
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add profile via direct Access/Refresh Token
  app.post('/api/profiles/token', (req: Request, res: Response) => {
    try {
      const { profile, email, accessToken, refreshToken, expiryDate } = req.body;
      if (!profile || !accessToken) {
        res.status(400).json({ error: 'Missing "profile" or "accessToken" in request body' });
        return;
      }
      const saved = manager.addDirectTokenProfile(
        profile.trim(),
        email || 'manual-token@google.com',
        accessToken.trim(),
        refreshToken,
        expiryDate
      );
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Login and create a new profile via OAuth (Tự động lấy Email nếu không truyền profile)
  app.post('/api/login', async (req: Request, res: Response) => {
    try {
      const { profile } = req.body || {};
      const profileName = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : undefined;
      const saved = await manager.loginAndSave(profileName);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a profile
  app.delete('/api/profiles/:profile', (req: Request, res: Response) => {
    try {
      const profile = req.params.profile;
      const success = manager.deleteProfile(profile);
      if (!success) {
        res.status(404).json({ error: `Profile '${profile}' không tồn tại` });
        return;
      }
      res.json({ success: true, message: `Profile '${profile}' đã được xóa` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Switch active profile
  app.post('/api/switch', (req: Request, res: Response) => {
    try {
      const { profile } = req.body;
      if (!profile) {
        res.status(400).json({ error: 'Missing "profile" in request body' });
        return;
      }
      manager.setActiveProfile(profile);
      res.json({ success: true, message: `Switched active profile to '${profile}'` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get active token (auto-refreshed)
  app.get('/api/token', async (req: Request, res: Response) => {
    try {
      const tokenInfo = await manager.getActiveToken();
      res.json(tokenInfo);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get token for a specific profile
  app.get('/api/token/:profile', async (req: Request, res: Response) => {
    try {
      const profile = req.params.profile;
      const tokenInfo = await manager.getTokenForProfile(profile);
      res.json(tokenInfo);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Optional Proxy Endpoint for 3rd party requests
  app.post('/api/proxy', async (req: Request, res: Response) => {
    try {
      const { url, method = 'GET', headers = {}, body, profile } = req.body;
      if (!url) {
        res.status(400).json({ error: 'Missing "url" in request body' });
        return;
      }

      const tokenData = profile
        ? await manager.getTokenForProfile(profile)
        : await manager.getActiveToken();

      const fetchHeaders: Record<string, string> = {
        ...headers,
        Authorization: `Bearer ${tokenData.access_token}`
      };

      const fetchOptions: RequestInit = {
        method,
        headers: fetchHeaders
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json';
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.text();

      res.status(response.status);
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('content-type', contentType);
      }
      res.send(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 switch-google Web Dashboard & API Server:`);
    console.log(`  🌐 Dashboard: http://localhost:${port}`);
    console.log(`  🤖 OpenAI Gateway: http://localhost:${port}/v1`);
    console.log(`======================================================`);
    console.log(`- Web UI: Mở http://localhost:${port} trên trình duyệt`);
    console.log(`- OpenAI Proxy: Cấu hình Base URL http://localhost:${port}/v1 cho Cursor/Claude/Cline`);
    console.log(`- GET  /api/status        : Kiểm tra trạng thái server`);
    console.log(`- GET  /api/profiles      : Danh sách các tài khoản`);
    console.log(`- POST /api/login         : Đăng nhập thêm tài khoản OAuth`);
    console.log(`- POST /api/profiles/apikey : Thêm tài khoản bằng Gemini API Key`);
    console.log(`- POST /api/profiles/token  : Thêm tài khoản bằng Token trực tiếp`);
    console.log(`- GET  /api/token         : Lấy Access Token của tài khoản Active`);
    console.log(`- GET  /api/token/:name   : Lấy Access Token của tài khoản chỉ định`);
    console.log(`- POST /api/switch        : Đổi tài khoản active { "profile": "..." }`);
    console.log(`- DELETE /api/profiles/:n : Xóa profile`);
    console.log(`- POST /api/proxy         : Proxy gửi request Google API tự đính kèm Token`);
    console.log(`======================================================\n`);
  });
}
