/**
 * Allowlist of environment variable keys that are safe to pass to the gemini-cli subprocess.
 * This is intentionally opaque and not configurable — use the `overrides` parameter
 * to add additional variables.
 */
const ALLOWED_KEYS = new Set([
  // System essentials
  'PATH', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'SystemDrive', 'COMSPEC',
  'HOMEDRIVE', 'HOMEPATH', 'LOGNAME', 'SHELL', 'TERM',
  // Gemini auth (passed through to gemini-cli)
  'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
  // Gemini config
  'GEMINI_CONFIG_DIR', 'GEMINI_SYSTEM_MD', 'GEMINI_BIN_PATH',
  // UTF-8 forcing (FDN-04)
  'PYTHONUTF8',
]);

/**
 * Builds a clean subprocess environment dictionary by filtering `process.env`
 * through an allowlist and merging caller-supplied overrides.
 *
 * @param overrides - Additional env vars to merge on top (these win over process.env)
 * @returns Clean env dict safe to pass to child_process.spawn
 */
export function buildEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy allowlisted keys from process.env
  for (const key of ALLOWED_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Merge overrides on top (overrides win)
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      env[key] = value;
    }
  }

  return env;
}
