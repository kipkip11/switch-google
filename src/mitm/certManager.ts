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

    if (!fs.existsSync(this.caKeyPath) || !fs.existsSync(this.caCertPath)) {
      // Sinh root CA dùng OpenSSL có sẵn trên hệ thống (macOS / Linux / Windows)
      execSync(
        `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${this.caKeyPath}" -out "${this.caCertPath}" -days 3650 -subj "/CN=Switch Google Root CA/O=SwitchGoogle/OU=LocalProxy"`,
        { stdio: 'pipe' }
      );
      fs.chmodSync(this.caKeyPath, 0o600);
      fs.chmodSync(this.caCertPath, 0o644);
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

  public static getTrustCommand(): string {
    if (process.platform === 'darwin') {
      return `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.caCertPath}"`;
    }
    if (process.platform === 'linux') {
      return `sudo cp "${this.caCertPath}" /usr/local/share/ca-certificates/switch-google.crt && sudo update-ca-certificates`;
    }
    return `certutil -addstore -f "ROOT" "${this.caCertPath}"`;
  }
}
