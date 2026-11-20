"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DnsManager = void 0;
const fs = __importStar(require("fs"));
const HOSTS_FILE = process.platform === 'win32'
    ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\drivers\\etc\\hosts`
    : '/etc/hosts';
const START_MARKER = '# BEGIN SWITCH-GOOGLE MITM';
const END_MARKER = '# END SWITCH-GOOGLE MITM';
const TARGET_DOMAINS = [
    'daily-cloudcode-pa.googleapis.com',
    'cloudcode-pa.googleapis.com'
];
class DnsManager {
    static isEnabled() {
        try {
            if (!fs.existsSync(HOSTS_FILE))
                return false;
            const content = fs.readFileSync(HOSTS_FILE, 'utf8');
            return content.includes(START_MARKER) && content.includes(END_MARKER);
        }
        catch {
            return false;
        }
    }
    static getEnableCommand() {
        const lines = [
            START_MARKER,
            ...TARGET_DOMAINS.map((d) => `127.0.0.1 ${d}`),
            END_MARKER
        ].join('\\n');
        if (process.platform === 'win32') {
            return `powershell -Command "Add-Content -Path '${HOSTS_FILE}' -Value '${lines}'"`;
        }
        return `echo "${lines}" | sudo tee -a ${HOSTS_FILE} > /dev/null`;
    }
    static getDisableCommand() {
        if (process.platform === 'win32') {
            return `powershell -Command "$content = Get-Content '${HOSTS_FILE}' -Raw; $content = $content -replace '(?s)${START_MARKER}.*?${END_MARKER}\\r?\\n?', ''; Set-Content '${HOSTS_FILE}' -Value $content"`;
        }
        return `sudo sed -i '' '/${START_MARKER}/,/${END_MARKER}/d' ${HOSTS_FILE} 2>/dev/null || sudo sed -i '/${START_MARKER}/,/${END_MARKER}/d' ${HOSTS_FILE}`;
    }
    static registerExitRollback() {
        const rollback = () => {
            try {
                if (DnsManager.isEnabled()) {
                    // Chỉ cố gắng gỡ nếu có quyền write hoặc chạy ngầm an toàn
                    const content = fs.readFileSync(HOSTS_FILE, 'utf8');
                    const reg = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'g');
                    const clean = content.replace(reg, '');
                    fs.writeFileSync(HOSTS_FILE, clean, 'utf8');
                }
            }
            catch { }
        };
        process.once('SIGINT', () => { rollback(); process.exit(0); });
        process.once('SIGTERM', () => { rollback(); process.exit(0); });
        process.once('beforeExit', () => { rollback(); });
    }
}
exports.DnsManager = DnsManager;
