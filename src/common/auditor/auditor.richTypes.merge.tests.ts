/**
 * Tests for merge + replay lifecycles involving Luxon DateTime fields.
 *
 * Covers:
 *  - Op values with nested DateTime objects in array elements (id-bearing and
 *    anonymous) round-trip through JSON storage correctly.
 *  - Multi-step create → update → merge → materialise restores DateTime objects.
 *  - contentHash stability for anonymous arrays whose elements contain DateTime
 *    fields (documents the current behaviour so regressions are caught).
 */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Record as MXDBRecord } from '@anupheaus/common';
import { auditor, AuditEntryType, OperationType, type AuditOf, type AuditUpdateEntry } from '..';
import { recordDiff } from './diff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EventRecord = MXDBRecord & {
  title: string;
  scheduledAt?: DateTime | null;
  tags?: Array<{ id: string; label: string; expiresAt?: DateTime | null }>;
  timestamps?: Array<{ value: DateTime }>;
};

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return { id: 'ev1', title: 'meeting', ...overrides };
}

// ─── Nested DateTime in id-bearing array element ops ─────────────────────────

describe('auditor — id-bearing array elements with nested DateTime', () => {
  it('Add op for a new id-bearing element with DateTime field stores ISO string', () => {
    const dt = DateTime.fromISO('2026-06-01T00:00:00.000Z');
    const a = makeEvent({ tags: [] });
    const b = makeEvent({ tags: [{ id: 't1', label: 'urgent', expiresAt: dt }] });
    const ops = recordDiff(a, b);

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Add);
    expect(ops[0].path).toBe('tags.[id:t1]');

    // The stored value must be JSON-safe (expiresAt as ISO string, not DateTime object)
    const storedValue = ops[0].value as { id: string; label: string; expiresAt: unknown };
    expect(typeof storedValue.expiresAt).toBe('string');
    expect(DateTime.fromISO(storedValue.expiresAt as string).toMillis()).toBe(dt.toMillis());
  });

  it('full round-trip: add element with DateTime → materialise → restore DateTime', () => {
    const dt = DateTime.fromISO('2026-06-01T09:00:00.000Z');
    const original = makeEvent({ tags: [] });
    const audit1 = auditor.createAuditFrom(original);

    const updated = makeEvent({ tags: [{ id: 't1', label: 'urgent', expiresAt: dt }] });
    const audit2 = auditor.updateAuditWith(updated, audit1, original);

    expect(audit2.entries).toHaveLength(2);

    const materialised = auditor.createRecordFrom(audit2, original) as EventRecord;
    expect(materialised?.tags).toHaveLength(1);
    expect(DateTime.isDateTime(materialised?.tags?.[0].expiresAt)).toBe(true);
    expect((materialised?.tags?.[0].expiresAt as DateTime).toMillis()).toBe(dt.toMillis());
  });

  it('update element with DateTime field in id-bearing array round-trips correctly', () => {
    const dt1 = DateTime.fromISO('2026-01-01T00:00:00.000Z');
    const dt2 = DateTime.fromISO('2026-12-31T23:59:59.000Z');

    const original = makeEvent({ tags: [{ id: 't1', label: 'urgent', expiresAt: dt1 }] });
    const audit1 = auditor.createAuditFrom(original);

    const updated = makeEvent({ tags: [{ id: 't1', label: 'urgent', expiresAt: dt2 }] });
    const audit2 = auditor.updateAuditWith(updated, audit1, original);

    const materialised = auditor.createRecordFrom(audit2, original) as EventRecord;
    expect(DateTime.isDateTime(materialised?.tags?.[0].expiresAt)).toBe(true);
    expect((materialised?.tags?.[0].expiresAt as DateTime).toMillis()).toBe(dt2.toMillis());
  });
});

// ─── Merge + replay lifecycle with DateTime fields ────────────────────────────

