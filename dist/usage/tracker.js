"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageTracker = exports.UsageTracker = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
class UsageTracker {
    static instance;
    logFile;
    logs = [];
    maxLogs = 5000;
    constructor() {
        const baseDir = path_1.default.join(os_1.default.homedir(), '.switch-google');
        if (!fs_1.default.existsSync(baseDir)) {
            fs_1.default.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
        }
        this.logFile = path_1.default.join(baseDir, 'usage_logs.json');
        this.loadLogs();
    }
    static getInstance() {
        if (!UsageTracker.instance) {
            UsageTracker.instance = new UsageTracker();
        }
        return UsageTracker.instance;
    }
    loadLogs() {
        try {
            if (fs_1.default.existsSync(this.logFile)) {
                const raw = fs_1.default.readFileSync(this.logFile, 'utf-8');
                this.logs = JSON.parse(raw);
                if (!Array.isArray(this.logs))
                    this.logs = [];
            }
        }
        catch (err) {
            this.logs = [];
        }
    }
    saveLogs() {
        try {
            // Keep only maxLogs items
            if (this.logs.length > this.maxLogs) {
                this.logs = this.logs.slice(-this.maxLogs);
            }
            fs_1.default.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2), { mode: 0o600 });
        }
        catch (_) { }
    }
    record(record) {
        const entry = {
            id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
            timestamp: Date.now(),
            ...record
        };
        this.logs.push(entry);
        this.saveLogs();
        return entry;
    }
    getRecentLogs(limit = 100, filterModel, filterAccount) {
        let result = [...this.logs].reverse();
        if (filterModel) {
            result = result.filter(r => r.model.toLowerCase().includes(filterModel.toLowerCase()));
        }
        if (filterAccount) {
            result = result.filter(r => r.email.toLowerCase().includes(filterAccount.toLowerCase()) || r.profile.toLowerCase().includes(filterAccount.toLowerCase()));
        }
        return result.slice(0, limit);
    }
    clearLogs() {
        this.logs = [];
        this.saveLogs();
    }
    getStats() {
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        const tokensByModel = {};
        const tokensByAccount = {};
        const requestsByAccount = {};
        // Group logs by 10-minute intervals for the last 24 hours
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const bucketMap = new Map();
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
exports.UsageTracker = UsageTracker;
exports.usageTracker = UsageTracker.getInstance();
