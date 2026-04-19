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
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'ADC',
];

/**
 * Inspects the given env dictionary, applies the documented precedence chain
 * `GEMINI_API_KEY > GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_API_KEY > ADC`,
 * and returns the resolved mode, envOverrides (empty today), and warnings.
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

  // envOverrides is intentionally empty: all resolved env vars already flow through
  // EnvBuilder's allowlist. resolveAuth's job is DIAGNOSIS, not MUTATION.
  // Reserved for future per-call auth override (Deferred Ideas).
  const envOverrides: Record<string, string> = {};

  return { mode: winner, envOverrides, warnings };
}
