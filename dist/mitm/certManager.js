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
exports.CertManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
class CertManager {
    static mitmDir = path.join(os.homedir(), '.config', 'switch-google', 'mitm');
    static caKeyPath = path.join(CertManager.mitmDir, 'rootCA.key');
    static caCertPath = path.join(CertManager.mitmDir, 'rootCA.crt');
    static certsDir = path.join(CertManager.mitmDir, 'certs');
    static getMitmDir() {
        return this.mitmDir;
    }
    static ensureRootCA() {
        if (!fs.existsSync(this.mitmDir)) {
            fs.mkdirSync(this.mitmDir, { recursive: true, mode: 0o700 });
        }
        if (!fs.existsSync(this.certsDir)) {
            fs.mkdirSync(this.certsDir, { recursive: true, mode: 0o700 });
        }
        let needGenerateCA = !fs.existsSync(this.caKeyPath) || !fs.existsSync(this.caCertPath);
        // Kiểm tra tính hợp lệ của Root CA: Bắt buộc phải là chuẩn X509v3 với basicConstraints CA:TRUE
        // để tương thích tuyệt đối với Go crypto/x509 trên Antigravity IDE
        if (!needGenerateCA) {
            try {
                const certText = (0, child_process_1.execSync)(`openssl x509 -text -noout -in "${this.caCertPath}"`, {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                });
                if (!certText.includes('CA:TRUE') || !certText.includes('Certificate Sign')) {
                    console.warn('[CertManager] Phát hiện Root CA cũ là X509v1 hoặc thiếu basicConstraints CA:TRUE. Đang tự động tái tạo chuẩn X509v3...');
                    needGenerateCA = true;
                    if (fs.existsSync(this.caKeyPath))
                        fs.unlinkSync(this.caKeyPath);
                    if (fs.existsSync(this.caCertPath))
                        fs.unlinkSync(this.caCertPath);
                    // Xóa bỏ các domain cert cũ đã ký bởi CA cũ để đảm bảo tính nhất quán chuỗi chứng chỉ
                    if (fs.existsSync(this.certsDir)) {
                        fs.rmSync(this.certsDir, { recursive: true, force: true });
                        fs.mkdirSync(this.certsDir, { recursive: true, mode: 0o700 });
                    }
                }
            }
            catch {
                needGenerateCA = true;
            }
        }
        if (needGenerateCA) {
            const caCnfPath = path.join(this.mitmDir, 'rootCA.cnf');
            const caCnfContent = `
[ req ]
distinguished_name = req_dn
x509_extensions = v3_ca
prompt = no

[ req_dn ]
CN = Switch Google Root CA
O = SwitchGoogle
OU = LocalProxy

[ v3_ca ]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
`;
            fs.writeFileSync(caCnfPath, caCnfContent);
            try {
                // Sinh Root CA chuẩn X509v3 với CA:TRUE và keyCertSign (chuẩn RFC 5280)
                (0, child_process_1.execSync)(`openssl req -x509 -new -newkey rsa:2048 -nodes -keyout "${this.caKeyPath}" -out "${this.caCertPath}" -days 3650 -config "${caCnfPath}" -extensions v3_ca`, { stdio: 'pipe' });
                fs.chmodSync(this.caKeyPath, 0o600);
                fs.chmodSync(this.caCertPath, 0o644);
            }
            finally {
                if (fs.existsSync(caCnfPath)) {
                    fs.unlinkSync(caCnfPath);
                }
            }
        }
        return {
            key: fs.readFileSync(this.caKeyPath),
            cert: fs.readFileSync(this.caCertPath)
        };
    }
    static getCertForDomain(domain) {
        this.ensureRootCA();
        const domainKey = path.join(this.certsDir, `${domain}.key`);
        const domainCert = path.join(this.certsDir, `${domain}.crt`);
        const domainCsr = path.join(this.certsDir, `${domain}.csr`);
        const domainExt = path.join(this.certsDir, `${domain}.ext`);
        if (fs.existsSync(domainKey) && fs.existsSync(domainCert)) {
            return {
                key: fs.readFileSync(domainKey),
                cert: fs.readFileSync(domainCert)
            };
        }
        // Tạo SAN config cho OpenSSL
        const extContent = `
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${domain}
DNS.2 = *.${domain}
DNS.3 = localhost
IP.1 = 127.0.0.1
`;
        fs.writeFileSync(domainExt, extContent);
        // Sinh cert domain
        (0, child_process_1.execSync)(`openssl req -new -nodes -newkey rsa:2048 -keyout "${domainKey}" -out "${domainCsr}" -subj "/CN=${domain}/O=SwitchGoogle"`, { stdio: 'pipe' });
        (0, child_process_1.execSync)(`openssl x509 -req -in "${domainCsr}" -CA "${this.caCertPath}" -CAkey "${this.caKeyPath}" -CAcreateserial -out "${domainCert}" -days 825 -extfile "${domainExt}"`, { stdio: 'pipe' });
        // Clean up temporary files
        try {
            if (fs.existsSync(domainCsr))
                fs.unlinkSync(domainCsr);
            if (fs.existsSync(domainExt))
                fs.unlinkSync(domainExt);
        }
        catch { }
        return {
            key: fs.readFileSync(domainKey),
            cert: fs.readFileSync(domainCert)
        };
    }
    static isCertTrusted() {
        if (process.platform === 'darwin') {
            try {
                const out = (0, child_process_1.execSync)(`security dump-trust-settings -d 2>/dev/null || true`, { encoding: 'utf8' });
                return out.includes('Switch Google Root CA');
            }
            catch {
                return false;
            }
        }
        return fs.existsSync(this.caCertPath);
    }
    static getTrustCommand(platformOverride) {
        const platform = platformOverride || process.platform;
        if (platform === 'darwin') {
            return `sudo security delete-certificate -c "Switch Google Root CA" /Library/Keychains/System.keychain 2>/dev/null || true; sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.caCertPath}"`;
        }
        if (platform === 'linux') {
            return `sudo cp "${this.caCertPath}" /usr/local/share/ca-certificates/switch-google.crt && sudo update-ca-certificates`;
        }
        return `certutil -addstore -f "ROOT" "${this.caCertPath}"`;
    }
}
exports.CertManager = CertManager;
