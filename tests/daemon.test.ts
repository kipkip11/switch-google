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

  test('should check GitHub update structure including CI/CD verification without throwing', async () => {
    const result = await daemon.checkGithubUpdates();
    expect(result).toHaveProperty('hasUpdate');
    expect(result).toHaveProperty('currentVersion');
    expect(result).toHaveProperty('ciPassed');
    expect(result).toHaveProperty('ciStatus');
    expect(result).toHaveProperty('safeToAutoUpdate');
    expect(typeof result.hasUpdate).toBe('boolean');
    expect(typeof result.ciPassed).toBe('boolean');
    expect(typeof result.safeToAutoUpdate).toBe('boolean');
  }, 15000);

  test('should manage auto-update config properly', () => {
    const originalConfig = daemon.getAutoUpdateConfig();
    expect(typeof originalConfig.enabled).toBe('boolean');
    expect(typeof originalConfig.intervalMinutes).toBe('number');

    const updated = daemon.saveAutoUpdateConfig({ enabled: false, intervalMinutes: 120 });
    expect(updated.enabled).toBe(false);
    expect(updated.intervalMinutes).toBe(120);

    const reloaded = daemon.getAutoUpdateConfig();
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.intervalMinutes).toBe(120);

    // Restore
    daemon.saveAutoUpdateConfig({ enabled: true, intervalMinutes: 60 });
  });

  test('should correctly parse CI/CD check runs status', async () => {
    // Test passed scenario
    const mockPassed = jest.spyOn(daemon as any, 'fetchGithubJson').mockResolvedValueOnce({
      total_count: 2,
      check_runs: [
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'success' }
      ]
    });
    const passedRes = await daemon.checkCiCdStatus('mock-sha-pass');
    expect(passedRes.passed).toBe(true);
    expect(passedRes.status).toBe('success');
    mockPassed.mockRestore();

    // Test in-progress scenario
    const mockInProgress = jest.spyOn(daemon as any, 'fetchGithubJson').mockResolvedValueOnce({
      total_count: 2,
      check_runs: [
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null }
      ]
    });
    const inProgressRes = await daemon.checkCiCdStatus('mock-sha-running');
    expect(inProgressRes.passed).toBe(false);
    expect(inProgressRes.status).toBe('in_progress');
    mockInProgress.mockRestore();

    // Test failed scenario
    const mockFailed = jest.spyOn(daemon as any, 'fetchGithubJson').mockResolvedValueOnce({
      total_count: 2,
      check_runs: [
        { status: 'completed', conclusion: 'failure' },
        { status: 'completed', conclusion: 'success' }
      ]
    });
    const failedRes = await daemon.checkCiCdStatus('mock-sha-fail');
    expect(failedRes.passed).toBe(false);
    expect(failedRes.status).toBe('failed');
    mockFailed.mockRestore();
  });
});
