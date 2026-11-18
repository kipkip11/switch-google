import { ProfileManager } from './manager';

export type RotationStrategy = 'round-robin' | 'fallback' | 'fixed';

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
  private strategy: RotationStrategy = 'round-robin';
  private currentIndex = 0;
  private stats: Map<string, AccountStats> = new Map();
  private disabledProfiles: Set<string> = new Set();
  private currentlyServingAccount: string | null = null;
  private lastServedAt: number = 0;

  constructor(manager: ProfileManager) {
    this.manager = manager;
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

  public getPortStatuses(): SwitchPortInfo[] {
    const profiles = this.manager.listProfiles();
    const activeName = this.manager.getActiveProfileName();
    const now = Date.now();

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

      return {
        portNumber: idx + 1,
        profile: p.name,
        email: p.email,
        type: p.type,
        isActiveDefault: p.name === activeName,
        isServingNow: p.name === this.currentlyServingAccount || (now - this.lastServedAt < 3000 && p.name === this.currentlyServingAccount),
        isDisabled,
        linkStatus,
        cooldownRemainingSeconds,
        totalRequests: s?.totalRequests || 0,
        failedRequests: s?.failedRequests || 0,
        lastUsedAt: s?.lastUsedAt ? new Date(s.lastUsedAt).toLocaleTimeString() : undefined
      };
    });
  }

  public getStrategy(): RotationStrategy {
    return this.strategy;
  }

  public setStrategy(strategy: RotationStrategy): void {
    this.strategy = strategy;
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

  public markCooldown(profileName: string, durationSeconds = 60): void {
    const s = this.getOrCreateStats(profileName);
    s.failedRequests += 1;
    s.cooldownUntil = Date.now() + durationSeconds * 1000;
    console.warn(`[Rotator] Tài khoản [${profileName}] bị Rate Limit (429). Cooldown trong ${durationSeconds}s.`);
  }

  public recordSuccess(profileName: string): void {
    const s = this.getOrCreateStats(profileName);
    s.totalRequests += 1;
    s.lastUsedAt = Date.now();
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
    console.warn(`[Rotator] Tài khoản [${profileName}] bị Google chặn vĩnh viễn (TOS/Permission/Validation). Loại bỏ khỏi vòng quay.`);
  }

  public async getAvailableAccounts(): Promise<string[]> {
    const profiles = this.manager.listProfiles();
    const now = Date.now();

    // Lọc ra các tài khoản không bị disable thủ công, không bị ban và không bị cooldown
    const available = profiles
      .map((p) => p.name)
      .filter((name) => {
        if (this.disabledProfiles.has(name)) return false;
        const s = this.stats.get(name);
        if (s?.isBanned) return false;
        return !(s?.cooldownUntil && s.cooldownUntil > now);
      });

    // Nếu tất cả tài khoản non-banned đều bị cooldown, reset cooldown các tài khoản non-banned để thử lại
    if (available.length === 0 && profiles.length > 0) {
      const nonBanned = profiles
        .map((p) => p.name)
        .filter((name) => !this.disabledProfiles.has(name) && !this.stats.get(name)?.isBanned);
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
      // Nếu tất cả tài khoản khả dụng đã bị excluded, thử lại từ các tài khoản chưa thử trong toàn bộ danh sách
      const fallbackRemaining = allProfiles
        .map((p) => p.name)
        .filter((name) => !excludedAccounts.includes(name));

      if (fallbackRemaining.length === 0) {
        throw new Error('Tất cả tài khoản trong pool đều đã được thử và gặp lỗi.');
      }
      availableNames.push(...fallbackRemaining);
    }

    let targetName: string;

    if (this.strategy === 'fixed') {
      const activeName = this.manager.getActiveProfileName();
      targetName = activeName && availableNames.includes(activeName) ? activeName : availableNames[0];
    } else if (this.strategy === 'fallback') {
      // Ưu tiên theo thứ tự trong danh sách khả dụng
      targetName = availableNames[0];
    } else {
      // Round-Robin
      this.currentIndex = this.currentIndex % availableNames.length;
      targetName = availableNames[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % availableNames.length;
    }

    const tokenData = await this.manager.getTokenForProfile(targetName);
    return {
      profile: tokenData.profile,
      email: tokenData.email,
      type: tokenData.type,
      apiKey: tokenData.apiKey,
      access_token: tokenData.access_token,
      expiry_date: tokenData.expiry_date
    };
  }

  /**
   * Tự động thử lại với tài khoản tiếp theo nếu tài khoản hiện tại gặp lỗi (429, 403, quota, token, v.v.)
   */
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
        // Nếu lỗi lấy token của một account, loại account đó và thử tiếp
        const remaining = allProfiles
          .map((p) => p.name)
          .filter((n) => !triedAccounts.includes(n));
        if (remaining.length > 0) {
          const badAccount = remaining[0];
          triedAccounts.push(badAccount);
          this.markCooldown(badAccount, 300);
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
        this.recordSuccess(creds.profile);
        return { result, accountUsed: creds.profile };
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || '';
        console.warn(`[Failover] Tài khoản [${creds.profile}] thất bại (${err.status || ''} ${errMsg.slice(0, 100)}). Chuyển sang tài khoản tiếp theo...`);
        const isBannedIssue = errMsg.includes('TOS_VIOLATION') || errMsg.includes('VALIDATION_REQUIRED') || (err.status === 403 && errMsg.includes('PERMISSION_DENIED'));
        if (isBannedIssue) {
          this.markBanned(creds.profile);
        } else {
          const cooldownTime = err.status === 429 ? 60 : 30;
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
