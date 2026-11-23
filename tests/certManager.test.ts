import { CertManager } from '../src/mitm/certManager';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('CertManager X509v3 & Go Compatibility', () => {
  test('should generate an RFC 5280 compliant X509v3 Root CA with CA:TRUE', () => {
    const rootCA = CertManager.ensureRootCA();
    expect(rootCA.key).toBeDefined();
    expect(rootCA.cert).toBeDefined();

    const certPath = path.join(CertManager.getMitmDir(), 'rootCA.crt');
    expect(fs.existsSync(certPath)).toBe(true);

    // Kiểm tra cấu trúc X509v3 bắt buộc cho Go crypto/x509
    const certText = execSync(`openssl x509 -text -noout -in "${certPath}"`, { encoding: 'utf8' });
    expect(certText).toContain('Version: 3');
    expect(certText).toContain('CA:TRUE');
    expect(certText).toContain('Certificate Sign');
    expect(certText).toContain('CRL Sign');
  });

  test('should generate a valid domain certificate verifiable against Root CA', () => {
    const domain = 'daily-cloudcode-pa.googleapis.com';
    const domainCert = CertManager.getCertForDomain(domain);
    expect(domainCert.key).toBeDefined();
    expect(domainCert.cert).toBeDefined();

    const caPath = path.join(CertManager.getMitmDir(), 'rootCA.crt');
    const domainCertPath = path.join(CertManager.getMitmDir(), 'certs', `${domain}.crt`);

    // Xác minh chuỗi tin cậy bằng OpenSSL
    const verifyOutput = execSync(`openssl verify -CAfile "${caPath}" "${domainCertPath}"`, {
      encoding: 'utf8'
    });
    expect(verifyOutput).toContain(`${domainCertPath}: OK`);

    // Kiểm tra SAN (Subject Alternative Names)
    const domainText = execSync(`openssl x509 -text -noout -in "${domainCertPath}"`, { encoding: 'utf8' });
    expect(domainText).toContain('DNS:daily-cloudcode-pa.googleapis.com');
    expect(domainText).toContain('IP Address:127.0.0.1');
    expect(domainText).toContain('CA:FALSE');
  });

  test('should generate appropriate trust command for macOS, Linux, and Windows', () => {
    const macCmd = CertManager.getTrustCommand('darwin');
    expect(macCmd).toContain('security add-trusted-cert');
    expect(macCmd).toContain('delete-certificate');

    const linuxCmd = CertManager.getTrustCommand('linux');
    expect(linuxCmd).toContain('update-ca-certificates');
    expect(linuxCmd).toContain('ca-certificates');

    const winCmd = CertManager.getTrustCommand('win32');
    expect(winCmd).toContain('certutil -addstore -f "ROOT"');
  });
});
