/**
 * ts/src/session/Session.ts
 *
 * Session value object — immutable, identifier-based, NOT process-bound.
 * Plain Readonly<interface> — no class, no methods, no toJSON/fromJSON helpers.
 * JSON round-trip is free: JSON.parse(JSON.stringify(s)) returns an equivalent Session.
 *
 * Requirement: SES-03
 */

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface Session {
  /** Session id captured from the init event (SES-01). */
  readonly id: string;
  /** Model reported by the init event; retained for logging / UI / debugging. */
  readonly model: string;
  /** ISO 8601 timestamp of first init event (sourced from init.timestamp or wall clock). */
  readonly createdAt: string;
  /**
   * Prior turns when the transcript-prepend fallback is active (SES-04).
   * Undefined when GEMINI_SDK_TRANSCRIPT_FALLBACK is off (default).
   */
  readonly transcript?: ReadonlyArray<TranscriptEntry>;
}

/**
 * Normalise Session | string into a session id string.
 * Callers who stored an id (DB row, URL param) can pass a bare string;
 * callers who held a live Session pass the object.
 */
export function normaliseSessionId(session: Session | string): string {
  return typeof session === 'string' ? session : session.id;
}
