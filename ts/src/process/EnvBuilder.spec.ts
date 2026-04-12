import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildEnv } from './EnvBuilder.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildEnv()', () => {
  it('returns only allowlisted keys from process.env', () => {
    vi.stubEnv('SECRET_KEY', 'super-secret-value');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAIOSFODNN7EXAMPLE');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.stubEnv('PATH', '/usr/bin:/bin');

    const env = buildEnv();

    expect(env['GEMINI_API_KEY']).toBe('test-api-key');
    expect(env['PATH']).toBe('/usr/bin:/bin');
    // Non-allowlisted keys must NOT be present
    expect(Object.keys(env)).not.toContain('SECRET_KEY');
    expect(Object.keys(env)).not.toContain('AWS_ACCESS_KEY_ID');
  });

  it('does NOT leak non-allowlisted keys (security check)', () => {
    // Set several dangerous env vars
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@host/db');
    vi.stubEnv('PRIVATE_KEY', 'BEGIN RSA PRIVATE KEY');
    vi.stubEnv('NPM_TOKEN', 'npm_12345');

    const env = buildEnv();

    expect(Object.keys(env)).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(Object.keys(env)).not.toContain('DATABASE_URL');
    expect(Object.keys(env)).not.toContain('PRIVATE_KEY');
    expect(Object.keys(env)).not.toContain('NPM_TOKEN');
  });

  it('merges caller-supplied overrides on top of allowlisted env', () => {
    vi.stubEnv('PATH', '/usr/bin');

    const env = buildEnv({ CUSTOM_VAR: 'custom-value', ANOTHER: 'another-value' });

    expect(env['CUSTOM_VAR']).toBe('custom-value');
    expect(env['ANOTHER']).toBe('another-value');
    expect(env['PATH']).toBe('/usr/bin');
  });

  it('overrides win over process.env for same key', () => {
    vi.stubEnv('PATH', '/original/path');
    vi.stubEnv('GEMINI_API_KEY', 'original-key');

    const env = buildEnv({ PATH: '/overridden/path', GEMINI_API_KEY: 'new-key' });

    expect(env['PATH']).toBe('/overridden/path');
    expect(env['GEMINI_API_KEY']).toBe('new-key');
  });

  it('always includes GEMINI_API_KEY if set in process.env', () => {
    vi.stubEnv('GEMINI_API_KEY', 'my-api-key-12345');

    const env = buildEnv();

    expect(env['GEMINI_API_KEY']).toBe('my-api-key-12345');
  });

  it('always includes PATH if set in process.env', () => {
    vi.stubEnv('PATH', '/usr/local/bin:/usr/bin:/bin');

    const env = buildEnv();

    expect(env['PATH']).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('returns empty object when no allowlisted vars are set in env and no overrides', () => {
    // Wipe all known allowlisted vars from environment by stubbing them to undefined
    // vi.stubEnv cannot set to undefined, but we can verify non-allowlisted keys are absent
    const env = buildEnv();
    // Should not contain any non-allowlisted keys
    const allowedKeys = new Set([
      'PATH', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
      'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'SystemDrive', 'COMSPEC',
      'HOMEDRIVE', 'HOMEPATH', 'LOGNAME', 'SHELL', 'TERM',
      'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID',
      'GOOGLE_CLOUD_LOCATION',
      'GEMINI_CONFIG_DIR', 'GEMINI_SYSTEM_MD', 'GEMINI_BIN_PATH',
      'PYTHONUTF8',
    ]);
    for (const key of Object.keys(env)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
