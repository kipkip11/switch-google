import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProfileStorage } from '../src/auth/storage';
import { ProfileManager } from '../src/profiles/manager';
import { AccountRotator } from '../src/profiles/rotator';

describe('AccountRotator', () => {
  let tempDir: string;
  let storage: ProfileStorage;
  let manager: ProfileManager;
  let rotator: AccountRotator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-rotator-test-'));
    storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    rotator = new AccountRotator(manager);

    // Setup 3 test accounts
    manager.addDirectTokenProfile('acc1', 'acc1@gmail.com', 'token-1');
    manager.addDirectTokenProfile('acc2', 'acc2@gmail.com', 'token-2');
    manager.addDirectTokenProfile('acc3', 'acc3@gmail.com', 'token-3');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should return all 3 accounts in round-robin mode', async () => {
    rotator.setStrategy('round-robin');

    const first = await rotator.getNextAccount();
    const second = await rotator.getNextAccount();
    const third = await rotator.getNextAccount();
    const fourth = await rotator.getNextAccount();

    expect(first.profile).toBe('acc1');
    expect(second.profile).toBe('acc2');
    expect(third.profile).toBe('acc3');
    expect(fourth.profile).toBe('acc1'); // Cycles back
  });

  test('should prioritize first available account in fallback mode', async () => {
    rotator.setStrategy('fallback');

    const first = await rotator.getNextAccount();
    const second = await rotator.getNextAccount();

    expect(first.profile).toBe('acc1');
    expect(second.profile).toBe('acc1');
  });

  test('should skip disabled accounts', async () => {
    rotator.setStrategy('round-robin');
    rotator.toggleProfileDisabled('acc2', true);

    const first = await rotator.getNextAccount();
    const second = await rotator.getNextAccount();
    const third = await rotator.getNextAccount();

    expect(first.profile).toBe('acc1');
    expect(second.profile).toBe('acc3');
    expect(third.profile).toBe('acc1');
  });

  test('should bypass cooling down accounts', async () => {
    rotator.setStrategy('round-robin');
    rotator.markCooldown('acc1', 30); // 30s cooldown

    const next = await rotator.getNextAccount();
    expect(next.profile).toBe('acc2');
  });

  test('should report matrix switch port statuses accurately', () => {
    rotator.markCooldown('acc2', 60);
    rotator.toggleProfileDisabled('acc3', true);

    const ports = rotator.getPortStatuses();
    expect(ports).toHaveLength(3);

    const port1 = ports.find(p => p.profile === 'acc1')!;
    const port2 = ports.find(p => p.profile === 'acc2')!;
    const port3 = ports.find(p => p.profile === 'acc3')!;

    expect(port1.linkStatus).toBe('up');
    expect(port2.linkStatus).toBe('cooldown');
    expect(port2.cooldownRemainingSeconds).toBeGreaterThan(0);
    expect(port3.linkStatus).toBe('down');
    expect(port3.isDisabled).toBe(true);
  });
});
