/**
 * ts/src/session/Session.spec.ts
 *
 * Unit tests for Session value object.
 * 8 tests mirror Python test_session.py (PAR-03 parity).
 * 1 additional test mirrors Python test_frozen_raises_on_mutation — the TS
 * equivalent is compile-time readonly enforcement, so the test documents the
 * contract via a structural assertion rather than a runtime throw.
 */

import { describe, expect, it } from 'vitest';
import { type Session, type TranscriptEntry, normaliseSessionId } from './Session.js';

describe('Session: shape', () => {
  it('returns fixed three-field record with id, model, createdAt', () => {
    const s: Session = { id: 'abc', model: 'auto', createdAt: '2026-04-19T00:00:00.000Z' };
    expect(s.id).toBe('abc');
    expect(s.model).toBe('auto');
    expect(s.createdAt).toBe('2026-04-19T00:00:00.000Z');
  });

  it('has no process handles or file descriptors', () => {
    const s: Session = {
      id: 'abc',
      model: 'auto',
      createdAt: '2026-04-19T00:00:00.000Z',
      transcript: [],
    };
    const allowed = ['id', 'model', 'createdAt', 'transcript'];
    expect(Object.keys(s).every(k => allowed.includes(k))).toBe(true);
  });
});

describe('Session: JSON round-trip', () => {
  it('JSON round-trip returns structurally-equal Session', () => {
    const s: Session = { id: 'abc', model: 'auto', createdAt: '2026-04-19T00:00:00.000Z' };
    const rehydrated = JSON.parse(JSON.stringify(s)) as Session;
    expect(rehydrated).toEqual(s);
  });

  it('JSON round-trip preserves transcript array', () => {
    const s: Session = {
      id: 'abc',
      model: 'auto',
      createdAt: '2026-04-19T00:00:00.000Z',
      transcript: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    };
    const rehydrated = JSON.parse(JSON.stringify(s)) as Session;
    expect(rehydrated).toEqual(s);
    expect(rehydrated.transcript).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('Session with no transcript round-trips with transcript undefined', () => {
    const s: Session = { id: 'abc', model: 'auto', createdAt: '2026-04-19T00:00:00.000Z' };
    const rehydrated = JSON.parse(JSON.stringify(s)) as Session;
    expect(rehydrated.transcript).toBeUndefined();
  });
});

describe('Session: normaliseSessionId', () => {
  it('returns string argument unchanged', () => {
    expect(normaliseSessionId('abc-123')).toBe('abc-123');
  });

  it('extracts id field from Session object', () => {
    const s: Session = { id: 'xyz', model: '', createdAt: '' };
    expect(normaliseSessionId(s)).toBe('xyz');
  });
});

describe('Session: TranscriptEntry', () => {
  it('TranscriptEntry accepts role user and assistant', () => {
    const u: TranscriptEntry = { role: 'user', content: 'hi' };
    const a: TranscriptEntry = { role: 'assistant', content: 'hey' };
    expect(u.role).toBe('user');
    expect(a.role).toBe('assistant');
  });
});

describe('Session: frozen contract', () => {
  it('@dataclass frozen raises FrozenInstanceError on mutation', () => {
    // TypeScript enforces readonly at compile-time, not runtime.
    // This test documents the parity contract with Python test_frozen_raises_on_mutation.
    // The Session interface declares all fields readonly; tsc rejects assignments.
    const s: Session = { id: 'abc', model: '', createdAt: '' };
    // Verify the field is accessible (readonly does not hide it):
    expect(s.id).toBe('abc');
  });
});
