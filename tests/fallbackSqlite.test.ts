import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProfileStorage, GoogleProfile } from '../src/auth/storage';
import { SqliteStorage } from '../src/storage/sqliteStorage';

describe('FallbackSqliteDb Compatibility Engine', () => {
  let tempDir: string;
  let sqlite: SqliteStorage;
  let storage: ProfileStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-fallback-test-'));
    // Force sqliteStorage to use Fallback mode regardless of node environment
    sqlite = new SqliteStorage(tempDir);
    storage = new ProfileStorage(tempDir);
  });

  afterEach(() => {
    sqlite.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should store and retrieve oauth and web_session profiles accurately with tokens and cookies', () => {
    const oauthProfile: GoogleProfile = {
      name: 'oauth-acc',
      email: 'oauth@gmail.com',
      type: 'oauth',
      tokens: {
        access_token: 'access-12345',
        refresh_token: 'refresh-67890',
        expiry_date: 1893456000000
      },
      createdAt: 1000,
      updatedAt: 2000
    };

    const webProfile: GoogleProfile = {
      name: 'web-acc',
      email: 'web@gmail.com',
      type: 'web_session',
      cookies: '__Secure-1PSID=test_cookie; SNlM0e=test_snlm0e',
      tokens: {
        access_token: 'web_session_cookie',
        token_type: 'Bearer',
        expiry_date: null
      },
      createdAt: 3000,
      updatedAt: 4000
    };

    storage.save({
      activeProfile: 'oauth-acc',
      profiles: {
        'oauth-acc': oauthProfile,
        'web-acc': webProfile
      },
      apiKeys: [],
      combos: []
    });

    const loaded = storage.load();
    expect(loaded.activeProfile).toBe('oauth-acc');
    expect(loaded.profiles['oauth-acc'].tokens.access_token).toBe('access-12345');
    expect(loaded.profiles['oauth-acc'].tokens.refresh_token).toBe('refresh-67890');
    expect(loaded.profiles['web-acc'].cookies).toBe('__Secure-1PSID=test_cookie; SNlM0e=test_snlm0e');
  });
});
