import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export class CertManager {
  private static mitmDir = path.join(os.homedir(), '.config', 'switch-google', 'mitm');
  private static caKeyPath = path.join(CertManager.mitmDir, 'rootCA.key');
  private static caCertPath = path.join(CertManager.mitmDir, 'rootCA.crt');
  private static certsDir = path.join(CertManager.mitmDir, 'certs');

  public static getMitmDir(): string {
    return this.mitmDir;
  }

  public static ensureRootCA(): { key: Buffer; cert: Buffer } {
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
        const certText = execSync(`openssl x509 -text -noout -in "${this.caCertPath}"`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        });
        if (!certText.includes('CA:TRUE') || !certText.includes('Certificate Sign')) {
          console.warn('[CertManager] Phát hiện Root CA cũ là X509v1 hoặc thiếu basicConstraints CA:TRUE. Đang tự động tái tạo chuẩn X509v3...');
          needGenerateCA = true;
          if (fs.existsSync(this.caKeyPath)) fs.unlinkSync(this.caKeyPath);
          if (fs.existsSync(this.caCertPath)) fs.unlinkSync(this.caCertPath);
          // Xóa bỏ các domain cert cũ đã ký bởi CA cũ để đảm bảo tính nhất quán chuỗi chứng chỉ
          if (fs.existsSync(this.certsDir)) {
            fs.rmSync(this.certsDir, { recursive: true, force: true });
            fs.mkdirSync(this.certsDir, { recursive: true, mode: 0o700 });
          }
        }
      } catch {
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
        execSync(
          `openssl req -x509 -new -newkey rsa:2048 -nodes -keyout "${this.caKeyPath}" -out "${this.caCertPath}" -days 3650 -config "${caCnfPath}" -extensions v3_ca`,
          { stdio: 'pipe' }
        );
        fs.chmodSync(this.caKeyPath, 0o600);
        fs.chmodSync(this.caCertPath, 0o644);
      } finally {
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

  public static getCertForDomain(domain: string): { key: Buffer; cert: Buffer } {
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
    execSync(
      `openssl req -new -nodes -newkey rsa:2048 -keyout "${domainKey}" -out "${domainCsr}" -subj "/CN=${domain}/O=SwitchGoogle"`,
      { stdio: 'pipe' }
    );
    execSync(
      `openssl x509 -req -in "${domainCsr}" -CA "${this.caCertPath}" -CAkey "${this.caKeyPath}" -CAcreateserial -out "${domainCert}" -days 825 -extfile "${domainExt}"`,
      { stdio: 'pipe' }
    );

    // Clean up temporary files
    try {
      if (fs.existsSync(domainCsr)) fs.unlinkSync(domainCsr);
      if (fs.existsSync(domainExt)) fs.unlinkSync(domainExt);
    } catch {}

    return {
      key: fs.readFileSync(domainKey),
      cert: fs.readFileSync(domainCert)
    };
  }

  public static isCertTrusted(): boolean {
    if (process.platform === 'darwin') {
      try {
        const out = execSync(`security dump-trust-settings -d 2>/dev/null || true`, { encoding: 'utf8' });
        return out.includes('Switch Google Root CA');
      } catch {
        return false;
      }
    }
    return fs.existsSync(this.caCertPath);
  }

  public static getTrustCommand(platformOverride?: string): string {
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
