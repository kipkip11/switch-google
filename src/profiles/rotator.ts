import { ProfileManager } from './manager';
import { SqliteStorage, RotationConfig } from '../storage/sqliteStorage';
import { usageTracker } from '../usage/tracker';

export type RotationStrategy = 'round-robin' | 'least-traffic' | 'fallback' | 'fixed';

export interface AccountStats {
  totalRequests: number;
  failedRequests: number;
  lastUsedAt?: number;
  cooldownUntil?: number;
  isBanned?: boolean;
}

export interface AccountCredentials {
  profile: string;
  email: string;
  type?: string;
  apiKey?: string;
  cookies?: string;
  access_token: string;
  expiry_date?: number | null;
}

export interface SwitchPortInfo {
  portNumber: number;
  profile: string;
  email: string;
  type: string;
  isActiveDefault: boolean;
  isServingNow: boolean;
  isDisabled: boolean;
  isBlockedAntigravity?: boolean;
  isUpgradingWeb?: boolean;
  linkStatus: 'up' | 'cooldown' | 'banned' | 'down';
  cooldownRemainingSeconds: number;
  totalRequests: number;
  failedRequests: number;
  lastUsedAt?: string;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export class AccountRotator {
  private manager: ProfileManager;
  private sqlite: SqliteStorage;
  private currentIndex = 0;
  private stats: Map<string, AccountStats> = new Map();
  private disabledProfiles: Set<string> = new Set();
  private upgradingProfiles: Set<string> = new Set();
  private currentlyServingAccount: string | null = null;
  private lastServedAt: number = 0;

  // Turn management (Số lượt gọi và token cho mỗi vòng)
  private currentTurnAccount: string | null = null;
  private currentTurnRequests = 0;
  private currentTurnTokens = 0;

  constructor(manager: ProfileManager) {
    this.manager = manager;
    this.sqlite = manager.getStorage().getSqlite();
  }

  public async triggerAutoUpgradeToWeb(profileName: string): Promise<void> {
    if (this.upgradingProfiles.has(profileName)) {
      return;
    }
    const raw = this.manager.getRawProfile(profileName);
    if (!raw || raw.type === 'web_session') {
      return;
    }

    this.upgradingProfiles.add(profileName);
    console.log(`[Auto-Recovery] 🚀 Phát hiện tài khoản [${profileName}] bị chặn Antigravity. Đang tự động kích hoạt chuyển sang Gemini Web Mode...`);

    // Chạy ngầm không chặn luồng chính
    (async () => {
      try {
        const { autoCaptureGeminiWebSession } = await import('../services/webAuthAutomator');
        const captured = await autoCaptureGeminiWebSession(180000, raw.email);
        this.manager.upgradeOauthToWebSession(profileName, captured.cookies, captured.email);
        this.unbanAccount(profileName);
        console.log(`[Auto-Recovery] ✓ Đã tự động phục hồi và chuyển [${profileName}] sang Web Mode thành công!`);
      } catch (err: any) {
        console.warn(`[Auto-Recovery] ✗ Tự động chuyển Web Mode cho [${profileName}] chưa hoàn tất: ${err.message}`);
      } finally {
        this.upgradingProfiles.delete(profileName);
      }
    })();
  }

  public async autoRecoverBlockedAccounts(): Promise<{ triggered: string[] }> {
    const profiles = this.manager.listProfiles();
    const triggered: string[] = [];
    for (const p of profiles) {
      if (p.isBlockedAntigravity && p.type === 'oauth' && !this.upgradingProfiles.has(p.name)) {
        triggered.push(p.name);
        this.triggerAutoUpgradeToWeb(p.name);
        break; // Tự động phục hồi từng tài khoản một để không mở nhiều trình duyệt cùng lúc
      }
    }
    return { triggered };
  }

  public getRotationConfig(): RotationConfig {
    return this.sqlite.getRotationConfig();
  }

  public setRotationConfig(config: Partial<RotationConfig>): void {
    this.sqlite.setRotationConfig(config);
  }

  public getCurrentlyServing(): { account: string | null; lastServedAt: number } {
    return {
      account: this.currentlyServingAccount,
      lastServedAt: this.lastServedAt
    };
  }

  public toggleProfileDisabled(profileName: string, state?: boolean): boolean {
    const isCurrentlyDisabled = this.disabledProfiles.has(profileName);
    const shouldDisable = state !== undefined ? state : !isCurrentlyDisabled;
    if (shouldDisable) {
      this.disabledProfiles.add(profileName);
    } else {
      this.disabledProfiles.delete(profileName);
    }
    return shouldDisable;
  }

  public removeAccount(profileName: string): void {
    this.stats.delete(profileName);
    this.disabledProfiles.delete(profileName);
    if (this.currentlyServingAccount === profileName) {
      this.currentlyServingAccount = null;
    }
    if (this.currentTurnAccount === profileName) {
      this.currentTurnAccount = null;
      this.currentTurnRequests = 0;
      this.currentTurnTokens = 0;
    }
  }

  public getPortStatuses(): SwitchPortInfo[] {
    const profiles = this.manager.listProfiles();
    const activeName = this.manager.getActiveProfileName();
    const now = Date.now();
    const usage = usageTracker.getStats();

    return profiles.map((p, idx) => {
      const s = this.stats.get(p.name);
      const isBanned = s?.isBanned || false;
      const isDisabled = this.disabledProfiles.has(p.name);
      const isCooldown = (s?.cooldownUntil && s.cooldownUntil > now) || false;
      const cooldownRemainingSeconds = isCooldown ? Math.ceil((s!.cooldownUntil! - now) / 1000) : 0;

      let linkStatus: 'up' | 'cooldown' | 'banned' | 'down' = 'up';
      if (isDisabled) linkStatus = 'down';
      else if (isBanned) linkStatus = 'banned';
      else if (isCooldown) linkStatus = 'cooldown';

      const accountTokens = usage.tokensByAccount[p.name] || (p.email ? usage.tokensByAccount[p.email] : 0) || 0;

      const isUpgradingWeb = this.upgradingProfiles.has(p.name);
      return {
        portNumber: idx + 1,
        profile: p.name,
        email: p.email,
        type: p.type,
        isActiveDefault: p.name === activeName,
        isServingNow: p.name === this.currentlyServingAccount || (now - this.lastServedAt < 3500 && p.name === this.currentlyServingAccount),
        isDisabled,
        isBlockedAntigravity: p.isBlockedAntigravity || false,
        isUpgradingWeb,
        linkStatus,
        cooldownRemainingSeconds,
        totalRequests: s?.totalRequests || 0,
        failedRequests: s?.failedRequests || 0,
        lastUsedAt: s?.lastUsedAt ? new Date(s.lastUsedAt).toLocaleTimeString() : undefined,
        totalTokens: accountTokens
      };
    });
  }

  public getStrategy(): RotationStrategy {
    return this.getRotationConfig().strategy;
  }

  public setStrategy(strategy: RotationStrategy): void {
    this.setRotationConfig({ strategy });
  }

  public getStats(): Record<string, {
    totalRequests: number;
    failedRequests: number;
    isCooldown: boolean;
    cooldownRemainingSeconds: number;
    lastUsedAt?: string;
  }> {
    const now = Date.now();
    const result: Record<string, any> = {};

    for (const [name, s] of this.stats.entries()) {
      const isCooldown = (s.cooldownUntil && s.cooldownUntil > now) || false;
      const cooldownRemainingSeconds = isCooldown ? Math.ceil((s.cooldownUntil! - now) / 1000) : 0;
      result[name] = {
        totalRequests: s.totalRequests,
        failedRequests: s.failedRequests,
        isCooldown,
        cooldownRemainingSeconds,
        lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleTimeString() : undefined
      };
    }

    return result;
  }

  private getOrCreateStats(profileName: string): AccountStats {
    let s = this.stats.get(profileName);
    if (!s) {
      s = { totalRequests: 0, failedRequests: 0 };
      this.stats.set(profileName, s);
    }
    return s;
  }

  public markCooldown(profileName: string, durationSeconds?: number): void {
    const s = this.getOrCreateStats(profileName);
    s.failedRequests += 1;

    // Exponential Backoff with Full Jitter để triệt tiêu hiện tượng Thundering Herd
    // Base: 20s, nhân đôi theo số lần fail liên tiếp (tối đa 300s), cộng thêm jitter ngẫu nhiên 5-15s
    let actualDuration = durationSeconds;
    if (!actualDuration) {
      const baseDelay = 20;
      const failCount = Math.min(s.failedRequests, 4);
      const backoff = baseDelay * Math.pow(1.5, failCount);
      const jitter = Math.floor(Math.random() * 10) + 5;
      actualDuration = Math.min(300, Math.round(backoff + jitter));
    }

    s.cooldownUntil = Date.now() + actualDuration * 1000;
    console.warn(`[Rotator] Tài khoản [${profileName}] cooldown (Jitter Backoff) trong ${actualDuration}s.`);
    // Reset turn nếu tài khoản bị cooldown
    if (this.currentTurnAccount === profileName) {
      this.currentTurnAccount = null;
      this.currentTurnRequests = 0;
      this.currentTurnTokens = 0;
    }
  }

  public recordSuccess(profileName: string, tokensUsed = 0): void {
    const s = this.getOrCreateStats(profileName);
    s.totalRequests += 1;
    s.lastUsedAt = Date.now();

    if (this.currentTurnAccount === profileName) {
      this.currentTurnRequests += 1;
      this.currentTurnTokens += tokensUsed;
    }
  }

  public clearCooldowns(): void {
    for (const [, s] of this.stats) {
      s.cooldownUntil = undefined;
    }
  }

  public markBanned(profileName: string): void {
    const s = this.getOrCreateStats(profileName);
    s.failedRequests += 1;
    s.isBanned = true;
    s.cooldownUntil = Date.now() + 86400 * 1000; // 24h
    console.warn(`[Rotator] Tài khoản [${profileName}] tạm thời bị hạn chế quyền truy cập.`);
    if (this.currentTurnAccount === profileName) {
      this.currentTurnAccount = null;
      this.currentTurnRequests = 0;
      this.currentTurnTokens = 0;
    }
  }

  public unbanAccount(profileName: string): void {
    const s = this.stats.get(profileName);
    if (s) {
      s.isBanned = false;
      s.cooldownUntil = 0;
    }
  }

  public async getAvailableAccounts(): Promise<string[]> {
    const profiles = this.manager.listProfiles();
    const now = Date.now();

    // Lọc ra các tài khoản không bị disable thủ công, không bị ban, không bị chặn Antigravity (nếu còn tài khoản khác) và không bị cooldown
    const available = profiles
      .filter((p) => {
        if (this.disabledProfiles.has(p.name)) return false;
        const s = this.stats.get(p.name);
        if (s?.isBanned) return false;
        if (p.isBlockedAntigravity && p.type === 'oauth') return false;
        return !(s?.cooldownUntil && s.cooldownUntil > now);
      })
      .map((p) => p.name);

    // Nếu tất cả tài khoản sạch đều hết, mở lại các tài khoản non-banned để thử
    if (available.length === 0 && profiles.length > 0) {
      const nonBanned = profiles
        .filter((p) => !this.disabledProfiles.has(p.name) && !this.stats.get(p.name)?.isBanned)
        .map((p) => p.name);
      return nonBanned.length > 0 ? nonBanned : profiles.map((p) => p.name);
    }

    return available;
  }

  public async getNextAccount(excludedAccounts: string[] = []): Promise<AccountCredentials> {
    const allProfiles = this.manager.listProfiles();
    if (allProfiles.length === 0) {
      throw new Error('Chưa có tài khoản nào được kết nối.');
    }

    const availableNames = (await this.getAvailableAccounts()).filter(
      (name) => !excludedAccounts.includes(name)
    );

    if (availableNames.length === 0) {
      const fallbackRemaining = allProfiles
        .map((p) => p.name)
        .filter((name) => !excludedAccounts.includes(name));

      if (fallbackRemaining.length === 0) {
        throw new Error('Tất cả tài khoản trong pool đều đã được thử và gặp lỗi.');
      }
      availableNames.push(...fallbackRemaining);
    }

    const config = this.getRotationConfig();
    let targetName: string;

    // Kiểm tra xem có cấu hình turn nhiều lượt liên tiếp không (requestsPerTurn > 1)
    const isMultiTurn = config.requestsPerTurn > 1;
    const canContinueCurrentTurn = 
      isMultiTurn &&
      this.currentTurnAccount &&
      availableNames.includes(this.currentTurnAccount) &&
      this.currentTurnRequests < config.requestsPerTurn &&
      this.currentTurnTokens < config.tokensPerTurn;

    if (canContinueCurrentTurn) {
      targetName = this.currentTurnAccount!;
      this.currentTurnRequests += 1;
    } else {
      // Bắt đầu lượt mới cho tài khoản tiếp theo
      if (config.strategy === 'least-traffic') {
        // Cân bằng tải theo lưu lượng: chọn tài khoản có tổng token ít nhất
        const usage = usageTracker.getStats();
        const sortedByTraffic = [...availableNames].sort((a, b) => {
          const tokensA = usage.tokensByAccount[a] || 0;
          const tokensB = usage.tokensByAccount[b] || 0;
          if (tokensA !== tokensB) return tokensA - tokensB;
          // Nếu bằng token, ưu tiên tài khoản chưa dùng gần đây
          const statA = this.stats.get(a)?.lastUsedAt || 0;
          const statB = this.stats.get(b)?.lastUsedAt || 0;
          return statA - statB;
        });
        targetName = sortedByTraffic[0];
      } else if (config.strategy === 'fixed') {
        const activeName = this.manager.getActiveProfileName();
        targetName = activeName && availableNames.includes(activeName) ? activeName : availableNames[0];
      } else if (config.strategy === 'fallback') {
        targetName = availableNames[0];
      } else {
        // Round-robin
        this.currentIndex = this.currentIndex % availableNames.length;
        targetName = availableNames[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % availableNames.length;
      }

      this.currentTurnAccount = targetName;
      this.currentTurnRequests = 1;
      this.currentTurnTokens = 0;
    }

    const tokenData = await this.manager.getTokenForProfile(targetName);
    return {
      profile: tokenData.profile,
      email: tokenData.email,
      type: tokenData.type,
      apiKey: tokenData.apiKey,
      cookies: (tokenData as any).cookies,
      access_token: tokenData.access_token,
      expiry_date: tokenData.expiry_date
    };
  }

  public async executeWithFailover<T>(
    fn: (creds: AccountCredentials) => Promise<T>
  ): Promise<{ result: T; accountUsed: string }> {
    const allProfiles = this.manager.listProfiles();
    const maxAttempts = Math.max(1, allProfiles.length);
    const triedAccounts: string[] = [];
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let creds: AccountCredentials;
      try {
        creds = await this.getNextAccount(triedAccounts);
      } catch (err: any) {
        const remaining = allProfiles
          .map((p) => p.name)
          .filter((n) => !triedAccounts.includes(n));
        if (remaining.length > 0) {
          const badAccount = remaining[0];
          triedAccounts.push(badAccount);
          this.markCooldown(badAccount, 120);
          console.warn(`[Failover] Không lấy được token cho [${badAccount}]: ${err.message}. Thử tài khoản khác...`);
          continue;
        }
        throw lastError || err;
      }

      triedAccounts.push(creds.profile);
      this.currentlyServingAccount = creds.profile;
      this.lastServedAt = Date.now();

      try {
        const result = await fn(creds);
        // Note: tokens used will be updated when usage is recorded
        this.recordSuccess(creds.profile);
        return { result, accountUsed: creds.profile };
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || '';
        console.warn(`[Failover] Tài khoản [${creds.profile}] thất bại (${err.status || ''} ${errMsg.slice(0, 100)}). Chuyển tài khoản...`);
        const isBannedIssue =
          errMsg.includes('TOS_VIOLATION') ||
          errMsg.includes('VALIDATION_REQUIRED') ||
          errMsg.includes('Terms of Service') ||
          errMsg.includes('SUBSCRIPTION_REQUIRED') ||
          (err.status === 403 && errMsg.includes('PERMISSION_DENIED'));
        if (isBannedIssue) {
          this.markBanned(creds.profile);
          this.manager.setBlockedAntigravity(creds.profile, true);
          if (creds.type === 'oauth') {
            this.triggerAutoUpgradeToWeb(creds.profile);
          }
        } else {
          const cooldownTime = err.status === 429 ? 60 : 20;
          this.markCooldown(creds.profile, cooldownTime);
        }

        if (attempt < maxAttempts - 1) {
          continue;
        }
      }
    }

    throw lastError || new Error('Đã thử tất cả các tài khoản nhưng không tài khoản nào khả dụng.');
  }
}
