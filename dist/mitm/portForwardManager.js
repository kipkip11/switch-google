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
exports.PortForwardManager = void 0;
const os = __importStar(require("os"));
class PortForwardManager {
    /**
     * Sinh lệnh cấu hình port forwarding (chuyển hướng cổng srcPort -> targetPort)
     * tương ứng với từng hệ điều hành.
     *
     * @param srcPort Cổng nguồn (mặc định 443 - HTTPS chuẩn)
     * @param targetPort Cổng đích (mặc định 8443 - MITM Server)
     * @param platformOverride Tùy chọn override platform (phục vụ unit test)
     */
    static getEnableCommand(srcPort = 443, targetPort = 8443, platformOverride) {
        const platform = platformOverride || os.platform();
        if (platform === 'darwin') {
            // macOS Packet Filter (PF):
            // Bắt buộc dùng anchor com.apple/* (được khai báo sẵn trong /etc/pf.conf)
            // và bật IP Forwarding để gói tin loopback được chuyển hướng chính xác.
            return [
                'sudo sysctl -w net.inet.ip.forwarding=1',
                '(sudo pfctl -e 2>/dev/null || true)',
                `echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port ${srcPort} -> 127.0.0.1 port ${targetPort}" | sudo pfctl -a com.apple/switchgoogle -f -`
            ].join(' && ');
        }
        if (platform === 'win32') {
            // Windows: Sử dụng netsh interface portproxy (yêu cầu PowerShell Administrator)
            return `powershell -Command "Start-Process netsh -ArgumentList 'interface portproxy add v4tov4 listenport=${srcPort} listenaddress=127.0.0.1 connectport=${targetPort} connectaddress=127.0.0.1' -Verb RunAs"`;
        }
        // Linux: Sử dụng iptables NAT redirect cho loopback (PREROUTING + OUTPUT)
        return [
            'sudo sysctl -w net.ipv4.ip_forward=1',
            `sudo iptables -t nat -A PREROUTING -p tcp -d 127.0.0.1 --dport ${srcPort} -j REDIRECT --to-ports ${targetPort}`,
            `sudo iptables -t nat -A OUTPUT -p tcp -o lo -d 127.0.0.1 --dport ${srcPort} -j REDIRECT --to-ports ${targetPort}`
        ].join(' && ');
    }
    /**
     * Sinh lệnh hủy cấu hình (Rollback) port forwarding.
     *
     * @param srcPort Cổng nguồn (mặc định 443)
     * @param targetPort Cổng đích (mặc định 8443)
     * @param platformOverride Tùy chọn override platform (phục vụ unit test)
     */
    static getDisableCommand(srcPort = 443, targetPort = 8443, platformOverride) {
        const platform = platformOverride || os.platform();
        if (platform === 'darwin') {
            // macOS: Xả sạch toàn bộ rule trong anchor com.apple/switchgoogle mà không ảnh hưởng rule hệ thống
            return 'sudo pfctl -a com.apple/switchgoogle -F all';
        }
        if (platform === 'win32') {
            return `powershell -Command "Start-Process netsh -ArgumentList 'interface portproxy delete v4tov4 listenport=${srcPort} listenaddress=127.0.0.1' -Verb RunAs"`;
        }
        // Linux: Xóa các rule redirect tương ứng
        return [
            `sudo iptables -t nat -D PREROUTING -p tcp -d 127.0.0.1 --dport ${srcPort} -j REDIRECT --to-ports ${targetPort} 2>/dev/null || true`,
            `sudo iptables -t nat -D OUTPUT -p tcp -o lo -d 127.0.0.1 --dport ${srcPort} -j REDIRECT --to-ports ${targetPort} 2>/dev/null || true`
        ].join('; ');
    }
}
exports.PortForwardManager = PortForwardManager;
