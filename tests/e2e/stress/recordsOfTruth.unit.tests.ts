import { describe, expect, it, beforeEach } from 'vitest';
import { auditor, AuditEntryType } from '../../../src/common';
import {
  clear,
  getEntryCount,
  getExpectedState,
  getHarnessMutationCount,
  getTruthAudits,
  recordHarnessDelete,
  recordHarnessUpsert,
  replayTruthOpsInOrder,
} from './recordsOfTruth';
import type { E2eTestRecord } from '../setup/types';

function row(id: string, clientId: string, testDate: number, value: string): E2eTestRecord {
  return { id, clientId, testDate, value };
}

describe('recordsOfTruth (audit-backed)', () => {
  beforeEach(() => {
    clear();
  });

  it('recordHarnessUpsert builds Created then Updated like the client', () => {
    const r1 = row('1', 'a', 10, 'v10');
    recordHarnessUpsert('a', undefined, r1);
    const prev = getExpectedState().get('1')!;
    const r2 = { ...prev, clientId: 'b', testDate: 20, value: 'v20' };
    recordHarnessUpsert('b', prev, r2);
    const m = getExpectedState();
    expect(m.size).toBe(1);
    expect(m.get('1')).toEqual(row('1', 'b', 20, 'v20'));
    const audits = getTruthAudits().get('1')!;
    expect(auditor.entriesOf(audits).length).toBe(2);
    expect(auditor.entriesOf(audits)[0]!.type).toBe(AuditEntryType.Created);
    expect(auditor.entriesOf(audits)[1]!.type).toBe(AuditEntryType.Updated);
  });

  it('partial-field update preserves untouched fields via recordDiff', () => {
    const r1 = row('1', 'a', 10, 'v10');
    recordHarnessUpsert('a', undefined, r1);
    const prev = getExpectedState().get('1')!;
    const r2 = { ...prev, clientId: 'b', testDate: 20, name: 'nm' };
    recordHarnessUpsert('b', prev, r2);
    expect(getExpectedState().get('1')).toEqual({
      id: '1',
      clientId: 'b',
      testDate: 20,
      value: 'v10',
      name: 'nm',
    });
  });

  it('getExpectedState matches replayTruthOpsInOrder', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    const prev = getExpectedState().get('1')!;
    recordHarnessUpsert('b', prev, { ...prev, clientId: 'b', testDate: 30, value: 'v30' });
    const prev2 = getExpectedState().get('1')!;
    recordHarnessUpsert('c', prev2, { ...prev2, clientId: 'c', testDate: 5, tags: ['x'] });
    expect(getExpectedState().get('1')).toEqual(replayTruthOpsInOrder().get('1'));
  });

  it('recordHarnessDelete removes live row from materialised map', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    recordHarnessDelete('1');
    expect(getExpectedState().size).toBe(0);
    expect(getTruthAudits().has('1')).toBe(true);
  });

  it('post-delete upsert appends Updated entry but does not resurrect (mirrors server merge)', () => {
    const r1 = row('1', 'a', 10, 'v10');
    recordHarnessUpsert('a', undefined, r1);
    recordHarnessDelete('1');
    const before = auditor.entriesOf(getTruthAudits().get('1')!).length;
    // A racing client with a stale view (prev = active record) updates the record. The
    // server's auditor.merge will accept this entry by ULID order; truth must do the same.
    recordHarnessUpsert('b', r1, { ...r1, clientId: 'b', testDate: 20, value: 'v20' });
    const entries = auditor.entriesOf(getTruthAudits().get('1')!);
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1]!.type).toBe(AuditEntryType.Updated);
    // Live row stays gone — only Restored entries can resurrect.
    expect(getExpectedState().size).toBe(0);
  });

  it('delete after delete appends a second Deleted entry (mirrors server merge)', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    recordHarnessDelete('1');
    const before = auditor.entriesOf(getTruthAudits().get('1')!).length;
    recordHarnessDelete('1');
    const entries = auditor.entriesOf(getTruthAudits().get('1')!);
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1]!.type).toBe(AuditEntryType.Deleted);
  });

  it('recordHarnessUpsert rejects clientId mismatch', () => {
    expect(() => recordHarnessUpsert('a', undefined, row('1', 'b', 1, 'x'))).toThrow(/clientId mismatch/);
  });

  it('recordHarnessDelete throws when id was never tracked', () => {
    expect(() => recordHarnessDelete('missing')).toThrow(/no truth audit/);
  });

  it('getHarnessMutationCount and getEntryCount', () => {
    expect(getHarnessMutationCount()).toBe(0);
    expect(getEntryCount()).toBe(0);
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'a'));
    expect(getHarnessMutationCount()).toBe(1);
    expect(getEntryCount()).toBe(1);
    const prev = getExpectedState().get('1')!;
    recordHarnessUpsert('a', prev, { ...prev, testDate: 11, value: 'b' });
    expect(getHarnessMutationCount()).toBe(2);
    expect(getEntryCount()).toBe(2);
    recordHarnessDelete('1');
    expect(getHarnessMutationCount()).toBe(3);
    expect(getEntryCount()).toBe(3);
  });
});
