/**
 * ts/src/errors/ErrorMapper.ts
 *
 * Hand-written error classifier for Phase 5 taxonomy.
 * Maps raw stream-json error events and exit codes to typed GeminiError subclasses.
 *
 * ERR-04: Two-path mapping (fromStreamEvent + fromExit)
 * ERR-05: Both paths produce the same class for the same condition
 * ERR-06: query() uses fromExit when stream ends without a terminal result chunk
 */

import {
  GeminiError,
  RateLimitError,
  AuthError,
  NotConfigured,
  Forbidden403,
  Expired,
  ToSViolation,
  ModelAccessError,
  InvalidPromptError,
  ProcessCrashError,
} from './errors.js';
import type { RawEvent } from '../parser/types.js';

export interface StreamErrorEvent {
  type: 'error';
  error: { code?: number; status?: string; message?: string; retryAfter?: number };
}

/** Classify an AuthError subtype by message content. */
function classifyAuthSubtype(message: string): AuthError {
  if (/no API key|not configured|GEMINI_API_KEY/i.test(message)) return new NotConfigured(message);
  if (/403|PERMISSION_DENIED|Forbidden/i.test(message)) return new Forbidden403(message);
  if (/token expired|oauth.*expired/i.test(message)) return new Expired(message);
  if (/Terms of Service|ToS|account suspended/i.test(message)) return new ToSViolation(message);
  return new AuthError(message);
}

export class ErrorMapper {
  /**
   * Stream-json path (ERR-04, ERR-05).
   * Called from dispatch() for {"type":"error"} events.
   */
  static fromStreamEvent(event: StreamErrorEvent | Record<string, unknown>): GeminiError {
    const errObj = (event as StreamErrorEvent).error ?? {};
    const { code, status, message, retryAfter } = errObj as {
      code?: number;
      status?: string;
      message?: string;
      retryAfter?: number;
    };
    const msg = message ?? '';
    if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
      // retryAfter interpretation: if present, treat as seconds per RESEARCH.md §"Pattern 4";
      // adjust post-capture if real gemini-cli emits ms (see 05-01-SUMMARY.md Open Q #3).
      const retryAfterMs = typeof retryAfter === 'number' ? retryAfter * 1000 : undefined;
      return new RateLimitError(msg || 'Rate limit exceeded', { retryAfterMs });
    }
    if (code === 401 || status === 'UNAUTHENTICATED') return classifyAuthSubtype(msg);
    if (code === 403 || status === 'PERMISSION_DENIED') return new Forbidden403(msg);
    if (code === 400 || status === 'INVALID_ARGUMENT') return new InvalidPromptError(msg);
    if (code === 404 || status === 'NOT_FOUND') return new ModelAccessError(msg);
    return new GeminiError(msg || 'Unknown error from stream event');
  }

  /**
   * Exit-code + stderr path (ERR-04, ERR-05, ERR-06).
   * Called from query() on non-zero exit OR premature EOF without a terminal result chunk.
   */
  static fromExit(options: {
    exitCode: number;
    stderr: string;
    lastEvents?: RawEvent[];
  }): GeminiError {
    const { exitCode, stderr } = options;
    const tail = stderr ?? '';
    const snippet = tail.slice(-200);
    if (/quota|RESOURCE_EXHAUSTED|429|Too Many Requests/i.test(tail)) {
      return new RateLimitError(snippet || 'Rate limit exceeded');
    }
    if (/API key not valid|UNAUTHENTICATED|401/i.test(tail)) {
      // Use generic AuthError for exit path — without clean message we cannot reliably
      // distinguish auth subtypes from mixed stderr tail (see 05-01-SUMMARY.md decision).
      return new AuthError(snippet || 'Authentication failure');
    }
    if (/403|PERMISSION_DENIED|Forbidden/i.test(tail)) return new Forbidden403(snippet);
    if (/400|INVALID_ARGUMENT|invalid.*prompt|content policy|safety/i.test(tail)) {
      return new InvalidPromptError(snippet);
    }
    if (/404|NOT_FOUND|model.*not found|deprecated|not available/i.test(tail)) {
      return new ModelAccessError(snippet);
    }
    if (exitCode !== 0 && [1, 2, 137, 143].includes(exitCode)) {
      return new ProcessCrashError(
        `Process exited with code ${exitCode}. Stderr tail: ${snippet}`,
      );
    }
    return new GeminiError(
      `Process exited with code ${exitCode}. Stderr tail: ${snippet || '(empty)'}`,
    );
  }
}
