/**
 * Tests that verify the auditor correctly serialises/deserialises rich types
 * (Luxon DateTime, JS Date, Error) when creating audit ops and materialising
 * records.
 *
 * Key invariants:
 *  - Op values are always JSON-safe (ISO strings, not DateTime objects).
 *  - Two DateTime objects representing the same instant produce no diff ops.
 *  - After materialisation via createRecordFrom, rich types are restored to
 *    their in-memory forms (DateTime, not ISO strings).
 *  - Functions are not record data — they are lost through JSON serialisation
 *    and should not cause crashes.
 */
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Record as MXDBRecord } from '@anupheaus/common';
import { auditor, AuditEntryType, OperationType } from '..';
import { recordDiff } from './diff';

type RichRecord = MXDBRecord & {
  lockedAt?: DateTime | null;
  createdAt?: DateTime | null;
  scheduledFor?: DateTime | null;
  nested?: { updatedAt?: DateTime | null };
  tags?: Array<{ id: string; expiresAt?: DateTime | null }>;
};

function makeRichRecord(overrides: Partial<RichRecord> = {}): RichRecord {
  return { id: 'r1', ...overrides };
}

// ─── DateTime in recordDiff ────────────────────────────────────────────────────

describe('recordDiff — Luxon DateTime fields', () => {
  it('produces no ops for identical DateTime references', () => {
    const dt = DateTime.fromISO('2026-04-16T12:00:00.000Z');
    const a = makeRichRecord({ lockedAt: dt });
    const b = makeRichRecord({ lockedAt: dt });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('produces no ops for two DateTime objects with the same instant', () => {
    const iso = '2026-04-16T12:00:00.000Z';
    const a = makeRichRecord({ lockedAt: DateTime.fromISO(iso) });
    const b = makeRichRecord({ lockedAt: DateTime.fromISO(iso) });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('emits a Replace op with an ISO string value when DateTime changes', () => {
    const a = makeRichRecord({ lockedAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') });
    const b = makeRichRecord({ lockedAt: DateTime.fromISO('2026-06-15T09:30:00.000Z') });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Replace);
    expect(ops[0].path).toBe('lockedAt');
    // Op value must be a JSON-safe ISO string, not a DateTime object
    expect(typeof ops[0].value).toBe('string');
    // Verify it represents the same instant (zone may vary by machine locale)
    expect(DateTime.fromISO(ops[0].value as string).toMillis()).toBe(
      DateTime.fromISO('2026-06-15T09:30:00.000Z').toMillis(),
    );
  });

  it('emits an Add op with an ISO string value when DateTime field is added', () => {
    const a = makeRichRecord({});
    const b = makeRichRecord({ lockedAt: DateTime.fromISO('2026-04-16T12:00:00.000Z') });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Add);
    expect(ops[0].path).toBe('lockedAt');
    expect(typeof ops[0].value).toBe('string');
    expect(DateTime.fromISO(ops[0].value as string).toMillis()).toBe(
      DateTime.fromISO('2026-04-16T12:00:00.000Z').toMillis(),
    );
  });

  it('emits a Remove op when DateTime field is removed', () => {
    const a = makeRichRecord({ lockedAt: DateTime.fromISO('2026-04-16T12:00:00.000Z') });
    const b = makeRichRecord({});
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Remove, path: 'lockedAt' });
  });

  it('emits a Replace op when DateTime changes to null', () => {
    const a = makeRichRecord({ lockedAt: DateTime.fromISO('2026-04-16T12:00:00.000Z') });
    const b = makeRichRecord({ lockedAt: null });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'lockedAt', value: null });
  });

  it('does not traverse DateTime internals (no ops like lockedAt.c.second)', () => {
    const a = makeRichRecord({ lockedAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') });
    const b = makeRichRecord({ lockedAt: DateTime.fromISO('2026-06-15T09:30:45.500Z') });
    const ops = recordDiff(a, b);
    const traversalPaths = ops.filter(o => o.path.startsWith('lockedAt.'));
    expect(traversalPaths).toEqual([]);
    expect(ops).toHaveLength(1);
  });

  it('handles nested DateTime fields', () => {
    const a = makeRichRecord({ nested: { updatedAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') } });
    const b = makeRichRecord({ nested: { updatedAt: DateTime.fromISO('2026-06-01T00:00:00.000Z') } });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Replace);
    expect(ops[0].path).toBe('nested.updatedAt');
    expect(typeof ops[0].value).toBe('string');
  });

  it('handles DateTime in id-bearing array elements', () => {
    const a = makeRichRecord({ tags: [{ id: 't1', expiresAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') }] });
    const b = makeRichRecord({ tags: [{ id: 't1', expiresAt: DateTime.fromISO('2026-12-31T23:59:59.999Z') }] });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Replace);
    expect(ops[0].path).toBe('tags.[id:t1].expiresAt');
    expect(typeof ops[0].value).toBe('string');
  });

  it('produces no ops when multiple DateTime fields are identical across records', () => {
    const iso = '2026-04-16T12:00:00.000Z';
    const a = makeRichRecord({
      lockedAt: DateTime.fromISO(iso),
      createdAt: DateTime.fromISO(iso),
      scheduledFor: DateTime.fromISO(iso),
    });
    const b = makeRichRecord({
      lockedAt: DateTime.fromISO(iso),
      createdAt: DateTime.fromISO(iso),
      scheduledFor: DateTime.fromISO(iso),
    });
    expect(recordDiff(a, b)).toEqual([]);
  });
});

// ─── DateTime round-trip via auditor (create → update → materialise) ──────────

describe('auditor — DateTime round-trip through create / update / materialise', () => {
  it('createRecordFrom returns DateTime objects (not ISO strings) after creation', () => {
    const dt = DateTime.fromISO('2026-04-16T12:00:00.000Z');
    const record = makeRichRecord({ lockedAt: dt });
    const audit = auditor.createAuditFrom(record);
    const materialised = auditor.createRecordFrom(audit);
    expect(materialised).not.toBeNull();
    expect(DateTime.isDateTime(materialised?.lockedAt)).toBe(true);
  });

  it('createRecordFrom returns an updated DateTime (not ISO string) after update', () => {
    const original = makeRichRecord({ lockedAt: DateTime.fromISO('2026-01-01T00:00:00.000Z') });
    const audit1 = auditor.createAuditFrom(original);

    const updated = makeRichRecord({ lockedAt: DateTime.fromISO('2026-06-15T09:30:00.000Z') });
    const audit2 = auditor.updateAuditWith(updated, audit1, original);

    expect(audit2.entries).toHaveLength(2);
    expect(audit2.entries[1].type).toBe(AuditEntryType.Updated);

    const materialised = auditor.createRecordFrom(audit2, original);
    expect(DateTime.isDateTime(materialised?.lockedAt)).toBe(true);
    expect((materialised?.lockedAt as DateTime).toMillis()).toBe(
      DateTime.fromISO('2026-06-15T09:30:00.000Z').toMillis(),
    );
  });

  it('updateAuditWith produces no ops when DateTime is unchanged', () => {
    const iso = '2026-04-16T12:00:00.000Z';
    const record = makeRichRecord({ lockedAt: DateTime.fromISO(iso) });
    const audit1 = auditor.createAuditFrom(record);
    const audit2 = auditor.updateAuditWith(makeRichRecord({ lockedAt: DateTime.fromISO(iso) }), audit1, record);
    // No Updated entry should be appended — no change detected
    expect(audit2.entries).toHaveLength(1);
  });

  it('materialised record preserves non-DateTime fields alongside DateTime fields', () => {
    const record = { id: 'r1', name: 'alice', lockedAt: DateTime.fromISO('2026-04-16T12:00:00.000Z') };
    const audit = auditor.createAuditFrom(record);
    const materialised = auditor.createRecordFrom(audit);
    expect(materialised?.name).toBe('alice');
    expect(DateTime.isDateTime(materialised?.lockedAt)).toBe(true);
  });

  it('null DateTime field round-trips correctly', () => {
    const record = makeRichRecord({ lockedAt: null });
    const audit = auditor.createAuditFrom(record);
    const materialised = auditor.createRecordFrom(audit);
    expect(materialised?.lockedAt).toBeNull();
  });
});

// ─── JS Date objects ──────────────────────────────────────────────────────────

describe('recordDiff — JS Date fields', () => {
  it('produces no ops for identical JS Date references', () => {
    const d = new Date('2026-04-16T12:00:00.000Z');
    const a = { id: 'r1', createdAt: d } as MXDBRecord & { createdAt: Date };
    expect(recordDiff(a, a)).toEqual([]);
  });

  it('emits Replace with ISO string when JS Date changes', () => {
    const a = { id: 'r1', createdAt: new Date('2026-01-01T00:00:00.000Z') } as MXDBRecord & { createdAt: Date };
    const b = { id: 'r1', createdAt: new Date('2026-06-01T00:00:00.000Z') } as MXDBRecord & { createdAt: Date };
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Replace);
    expect(ops[0].path).toBe('createdAt');
    expect(typeof ops[0].value).toBe('string');
    expect(ops[0].value).toMatch(/2026-06-01/);
  });

  it('does not traverse JS Date internals', () => {
    const a = { id: 'r1', createdAt: new Date('2026-01-01') } as MXDBRecord & { createdAt: Date };
    const b = { id: 'r1', createdAt: new Date('2026-06-01') } as MXDBRecord & { createdAt: Date };
    const ops = recordDiff(a, b);
    const traversal = ops.filter(o => o.path.startsWith('createdAt.'));
    expect(traversal).toEqual([]);
  });
});

// ─── Functions in records (graceful degradation) ──────────────────────────────

describe('recordDiff — function fields', () => {
  it('does not throw when records contain function-valued fields', () => {
    const fn = () => 42;
    const a = { id: 'r1', compute: fn } as unknown as MXDBRecord;
    const b = { id: 'r1', compute: fn } as unknown as MXDBRecord;
    expect(() => recordDiff(a, b)).not.toThrow();
  });

  it('treats the same function reference as equal (no Replace op)', () => {
    const fn = () => 42;
    const a = { id: 'r1', compute: fn } as unknown as MXDBRecord;
    const b = { id: 'r1', compute: fn } as unknown as MXDBRecord;
    const ops = recordDiff(a, b);
    const replacedFn = ops.filter(o => o.path === 'compute' && o.type === OperationType.Replace);
    expect(replacedFn).toEqual([]);
  });
});
