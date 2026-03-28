import { describe, it, expect } from 'vitest';
import { auditor, AuditEntryType } from '../../common';
import type { AuditOf } from '../../common';
import type { Record } from '@anupheaus/common';
import { ulid } from 'ulidx';

interface HashFixture extends Record {
  id: string;
  value: number;
}

// These tests cover the in-repo auditor behaviour used by syncAction's processUpdates logic.
// The processUpdates function itself is not exported; tests verify the auditor contracts it relies on.

describe('syncAction — auditor contracts', () => {
  describe('auditor.merge', () => {
    it('returns client audit when no server audit exists', () => {
      const record = { id: 'r1', name: 'new' } as Record;
      const clientAudit = auditor.createAuditFrom(record);
      const merged = auditor.merge(clientAudit, clientAudit);
      expect(merged.id).toBe('r1');
      expect(merged.entries.length).toBeGreaterThan(0);
    });

    it('merges client and server audits and deduplicates entries', () => {
      const record1 = { id: 'r1', name: 'v1' } as Record;
      const serverAudit = auditor.createAuditFrom(record1);
      const record2 = { id: 'r1', name: 'v2' } as Record;
      const clientAudit = auditor.updateAuditWith(record2, serverAudit);
      const merged = auditor.merge(serverAudit, clientAudit);
      expect(merged.id).toBe('r1');
      expect(merged.entries.length).toBe(clientAudit.entries.length);
    });

    it('merges pending-only client entries when server holds full audit (C2S shape)', () => {
      const record1 = { id: 'r1', name: 'serverSeed' } as Record;
      const serverAudit = auditor.createAuditFrom(record1);
      const record2 = { id: 'r1', name: 'fromPending' } as Record;
      const fullClient = auditor.updateAuditWith(record2, auditor.createAuditFrom(record1));
      const pendingOnly: AuditOf<Record> = {
        id: 'r1',
        entries: fullClient.entries.filter(e => e.type !== AuditEntryType.Created),
      };
      expect(auditor.isAudit(pendingOnly, true)).toBe(false);

      const merged = auditor.merge(serverAudit, pendingOnly);
      const materialised = auditor.createRecordFrom(merged);
      expect(materialised?.name).toBe('fromPending');
    });
  });

  describe('auditor.createRecordFrom', () => {
    it('materialises the record from audit entries', () => {
      const record = { id: 'r1', name: 'hello' } as Record;
      const audit = auditor.createAuditFrom(record);
      const materialised = auditor.createRecordFrom(audit);
      expect(materialised).toMatchObject({ id: 'r1', name: 'hello' });
    });

    it('returns undefined for deleted records', () => {
      const record = { id: 'r1', name: 'x' } as Record;
      const audit = auditor.createAuditFrom(record);
      const deletedAudit = auditor.delete(audit);
      const materialised = auditor.createRecordFrom(deletedAudit);
      expect(materialised).toBeUndefined();
    });
  });

  describe('auditor.hasPendingChanges', () => {
    it('returns true when audit has local changes beyond the branch', () => {
      const record = { id: 'r1', name: 'v1' } as Record;
      const audit = auditor.createAuditFrom(record);
      expect(auditor.hasPendingChanges(audit)).toBe(true);
    });

    it('returns false for a lean branch-only audit', () => {
      const branchAudit = auditor.createBranchFrom('r1', ulid());
      expect(auditor.hasPendingChanges(branchAudit)).toBe(false);
    });
  });

  describe('auditor.collapseToAnchor', () => {
    it('collapses audit to a single branch entry', () => {
      const record = { id: 'r1', name: 'v1' } as Record;
      const audit: AuditOf<Record> = auditor.createAuditFrom(record);
      const anchorUlid = ulid();
      const collapsed = auditor.collapseToAnchor(audit, anchorUlid);
      expect(collapsed.entries.length).toBe(1);
      expect(auditor.hasPendingChanges(collapsed)).toBe(false);
      expect(auditor.getBranchUlid(collapsed)).toBe(anchorUlid);
    });
  });

  describe('auditor.hashRecord', () => {
    it('produces a 16-char hex hash', async () => {
      const record: HashFixture = { id: 'r1', value: 42 };
      const hash = await auditor.hashRecord(record);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces the same hash for identical records', async () => {
      const r1: HashFixture = { id: 'r1', value: 42 };
      const r2: HashFixture = { id: 'r1', value: 42 };
      const [h1, h2] = await Promise.all([auditor.hashRecord(r1), auditor.hashRecord(r2)]);
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different records', async () => {
      const r1: HashFixture = { id: 'r1', value: 42 };
      const r2: HashFixture = { id: 'r1', value: 43 };
      const [h1, h2] = await Promise.all([auditor.hashRecord(r1), auditor.hashRecord(r2)]);
      expect(h1).not.toBe(h2);
    });
  });
});