describe('auditor merge — DateTime fields survive merge + replay', () => {
  it('merged client batches replay correct DateTime values', () => {
    auditor.setClockDrift(0);

    const s0 = makeEvent({ scheduledAt: DateTime.fromISO('2026-01-01T09:00:00.000Z') });
    const s1 = makeEvent({ scheduledAt: DateTime.fromISO('2026-02-01T09:00:00.000Z') });
    const s2 = makeEvent({ scheduledAt: DateTime.fromISO('2026-03-01T09:00:00.000Z') });

    const ids = Array.from({ length: 3 }, () => auditor.generateUlid()).sort();

    const serverAudit: AuditOf<EventRecord> = {
      id: 'ev1',
      entries: [{ type: AuditEntryType.Created, id: ids[0], record: { ...s0 } }],
    };
    const update1: AuditUpdateEntry = {
      type: AuditEntryType.Updated,
      id: ids[1],
      ops: recordDiff(s0, s1),
    };
    const update2: AuditUpdateEntry = {
      type: AuditEntryType.Updated,
      id: ids[2],
      ops: recordDiff(s1, s2),
    };

    const batch1: AuditOf<EventRecord> = { id: 'ev1', entries: [update1] };
    const batch2: AuditOf<EventRecord> = { id: 'ev1', entries: [update2] };

    let merged = auditor.merge(serverAudit, batch1);
    merged = auditor.merge(merged, batch2);

    const materialised = auditor.createRecordFrom(merged) as EventRecord;
    expect(DateTime.isDateTime(materialised?.scheduledAt)).toBe(true);
    expect((materialised?.scheduledAt as DateTime).toMillis()).toBe(
      DateTime.fromISO('2026-03-01T09:00:00.000Z').toMillis(),
    );
  });

  it('interleaved client batches replay correct DateTime after out-of-order merge', () => {
    auditor.setClockDrift(0);

    const base = makeEvent({ scheduledAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') });
    let audit = auditor.createAuditFrom(base);

    const states: EventRecord[] = [base];
    for (let i = 1; i <= 4; i++) {
      const next = makeEvent({ scheduledAt: DateTime.fromISO(`2026-0${i + 1}-01T00:00:00.000Z`) });
      states.push(next);
      audit = auditor.updateAuditWith(next, audit, states[i - 1]);
    }

    // Simulate: server has Created + last entry; client batches hold middle entries
    const allEntries = [...audit.entries];
    const serverEntries = [allEntries[0], allEntries[allEntries.length - 1]];
    const clientBatch: AuditOf<EventRecord> = {
      id: 'ev1',
      entries: allEntries.slice(1, -1),
    };

    let server: AuditOf<EventRecord> = { id: 'ev1', entries: serverEntries };
    server = auditor.merge(server, clientBatch);

    const materialised = auditor.createRecordFrom(server) as EventRecord;
    expect(DateTime.isDateTime(materialised?.scheduledAt)).toBe(true);
    const expectedMs = DateTime.fromISO('2026-05-01T00:00:00.000Z').toMillis();
    expect((materialised?.scheduledAt as DateTime).toMillis()).toBe(expectedMs);
  });

  it('delete + restore preserves DateTime in restore snapshot', () => {
    const dt = DateTime.fromISO('2026-06-15T12:00:00.000Z');
    let audit = auditor.createAuditFrom(makeEvent({ scheduledAt: dt }));
    audit = auditor.delete(audit);

    const restored = makeEvent({ scheduledAt: DateTime.fromISO('2026-09-01T08:00:00.000Z') });
    audit = auditor.restoreTo(audit, restored);

    const materialised = auditor.createRecordFrom(audit) as EventRecord;
    expect(auditor.isDeleted(audit)).toBe(false);
    expect(DateTime.isDateTime(materialised?.scheduledAt)).toBe(true);
    expect((materialised?.scheduledAt as DateTime).toMillis()).toBe(
      DateTime.fromISO('2026-09-01T08:00:00.000Z').toMillis(),
    );
  });
});

// ─── Anonymous arrays with DateTime elements ──────────────────────────────────

describe('auditor — anonymous array elements with DateTime fields', () => {
  it('Add op for anonymous array element containing DateTime stores JSON-safe value', () => {
    const dt = DateTime.fromISO('2026-04-16T12:00:00.000Z');
    const a = makeEvent({ timestamps: [] });
    const b = makeEvent({ timestamps: [{ value: dt }] });
    const ops = recordDiff(a, b);

    expect(ops).toHaveLength(1);
    const stored = ops[0].value as { value: unknown };
    expect(typeof stored.value).toBe('string');
    expect(DateTime.fromISO(stored.value as string).toMillis()).toBe(dt.toMillis());
  });

  it('anonymous array element with DateTime round-trips via create + materialise', () => {
    const dt = DateTime.fromISO('2026-04-16T12:00:00.000Z');
    const record = makeEvent({ timestamps: [{ value: dt }] });
    const audit = auditor.createAuditFrom(record);

    const materialised = auditor.createRecordFrom(audit) as EventRecord;
    expect(materialised?.timestamps).toHaveLength(1);
    expect(DateTime.isDateTime(materialised?.timestamps?.[0].value)).toBe(true);
    expect((materialised?.timestamps?.[0].value as DateTime).toMillis()).toBe(dt.toMillis());
  });
});
