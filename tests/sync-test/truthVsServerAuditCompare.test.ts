import { describe, expect, it } from 'vitest';
import { auditor, AuditEntryType, type AuditOf } from '../../src/common';
import { toServerAuditOf } from '../../src/server/audit/toServerAuditOf';
import type { SyncTestRecord } from './types';
import {
  assertNoBranchedEntries,
  compareTruthVsServerAudits,
} from './truthVsServerAuditCompare';

function row(id: string, clientId: string, updatedAt: number, value: string): SyncTestRecord {
  return { id, clientId, updatedAt, value };
}

describe('truthVsServerAuditCompare', () => {
  it('assertNoBranchedEntries flags Branched', () => {
    const v = assertNoBranchedEntries('rec-1', [{ type: AuditEntryType.Branched }], 'truth');
    expect(v.length).toBe(1);
    expect(v[0]).toContain('Branched');
  });

  it('compareTruthVsServerAudits passes for Created when server doc is toServerAuditOf(truth)', () => {
    const r = row('1', 'a', 10, 'v');
    const tAudit = auditor.createAuditFrom(r);
    const truth = new Map([['1', tAudit]]);
    const server = new Map([['1', toServerAuditOf(tAudit, 'sync-test-user')]]);
    const rep = compareTruthVsServerAudits(truth, server);
    expect(rep.passed).toBe(true);
    expect(rep.branchedViolations).toEqual([]);
  });

  it('compareTruthVsServerAudits fails if truth contains Branched', () => {
    const r = row('1', 'a', 10, 'v');
    const base = auditor.createAuditFrom(r);
    const tAudit: AuditOf<SyncTestRecord> = {
      id: base.id,
      entries: [...base.entries, { type: AuditEntryType.Branched, id: auditor.generateUlid() }],
    };
    const truth = new Map([['1', tAudit]]);
    const server = new Map([['1', toServerAuditOf(auditor.createAuditFrom(r), 'u')]]);
    const rep = compareTruthVsServerAudits(truth, server);
    expect(rep.passed).toBe(false);
    expect(rep.branchedViolations.some(m => m.includes('truth'))).toBe(true);
  });

  it('compareTruthVsServerAudits fails on entry length mismatch', () => {
    const r = row('1', 'a', 10, 'v');
    const tAudit = auditor.createAuditFrom(r);
    const truth = new Map([['1', tAudit]]);
    const server = new Map([['1', toServerAuditOf(tAudit, 'u')]]);
    server.get('1')!.entries = server.get('1')!.entries.slice(0, -1);
    const rep = compareTruthVsServerAudits(truth, server);
    expect(rep.passed).toBe(false);
    expect(rep.lengthMismatches.length).toBe(1);
  });
});
