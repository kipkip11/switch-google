import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TokenUsageRecord {
  id: string;
  timestamp: number;
  profile: string;
  email: string;
  model: string;
  virtualKey?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  statusCode: number;
  stream: boolean;
}

export interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  tokensByModel: Record<string, number>;
  tokensByAccount: Record<string, number>;
  requestsByAccount: Record<string, number>;
  timeSeries: {
    time: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }[];
}

export class UsageTracker {
  private static instance: UsageTracker;
  private logFile: string;
  private logs: TokenUsageRecord[] = [];
  private maxLogs = 5000;

  private constructor() {
    const baseDir = path.join(os.homedir(), '.switch-google');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    this.logFile = path.join(baseDir, 'usage_logs.json');
    this.loadLogs();
  }

  public static getInstance(): UsageTracker {
    if (!UsageTracker.instance) {
      UsageTracker.instance = new UsageTracker();
    }
    return UsageTracker.instance;
  }

  private loadLogs(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const raw = fs.readFileSync(this.logFile, 'utf-8');
        this.logs = JSON.parse(raw);
        if (!Array.isArray(this.logs)) this.logs = [];
      }
    } catch (err) {
      this.logs = [];
    }
  }

  private saveLogs(): void {
    try {
      // Keep only maxLogs items
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
      fs.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2), { mode: 0o600 });
    } catch (_) {}
  }

  public record(record: Omit<TokenUsageRecord, 'id' | 'timestamp'>): TokenUsageRecord {
    const entry: TokenUsageRecord = {
      id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: Date.now(),
      ...record
    };
    this.logs.push(entry);
    this.saveLogs();
    return entry;
  }

  public getRecentLogs(limit = 100, filterModel?: string, filterAccount?: string): TokenUsageRecord[] {
    let result = [...this.logs].reverse();
    if (filterModel) {
      result = result.filter(r => r.model.toLowerCase().includes(filterModel.toLowerCase()));
    }
    if (filterAccount) {
      result = result.filter(r => r.email.toLowerCase().includes(filterAccount.toLowerCase()) || r.profile.toLowerCase().includes(filterAccount.toLowerCase()));
    }
    return result.slice(0, limit);
  }

  public clearLogs(): void {
    this.logs = [];
    this.saveLogs();
  }

  public getStats(): UsageStats {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const tokensByModel: Record<string, number> = {};
    const tokensByAccount: Record<string, number> = {};
    const requestsByAccount: Record<string, number> = {};

    // Group logs by 10-minute intervals for the last 24 hours
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const bucketMap = new Map<string, { promptTokens: number; completionTokens: number; totalTokens: number }>();

    for (const log of this.logs) {
      const pTokens = log.promptTokens || 0;
      const cTokens = log.completionTokens || 0;
      const tTokens = log.totalTokens || (pTokens + cTokens);

      totalPromptTokens += pTokens;
      totalCompletionTokens += cTokens;

      const modelKey = log.model || 'unknown';
      tokensByModel[modelKey] = (tokensByModel[modelKey] || 0) + tTokens;

      const accountKey = log.email || log.profile || 'unknown';
      tokensByAccount[accountKey] = (tokensByAccount[accountKey] || 0) + tTokens;
      requestsByAccount[accountKey] = (requestsByAccount[accountKey] || 0) + 1;

      if (log.timestamp >= oneDayAgo) {
        const d = new Date(log.timestamp);
        // Format as HH:MM
        const hours = d.getHours().toString().padStart(2, '0');
        const minutes = (Math.floor(d.getMinutes() / 15) * 15).toString().padStart(2, '0');
        const timeKey = `${hours}:${minutes}`;

        const existing = bucketMap.get(timeKey) || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        existing.promptTokens += pTokens;
        existing.completionTokens += cTokens;
        existing.totalTokens += tTokens;
        bucketMap.set(timeKey, existing);
      }
    }

    const timeSeries = Array.from(bucketMap.entries()).map(([time, data]) => ({
      time,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens
    }));

    return {
      totalRequests: this.logs.length,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      totalPromptTokens,
      totalCompletionTokens,
      tokensByModel,
      tokensByAccount,
      requestsByAccount,
      timeSeries
    };
  }
}

export const usageTracker = UsageTracker.getInstance();
