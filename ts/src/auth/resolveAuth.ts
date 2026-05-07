import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Auth mode detection for gemini-sdk.
 * Pure function — zero imports, no I/O, no subprocess.
 */

/**
 * The resolved authentication mode.
 *
 * - 'api-key'   — GEMINI_API_KEY is set
 * - 'vertex-sa' — GOOGLE_APPLICATION_CREDENTIALS is set (service account JSON)
 * - 'vertex-key'— GOOGLE_API_KEY is set
 * - 'adc'       — no explicit var set; fall through to Application Default Credentials
 * - 'none'      — Reserved for future explicit opt-out; unreachable via current detection.
 */
// Note: 'none' is declared but unreachable via current public API.
// Reserved for future explicit opt-out (e.g. options.auth='off').
export type AuthMode = 'api-key' | 'vertex-sa' | 'vertex-key' | 'adc' | 'none';

export interface ResolvedAuth {
  mode: AuthMode;
  /** Empty today; reserved for future per-call auth override. */
  envOverrides: Record<string, string>;
  /** Non-empty when multiple auth modes are configured simultaneously. */
  warnings: string[];
}

/**
 * Locked precedence order for auth mode resolution.
 * Warning messages reference this constant so test assertions never hardcode the chain string.
 */
export const AUTH_PRECEDENCE: readonly string[] = [
  'ADC',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
];

function hasAdcCredentials(): boolean {
  const home = os.homedir();
  if (!home) return false;

  // Check gemini-cli's native credentials
  if (fs.existsSync(path.join(home, '.gemini', 'credentials.json'))) {
    return true;
  }

  // Check gcloud ADC
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata && fs.existsSync(path.join(appdata, 'gcloud', 'application_default_credentials.json'))) {
      return true;
    }
  } else {
    if (fs.existsSync(path.join(home, '.config', 'gcloud', 'application_default_credentials.json'))) {
      return true;
    }
  }

  return false;
}

/**
 * Inspects the given env dictionary, applies the documented precedence chain
 * `ADC > GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY`,
 * and returns the resolved mode, envOverrides, and warnings.
 *
 * @param env - `process.env` or any dictionary (pure: caller-supplied, not read directly)
 * @param options - Reserved for future QueryOptions.auth; currently ignored
 */
export function resolveAuth(
  env: NodeJS.ProcessEnv,
  options?: Record<string, never>,
): ResolvedAuth {
  // Silence unused-var lint for reserved options param
  void options;

  const configured: Array<{ mode: AuthMode; name: string }> = [];
  const envOverrides: Record<string, string> = {};

  if (hasAdcCredentials()) {
    configured.push({ mode: 'adc', name: 'ADC' });
    // Strip the API key so it doesn't accidentally override the CLI Auth
    if (env['GEMINI_API_KEY']) {
      envOverrides['GEMINI_API_KEY'] = '';
    }
  }

  if (!!env['GEMINI_API_KEY']) {
    configured.push({ mode: 'api-key', name: 'GEMINI_API_KEY' });
  }
  if (!!env['GOOGLE_APPLICATION_CREDENTIALS']) {
    configured.push({ mode: 'vertex-sa', name: 'GOOGLE_APPLICATION_CREDENTIALS' });
  }
  if (!!env['GOOGLE_API_KEY']) {
    configured.push({ mode: 'vertex-key', name: 'GOOGLE_API_KEY' });
  }

  const winner: AuthMode = configured[0]?.mode ?? 'adc';
  const warnings: string[] = [];

  if (configured.length > 1) {
    const names = configured.map(c => c.name).join(', ');
    const winnerName = configured[0].name;
    warnings.push(
      `[gemini-sdk] Multiple auth modes configured: ${names}.\n` +
      `Using ${winnerName} per documented precedence:\n` +
      `  ${AUTH_PRECEDENCE.join(' > ')}.\n` +
      `See docs/auth.md.`,
    );
  }

  return { mode: winner, envOverrides, warnings };
}
