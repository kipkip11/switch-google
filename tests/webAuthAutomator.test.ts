import { findChromiumExecutable, connectCdp } from '../src/services/webAuthAutomator';

describe('webAuthAutomator', () => {
  it('should find a valid chromium executable or return null gracefully', () => {
    const execPath = findChromiumExecutable();
    if (execPath) {
      expect(typeof execPath).toBe('string');
      expect(execPath.length).toBeGreaterThan(0);
    } else {
      expect(execPath).toBeNull();
    }
  });

  it('should fail gracefully when connecting to an unreachable CDP endpoint', async () => {
    // Port 59999 is unlikely to be listening
    await expect(connectCdp('ws://127.0.0.1:59999/devtools/browser/invalid')).rejects.toThrow();
  });
});
