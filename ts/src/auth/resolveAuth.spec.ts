import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { resolveAuth, AUTH_PRECEDENCE } from './resolveAuth.js';
import { buildEnv } from '../process/EnvBuilder.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

/** Keys that must be absent from process.env for deterministic test isolation. */
const AUTH_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
];

beforeEach(() => {
  // Stub all auth-related keys to empty string to isolate from host developer env.
  // vi.unstubAllEnvs() in afterEach restores originals; stubbing to '' ensures
  // they read as falsy (empty string) during the test.
  for (const key of AUTH_ENV_KEYS) {
    vi.stubEnv(key, '');
  }
  vi.mocked(fs.existsSync).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('resolveAuth()', () => {
  it('AUT-01 api-key only — winner=api-key, no warnings, buildEnv passes GEMINI_API_KEY through', () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('api-key');
    expect(r.warnings).toEqual([]);
    expect(r.envOverrides).toEqual({});

    const env = buildEnv(r.envOverrides);
    expect(env['GEMINI_API_KEY']).toBe('test-api-key');
    // Other auth keys were stubbed to '' (falsy) in beforeEach — buildEnv passes '' but resolveAuth ignores them
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBeFalsy();
    expect(env['GOOGLE_API_KEY']).toBeFalsy();
  });

  it('AUT-02 vertex-sa only — winner=vertex-sa, no warnings, buildEnv passes GOOGLE_APPLICATION_CREDENTIALS through', () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/path/to/sa.json');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('vertex-sa');
    expect(r.warnings).toEqual([]);
    expect(r.envOverrides).toEqual({});

    const env = buildEnv(r.envOverrides);
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/path/to/sa.json');
    // Other auth keys were stubbed to '' (falsy) in beforeEach — buildEnv passes '' but resolveAuth ignores them
    expect(env['GEMINI_API_KEY']).toBeFalsy();
    expect(env['GOOGLE_API_KEY']).toBeFalsy();
  });

  it('AUT-03 vertex-key only — winner=vertex-key, no warnings, buildEnv passes GOOGLE_API_KEY through', () => {
    vi.stubEnv('GOOGLE_API_KEY', 'google-api-key-value');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('vertex-key');
    expect(r.warnings).toEqual([]);
    expect(r.envOverrides).toEqual({});

    const env = buildEnv(r.envOverrides);
    expect(env['GOOGLE_API_KEY']).toBe('google-api-key-value');
    // Other auth keys were stubbed to '' (falsy) in beforeEach — buildEnv passes '' but resolveAuth ignores them
    expect(env['GEMINI_API_KEY']).toBeFalsy();
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBeFalsy();
  });

  it('AUT-05 zero env — winner=adc, no warnings, no envOverrides', () => {
    // All auth keys are already stubbed to '' in beforeEach (falsy)
    const r = resolveAuth(process.env);

    expect(r.mode).toBe('adc');
    expect(r.warnings).toEqual([]);
    expect(r.envOverrides).toEqual({});
  });

  it('AUT-06 api-key + vertex-sa — winner=api-key, exactly one warning containing full chain', () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/sa.json');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('api-key');
    expect(r.warnings).toHaveLength(1);
    // Warning must reference the AUTH_PRECEDENCE constant (single source of truth)
    expect(r.warnings[0]).toContain(AUTH_PRECEDENCE.join(' > '));
    expect(r.warnings[0]).toContain('GEMINI_API_KEY'); // winner name
    expect(r.warnings[0]).toContain('GOOGLE_APPLICATION_CREDENTIALS'); // loser name
  });

  it('AUT-06 all explicit modes — winner=api-key (highest precedence), warning names all losers', () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/sa.json');
    vi.stubEnv('GOOGLE_API_KEY', 'g');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('api-key');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(AUTH_PRECEDENCE.join(' > '));
    expect(r.warnings[0]).toContain('GEMINI_API_KEY');
    expect(r.warnings[0]).toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(r.warnings[0]).toContain('GOOGLE_API_KEY');
  });

  it('AUT-04 GCP project vars flow through buildEnv regardless of mode', () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'my-project');
    vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'us-central1');

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('api-key');

    const env = buildEnv(r.envOverrides);
    expect(env['GOOGLE_CLOUD_PROJECT']).toBe('my-project');
    expect(env['GOOGLE_CLOUD_LOCATION']).toBe('us-central1');
  });

  it('AUTH_PRECEDENCE constant equals [ADC, GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_API_KEY]', () => {
    expect(AUTH_PRECEDENCE).toEqual([
      'ADC',
      'GEMINI_API_KEY',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_API_KEY',
    ]);
  });

  it('dynamically prioritizes ADC if credentials file exists and strips GEMINI_API_KEY', () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const r = resolveAuth(process.env);

    expect(r.mode).toBe('adc');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('ADC');
    expect(r.warnings[0]).toContain('GEMINI_API_KEY');
    
    // API key should be overridden to empty string
    expect(r.envOverrides['GEMINI_API_KEY']).toBe('');

    const env = buildEnv(r.envOverrides);
    expect(env['GEMINI_API_KEY']).toBeFalsy();
  });
});
