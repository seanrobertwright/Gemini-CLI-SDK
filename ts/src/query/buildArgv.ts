/**
 * ts/src/query/buildArgv.ts
 *
 * Pure function that maps QueryOptions to a string[] argv for gemini-cli.
 *
 * Session branches (Phase 7):
 *   - No session              → no --resume flag (fresh session) — MDL-03 preserved.
 *   - session + no fallback   → ['--resume', <id>] inserted BEFORE '-p' (primary path, SES-02).
 *   - session + fallback env  → prompt is PREPENDED with transcript, --resume OMITTED (SES-04).
 *
 * Fallback activation: process.env check (see code below) — '1' activates.
 * AND options.session is a Session object (not a bare string) AND .transcript is non-empty.
 * Any other combination → primary path.
 */

import type { QueryOptions } from './types.js';
import type { Session, TranscriptEntry } from '../session/index.js';
import { normaliseSessionId } from '../session/index.js';

/**
 * Deterministic transcript prepend format.
 * Example output for [{role:'user',content:'hi'},{role:'assistant',content:'hello'}] + prompt 'next':
 *   "User: hi\nAssistant: hello\n\nUser: next"
 */
function formatTranscriptPrompt(
  transcript: ReadonlyArray<TranscriptEntry>,
  newPrompt: string,
): string {
  const priorLines = transcript
    .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n');
  return `${priorLines}\n\nUser: ${newPrompt}`;
}

export function buildArgv(options: QueryOptions): string[] {
  // Determine effective prompt (may be transcript-prepended in SES-04 fallback)
  let effectivePrompt = options.prompt;
  let resumeFlagPair: string[] = [];

  if (options.session) {
    const id = normaliseSessionId(options.session);
    const fallbackActive = process.env['GEMINI_SDK_TRANSCRIPT_FALLBACK'] === '1';
    const sessionObj = typeof options.session === 'string' ? undefined : options.session as Session;
    const hasTranscript = !!(sessionObj?.transcript && sessionObj.transcript.length > 0);

    if (fallbackActive && hasTranscript) {
      // SES-04 fallback: transcript-prepend; no --resume flag
      effectivePrompt = formatTranscriptPrompt(sessionObj!.transcript!, options.prompt);
    } else {
      // SES-02 primary path: --resume <id> before -p
      resumeFlagPair = ['--resume', id];
    }
  }

  const argv: string[] = [
    '--output-format', 'stream-json',
    ...resumeFlagPair,
    '-p', effectivePrompt,
  ];

  // MDL-03: omit --model when undefined or 'auto'
  if (options.model !== undefined && options.model !== 'auto') {
    argv.push('--model', options.model as string);
  }

  // CWD-02: one --include-directories flag per directory
  if (options.additionalDirectories?.length) {
    for (const dir of options.additionalDirectories) {
      argv.push('--include-directories', dir);
    }
  }

  return argv;
}
