import http from 'http';
import { findChromiumExecutable, connectCdp, getFreePort, isCdpAlive } from '../src/services/webAuthAutomator';

describe('webAuthAutomator', () => {
  it('should allocate a valid free port dynamically', async () => {
    const port = await getFreePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it('should find a valid chromium executable or return null gracefully', () => {
    const execPath = findChromiumExecutable();
    if (execPath) {
      expect(typeof execPath).toBe('string');
      expect(execPath.length).toBeGreaterThan(0);
    } else {
      expect(execPath).toBeNull();
    }
  });

  it('should correctly detect CDP endpoint alive state', async () => {
    // 1. Unreachable port returns false
    const deadStatus = await isCdpAlive(59998);
    expect(deadStatus).toBe(false);

    // 2. Active mock CDP server returns true
    const server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:1234/test' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const activePort: number = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as any).port);
      });
    });

    try {
      const aliveStatus = await isCdpAlive(activePort);
      expect(aliveStatus).toBe(true);
    } finally {
      server.close();
    }
  });

  it('should fail gracefully when connecting to an unreachable CDP endpoint', async () => {
    // Port 59999 is unlikely to be listening
    await expect(connectCdp('ws://127.0.0.1:59999/devtools/browser/invalid')).rejects.toThrow();
  });
});
