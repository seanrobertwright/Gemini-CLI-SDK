/**
 * _redactor.mjs — Secrets redaction module for capture-fixtures pipeline.
 *
 * Layer 1: Regex-based pattern replacement (8 patterns from RESEARCH.md §"Redaction Pipeline").
 * Layer 2: Structure-aware JSON-field redactor that deep-walks parsed JSON values.
 *
 * No third-party dependencies. Node ESM, stdlib only.
 */

// ---------------------------------------------------------------------------
// Layer 1: Regex redactors
// ---------------------------------------------------------------------------

/**
 * Array of 8 redaction rules applied in order by redact().
 * Order matters: the specific AIzaSy prefix must come before the broader AIza prefix.
 *
 * @type {Array<{pattern: RegExp, replacement: string, label: string}>}
 */
export const REDACTORS = [
  { pattern: /AIzaSy[A-Za-z0-9_-]{33}/g, replacement: 'AIzaSy<REDACTED_API_KEY>', label: 'gemini_api_key_specific' },
  { pattern: /AIza[A-Za-z0-9_-]{35}/g, replacement: 'AIza<REDACTED_API_KEY>', label: 'google_api_key_broad' },
  { pattern: /ya29\.[0-9A-Za-z_-]{20,}/g, replacement: 'ya29.<REDACTED_OAUTH_TOKEN>', label: 'oauth_access_token' },
  { pattern: /"session_id"\s*:\s*"[^"]+"/g, replacement: '"session_id":"<REDACTED_SESSION_ID>"', label: 'json_session_id' },
  { pattern: /C:\\\\Users\\\\[^\\"]+/gi, replacement: 'C:\\\\Users\\\\<REDACTED>', label: 'windows_user_profile' },
  { pattern: /\/home\/[^\/"\s]+/g, replacement: '/home/<REDACTED>', label: 'linux_home' },
  { pattern: /\/Users\/[^\/"\s]+/g, replacement: '/Users/<REDACTED>', label: 'macos_home' },
  { pattern: /\b[a-z][-a-z0-9]{4,28}[a-z0-9]\b(?=.*project)/gi, replacement: '<REDACTED_GCP_PROJECT>', label: 'gcp_project_id' }
];

/**
 * Apply all 8 REDACTORS in order to the given text string.
 * Returns the text unchanged if it is not a string.
 *
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const r of REDACTORS) {
    out = out.replace(r.pattern, r.replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer 2: Structure-aware JSON-field redactor
// ---------------------------------------------------------------------------

/**
 * Set of JSON key names whose values are always replaced with '<REDACTED>'
 * regardless of their string content.
 */
const SENSITIVE_KEYS = new Set([
  'session_id',
  'user_id',
  'account_id',
  'api_key',
  'access_token',
  'auth_token',
  'bearer_token'
]);

/**
 * Deep-walk a parsed JSON value (the result of JSON.parse) and redact secrets.
 *
 * Rules:
 * - Object: if a key is in SENSITIVE_KEYS, replace its value with '<REDACTED>';
 *   otherwise recurse into the value.
 * - Array: map-recurse each element.
 * - String: apply redact() to the string content.
 * - Number / boolean / null: return as-is.
 *
 * The input is never mutated — structuredClone is used for safety before walking.
 *
 * @param {unknown} value  A parsed JSON value (object, array, string, number, boolean, null)
 * @returns {unknown}      A new value with all secrets replaced
 */
export function redactJsonValue(value) {
  const clone = structuredClone(value);
  return _walk(clone);
}

/**
 * Internal recursive walker. Operates on the already-cloned tree.
 * @param {unknown} node
 * @returns {unknown}
 */
function _walk(node) {
  if (node === null || node === undefined) return node;

  if (typeof node === 'string') {
    return redact(node);
  }

  if (typeof node === 'number' || typeof node === 'boolean') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(_walk);
  }

  if (typeof node === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(node)) {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = '<REDACTED>';
      } else {
        result[key] = _walk(val);
      }
    }
    return result;
  }

  // Fallback: return as-is for any exotic type
  return node;
}

// ---------------------------------------------------------------------------
// Self-test (runs only when executed directly: node scripts/_redactor.mjs)
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const isMain = (process.argv[1] != null) && (
               import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
               process.argv[1].endsWith('_redactor.mjs'));

if (isMain) {
  // Test 1: specific API key pattern
  const t1 = redact('key is AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abc end');
  assert.ok(t1.includes('<REDACTED_API_KEY>'), 'regex 1 failed');

  // Test 2: session_id structural redaction
  const t2 = redact('{"session_id":"abc-123-xyz","other":"keep"}');
  assert.ok(t2.includes('<REDACTED_SESSION_ID>'), 'regex 4 failed');
  assert.ok(t2.includes('keep'), 'regex 4 over-matched');

  // Test 3: Windows user path (note double-escaping because the input is a JSON-escaped string)
  const t3 = redact('path is C:\\\\Users\\\\alice\\\\Documents');
  assert.ok(t3.includes('<REDACTED>'), 'regex 5 failed');

  // Test 4: structure-aware JSON walk
  const j4 = redactJsonValue({ session_id: 'xyz', nested: { user_id: '123', keep: 'ok' } });
  assert.equal(j4.session_id, '<REDACTED>');
  assert.equal(j4.nested.user_id, '<REDACTED>');
  assert.equal(j4.nested.keep, 'ok');

  // Test 5: array recursion
  const j5 = redactJsonValue([{ api_key: 'secret' }, 'plain string']);
  assert.equal(j5[0].api_key, '<REDACTED>');
  assert.equal(j5[1], 'plain string');

  // Test 6: numbers/null preserved
  const j6 = redactJsonValue({ count: 42, missing: null });
  assert.equal(j6.count, 42);
  assert.equal(j6.missing, null);

  console.log('_redactor self-test: OK');
}
