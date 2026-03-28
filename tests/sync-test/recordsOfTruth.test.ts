import { describe, expect, it, beforeEach } from 'vitest';
import { auditor, AuditEntryType } from '../../src/common';
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
import type { SyncTestRecord } from './types';

function row(id: string, clientId: string, updatedAt: number, value: string): SyncTestRecord {
  return { id, clientId, updatedAt, value };
}

describe('recordsOfTruth (audit-backed)', () => {
  beforeEach(() => {
    clear();
  });

  it('recordHarnessUpsert builds Created then Updated like the client', () => {
    const r1 = row('1', 'a', 10, 'v10');
    recordHarnessUpsert('a', undefined, r1);
    const prev = getExpectedState().get('1')!;
    const r2 = { ...prev, clientId: 'b', updatedAt: 20, value: 'v20' };
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
    const r2 = { ...prev, clientId: 'b', updatedAt: 20, name: 'nm' };
    recordHarnessUpsert('b', prev, r2);
    expect(getExpectedState().get('1')).toEqual({
      id: '1',
      clientId: 'b',
      updatedAt: 20,
      value: 'v10',
      name: 'nm',
    });
  });

  it('getExpectedState matches replayTruthOpsInOrder', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    const prev = getExpectedState().get('1')!;
    recordHarnessUpsert('b', prev, { ...prev, clientId: 'b', updatedAt: 30, value: 'v30' });
    const prev2 = getExpectedState().get('1')!;
    recordHarnessUpsert('c', prev2, { ...prev2, clientId: 'c', updatedAt: 5, tags: ['x'] });
    expect(getExpectedState().get('1')).toEqual(replayTruthOpsInOrder().get('1'));
  });

  it('recordHarnessDelete removes live row from materialised map', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    recordHarnessDelete('1');
    expect(getExpectedState().size).toBe(0);
    expect(getTruthAudits().has('1')).toBe(true);
  });

  it('upsert after delete appends Restored (prev undefined)', () => {
    recordHarnessUpsert('a', undefined, row('1', 'a', 10, 'v10'));
    recordHarnessDelete('1');
    const restored = row('1', 'b', 20, 'v20');
    recordHarnessUpsert('b', undefined, restored);
    const m = getExpectedState();
    expect(m.size).toBe(1);
    expect(m.get('1')).toEqual(restored);
    const entries = auditor.entriesOf(getTruthAudits().get('1')!);
    expect(entries.some(e => e.type === AuditEntryType.Deleted)).toBe(true);
    expect(entries.some(e => e.type === AuditEntryType.Restored)).toBe(true);
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
    recordHarnessUpsert('a', prev, { ...prev, updatedAt: 11, value: 'b' });
    expect(getHarnessMutationCount()).toBe(2);
    expect(getEntryCount()).toBe(2);
    recordHarnessDelete('1');
    expect(getHarnessMutationCount()).toBe(3);
    expect(getEntryCount()).toBe(3);
  });
});
