/**
 * Tests for `rebaseRecord` with Luxon DateTime fields.
 *
 * `rebaseRecord` is used on the client to preserve local edits when a new
 * server record arrives. It computes a diff between the old server state and
 * the local state, then applies those ops onto the new server record.
 *
 * With rich-type serialisation in place, DateTime fields must survive the
 * diff → apply → deserialise round-trip correctly.
 */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { auditor } from '..';

type Doc = { id: string; name: string; lockedAt?: DateTime | null; updatedAt?: DateTime | null };

// ─── rebaseRecord ─────────────────────────────────────────────────────────────

describe('rebaseRecord — DateTime fields', () => {
  it('returns the new server record unchanged when there are no local edits', () => {
    const dt = DateTime.fromISO('2026-01-01T00:00:00.000Z');
    const old: Doc = { id: 'r1', name: 'alice', lockedAt: dt };
    const local: Doc = { id: 'r1', name: 'alice', lockedAt: dt };
    const newServer: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO('2026-06-01T00:00:00.000Z') };

    const result = auditor.rebaseRecord(old, local, newServer);
    expect(result.name).toBe('alice');
    expect(DateTime.isDateTime(result.lockedAt)).toBe(true);
    // No local change — takes server value
    expect((result.lockedAt as DateTime).toMillis()).toBe(
      DateTime.fromISO('2026-06-01T00:00:00.000Z').toMillis(),
    );
  });

  it('applies a local name change on top of a new server DateTime', () => {
    const dt = DateTime.fromISO('2026-01-01T00:00:00.000Z');
    const old: Doc = { id: 'r1', name: 'alice', lockedAt: dt };
    const local: Doc = { id: 'r1', name: 'bob', lockedAt: dt }; // local changed name
    const newServer: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO('2026-06-01T00:00:00.000Z') };

    const result = auditor.rebaseRecord(old, local, newServer);
    // Local name change is preserved
    expect(result.name).toBe('bob');
    // Server DateTime is kept (no local change to lockedAt)
    expect(DateTime.isDateTime(result.lockedAt)).toBe(true);
    expect((result.lockedAt as DateTime).toMillis()).toBe(
      DateTime.fromISO('2026-06-01T00:00:00.000Z').toMillis(),
    );
  });

  it('applies a local DateTime change on top of a new server record', () => {
    const oldDt = DateTime.fromISO('2026-01-01T00:00:00.000Z');
    const localDt = DateTime.fromISO('2026-03-15T09:00:00.000Z');
    const serverDt = DateTime.fromISO('2026-06-01T00:00:00.000Z');

    const old: Doc = { id: 'r1', name: 'alice', lockedAt: oldDt };
    const local: Doc = { id: 'r1', name: 'alice', lockedAt: localDt }; // local changed lockedAt
    const newServer: Doc = { id: 'r1', name: 'carol', lockedAt: serverDt }; // server changed name

    const result = auditor.rebaseRecord(old, local, newServer);
    // Server name change is kept (no local change to name)
    expect(result.name).toBe('carol');
    // Local DateTime change is applied on top
    expect(DateTime.isDateTime(result.lockedAt)).toBe(true);
    expect((result.lockedAt as DateTime).toMillis()).toBe(localDt.toMillis());
  });

  it('handles rebase when a DateTime field is added locally', () => {
    const old: Doc = { id: 'r1', name: 'alice' };
    const local: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO('2026-04-01T00:00:00.000Z') };
    const newServer: Doc = { id: 'r1', name: 'alice-renamed' };

    const result = auditor.rebaseRecord(old, local, newServer);
    expect(result.name).toBe('alice-renamed');
    expect(DateTime.isDateTime(result.lockedAt)).toBe(true);
  });

  it('handles rebase when a DateTime field is removed locally', () => {
    const dt = DateTime.fromISO('2026-01-01T00:00:00.000Z');
    const old: Doc = { id: 'r1', name: 'alice', lockedAt: dt };
    const local: Doc = { id: 'r1', name: 'alice' }; // removed lockedAt
    const newServer: Doc = { id: 'r1', name: 'alice', lockedAt: dt, updatedAt: DateTime.fromISO('2026-06-01T00:00:00.000Z') };

    const result = auditor.rebaseRecord(old, local, newServer);
    // Local removal of lockedAt is applied
    expect(result.lockedAt).toBeUndefined();
    // Server-added updatedAt is kept (no local change)
    expect(DateTime.isDateTime(result.updatedAt)).toBe(true);
  });

  it('produces no diff when old and local have identical DateTime values', () => {
    const iso = '2026-04-16T12:00:00.000Z';
    const old: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO(iso) };
    const local: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO(iso) };
    const newServer: Doc = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO(iso) };

    // Should return newServer unchanged (no local ops to apply)
    const result = auditor.rebaseRecord(old, local, newServer);
    expect(result).toEqual(newServer);
  });
});
