import { DaemonManager } from '../src/services/daemon';

describe('DaemonManager', () => {
  let daemon: DaemonManager;

  beforeEach(() => {
    daemon = new DaemonManager();
  });

  test('should initialize and return daemon status structure', () => {
    const status = daemon.getStatus(1909);
    expect(status).toHaveProperty('isRunning');
    expect(status).toHaveProperty('port', 1909);
    expect(status).toHaveProperty('autoStartEnabled');
    expect(status).toHaveProperty('logFile');
  });

  test('should detect process alive state safely', () => {
    // Current node process PID is always alive
    expect(daemon.isProcessAlive(process.pid)).toBe(true);
    // Non-existent PID 99999999 should return false
    expect(daemon.isProcessAlive(99999999)).toBe(false);
  });

  test('should check GitHub update structure without throwing', async () => {
    const result = await daemon.checkGithubUpdates();
    expect(result).toHaveProperty('hasUpdate');
    expect(result).toHaveProperty('currentVersion');
    expect(typeof result.hasUpdate).toBe('boolean');
  }, 10000);
});
