import { PortForwardManager } from '../src/mitm/portForwardManager';

describe('PortForwardManager', () => {
  test('should generate valid port forward enable command on macOS', () => {
    const cmd = PortForwardManager.getEnableCommand(443, 8443, 'darwin');
    expect(cmd).toContain('sysctl -w net.inet.ip.forwarding=1');
    expect(cmd).toContain('pfctl -e');
    expect(cmd).toContain('rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443');
    expect(cmd).toContain('-a com.apple/switchgoogle');
  });

  test('should generate valid port forward disable command on macOS', () => {
    const cmd = PortForwardManager.getDisableCommand(443, 8443, 'darwin');
    expect(cmd).toBe('sudo pfctl -a com.apple/switchgoogle -F all');
  });

  test('should generate valid port forward enable command on Linux', () => {
    const cmd = PortForwardManager.getEnableCommand(443, 8443, 'linux');
    expect(cmd).toContain('iptables -t nat -A PREROUTING');
    expect(cmd).toContain('iptables -t nat -A OUTPUT');
    expect(cmd).toContain('--to-ports 8443');
  });

  test('should generate valid port forward disable command on Linux', () => {
    const cmd = PortForwardManager.getDisableCommand(443, 8443, 'linux');
    expect(cmd).toContain('iptables -t nat -D PREROUTING');
    expect(cmd).toContain('iptables -t nat -D OUTPUT');
  });

  test('should generate valid port forward command on Windows', () => {
    const enableCmd = PortForwardManager.getEnableCommand(443, 8443, 'win32');
    expect(enableCmd).toContain('netsh');
    expect(enableCmd).toContain('interface portproxy add v4tov4');

    const disableCmd = PortForwardManager.getDisableCommand(443, 8443, 'win32');
    expect(disableCmd).toContain('interface portproxy delete v4tov4');
  });
});
