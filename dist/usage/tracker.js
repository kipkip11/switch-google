"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageTracker = exports.UsageTracker = void 0;
exports.getUsageTracker = getUsageTracker;
const sqliteStorage_1 = require("../storage/sqliteStorage");
class UsageTracker {
    static instance;
    sqlite;
    liveTraffic = {
        isTransmitting: false,
        account: null,
        model: null,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        timestamp: 0
    };
    liveTimer = null;
    statsCache = new Map();
    constructor() {
        this.sqlite = sqliteStorage_1.SqliteStorage.getInstance();
    }
    static getInstance() {
        if (!UsageTracker.instance) {
            UsageTracker.instance = new UsageTracker();
        }
        return UsageTracker.instance;
    }
    setLiveTransmission(account, model, promptTokens, completionTokens, latencyMs) {
        if (this.liveTimer) {
            clearTimeout(this.liveTimer);
        }
        const total = promptTokens + completionTokens;
        this.liveTraffic = {
            isTransmitting: true,
            account,
            model,
            tokens: total,
            promptTokens,
            completionTokens,
            latencyMs,
            timestamp: Date.now()
        };
        // Tự động tắt trạng thái truyền laser sau 3.5 giây khi kết thúc
        this.liveTimer = setTimeout(() => {
            this.liveTraffic.isTransmitting = false;
        }, 3500);
    }
    getLiveTraffic() {
        // Nếu quá 4 giây thì chắc chắn không còn truyền
        if (this.liveTraffic.isTransmitting && Date.now() - this.liveTraffic.timestamp > 4000) {
            this.liveTraffic.isTransmitting = false;
        }
        return this.liveTraffic;
    }
    record(record) {
        const entry = this.sqlite.recordUsage(record);
        this.statsCache.clear();
        this.setLiveTransmission(record.profile || record.email, record.model, record.promptTokens || 0, record.completionTokens || 0, record.latencyMs || 0);
        return entry;
    }
    getRecentLogs(limit = 100, filterModel, filterAccount) {
        const all = this.sqlite.getUsageLogs(limit * 2);
        let result = all;
        if (filterModel) {
            result = result.filter(r => r.model.toLowerCase().includes(filterModel.toLowerCase()));
        }
        if (filterAccount) {
            result = result.filter(r => r.email.toLowerCase().includes(filterAccount.toLowerCase()) || r.profile.toLowerCase().includes(filterAccount.toLowerCase()));
        }
        return result.slice(0, limit);
    }
    clearLogs() {
        // Truncate SQLite logs
        try {
            this.sqlite.db.exec('DELETE FROM usage_logs;');
            this.statsCache.clear();
        }
        catch (_) { }
    }
    getStats(timeframeMs) {
        const now = Date.now();
        const timeframe = timeframeMs || 24 * 60 * 60 * 1000;
        const cached = this.statsCache.get(timeframe);
        if (cached && now - cached.timestamp < 1500) {
            return cached.data;
        }
        const logs = this.sqlite.getUsageLogs(10000).filter(l => l.timestamp >= now - timeframe);
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalLatency = 0;
        const tokensByModel = {};
        const tokensByAccount = {};
        const requestsByAccount = {};
        const bucketMap = new Map();
        // Determine interval step based on timeframe
        let stepMs = 15 * 60 * 1000; // default 15m for 24h
        if (timeframe <= 60 * 1000) {
            stepMs = 2 * 1000; // 2s buckets for 60s
        }
        else if (timeframe <= 60 * 60 * 1000) {
            stepMs = 60 * 1000; // 1m buckets for 1h
        }
        else if (timeframe <= 6 * 60 * 60 * 1000) {
            stepMs = 5 * 60 * 1000; // 5m buckets for 6h
        }
        // Pre-populate buckets for smooth graph
        const bucketCount = Math.min(60, Math.ceil(timeframe / stepMs));
        for (let i = bucketCount - 1; i >= 0; i--) {
            const bucketTime = new Date(now - i * stepMs);
            let label = '';
            if (timeframe <= 60 * 1000) {
                label = `${bucketTime.getSeconds()}s`;
            }
            else {
                const hh = bucketTime.getHours().toString().padStart(2, '0');
                const mm = bucketTime.getMinutes().toString().padStart(2, '0');
                label = `${hh}:${mm}`;
            }
            bucketMap.set(label, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        }
        // Recent tokens for Tps calculation (last 10 seconds)
        let recentTokensLast10s = 0;
        for (const log of logs) {
            const pTokens = log.promptTokens || 0;
            const cTokens = log.completionTokens || 0;
            const tTokens = log.totalTokens || (pTokens + cTokens);
            totalPromptTokens += pTokens;
            totalCompletionTokens += cTokens;
            totalLatency += log.latencyMs || 0;
            if (now - log.timestamp <= 10000) {
                recentTokensLast10s += tTokens;
            }
            const modelKey = log.model || 'unknown';
            tokensByModel[modelKey] = (tokensByModel[modelKey] || 0) + tTokens;
            const accountKey = log.email || log.profile || 'unknown';
            tokensByAccount[accountKey] = (tokensByAccount[accountKey] || 0) + tTokens;
            requestsByAccount[accountKey] = (requestsByAccount[accountKey] || 0) + 1;
            const d = new Date(log.timestamp);
            let label = '';
            if (timeframe <= 60 * 1000) {
                label = `${d.getSeconds()}s`;
            }
            else {
                const roundedMin = Math.floor(d.getMinutes() / (stepMs / 60000)) * (stepMs / 60000);
                const hh = d.getHours().toString().padStart(2, '0');
                const mm = Math.floor(roundedMin).toString().padStart(2, '0');
                label = `${hh}:${mm}`;
            }
            const existing = bucketMap.get(label) || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            existing.promptTokens += pTokens;
            existing.completionTokens += cTokens;
            existing.totalTokens += tTokens;
            bucketMap.set(label, existing);
        }
        const timeSeries = Array.from(bucketMap.entries()).map(([time, data]) => ({
            time,
            promptTokens: data.promptTokens,
            completionTokens: data.completionTokens,
            totalTokens: data.totalTokens
        }));
        const tokensPerSecond = Math.round(recentTokensLast10s / 10);
        const avgLatencyMs = logs.length > 0 ? Math.round(totalLatency / logs.length) : 0;
        const resultStats = {
            totalRequests: logs.length,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            totalPromptTokens,
            totalCompletionTokens,
            tokensByModel,
            tokensByAccount,
            requestsByAccount,
            tokensPerSecond,
            avgLatencyMs,
            timeSeries
        };
        this.statsCache.set(timeframe, { data: resultStats, timestamp: now });
        return resultStats;
    }
}
exports.UsageTracker = UsageTracker;
let _trackerInstance = null;
function getUsageTracker() {
    if (!_trackerInstance) {
        _trackerInstance = UsageTracker.getInstance();
    }
    return _trackerInstance;
}
// Lazy Proxy tương thích ngược: Chỉ khởi tạo khi được gọi hàm thật sự, không mở SQLite khi chỉ import module
exports.usageTracker = new Proxy({}, {
    get(_target, prop) {
        const inst = getUsageTracker();
        const val = inst[prop];
        return typeof val === 'function' ? val.bind(inst) : val;
    }
});
