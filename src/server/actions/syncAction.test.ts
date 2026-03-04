import { describe, it, expect, vi } from 'vitest';
import { auditor } from '@anupheaus/common';
import type { AuditOf, Record } from '@anupheaus/common';
import { processIds, processUpdates, processAudits } from './syncAction';
import type { MXDBSyncId } from '../../common/internalModels';

// Arrays in this codebase use findById from @anupheaus/common
const toArrayWithFindById = <T extends Record>(arr: T[]): T[] & { findById(id: string): T | undefined } => {
  const a = arr as T[] & { findById(id: string): T | undefined };
  a.findById = (id: string) => a.find((r: Record) => r.id === id);
  return a;
};

const createLogger = () => ({
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
});

describe('syncAction helpers', () => {
  const userId = 'user-1';

  describe('processIds', () => {
    it('adds id to removeIds when existingAudit or existingRecord is missing', () => {
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();
      const ackIds = new Set<string>();
      const ids: MXDBSyncId[] = [{ id: 'missing', timestamp: 1000 }];
      const existingRecords = toArrayWithFindById<Record>([]);
      const existingAudits = toArrayWithFindById<AuditOf<Record>>([]);

      processIds({
        ids,
        existingRecords,
        existingAudits,
        removeIds,
        updateRecords,
        logger: createLogger(),
        collectionName: 'test',
        ackIds,
      });

      expect(removeIds.has('missing')).toBe(true);
      expect(updateRecords.size).toBe(0);
      expect(ackIds.size).toBe(0);
    });

    it('adds existingRecord to updateRecords when server audit is newer than client timestamp', () => {
      const record = { id: 'r1', name: 'v2' };
      const audit = auditor.createAuditFrom(record as Record, userId);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();
      const ackIds = new Set<string>();
      const ids: MXDBSyncId[] = [{ id: 'r1', timestamp: 100 }]; // old client timestamp
      const existingRecords = toArrayWithFindById<Record>([record as Record]);
      const existingAudits = toArrayWithFindById<AuditOf<Record>>([audit]);

      processIds({
        ids,
        existingRecords,
        existingAudits,
        removeIds,
        updateRecords,
        logger: createLogger(),
        collectionName: 'test',
        ackIds,
      });

      expect(updateRecords.get('r1')).toEqual(record);
      expect(removeIds.size).toBe(0);
      expect(ackIds.size).toBe(0);
    });

    it('adds id to ackIds when client audit is newer or same as server', () => {
      const record = { id: 'r1', name: 'v1' };
      const audit = auditor.createAuditFrom(record as Record, userId);
      const lastUpdated = auditor.lastUpdated(audit);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();
      const ackIds = new Set<string>();
      const ids: MXDBSyncId[] = [{ id: 'r1', timestamp: lastUpdated! + 1000 }]; // client thinks it's newer
      const existingRecords = toArrayWithFindById<Record>([record as Record]);
      const existingAudits = toArrayWithFindById<AuditOf<Record>>([audit]);

      processIds({
        ids,
        existingRecords,
        existingAudits,
        removeIds,
        updateRecords,
        logger: createLogger(),
        collectionName: 'test',
        ackIds,
      });

      expect(ackIds.has('r1')).toBe(true);
      expect(updateRecords.size).toBe(0);
      expect(removeIds.size).toBe(0);
    });
  });

  describe('processUpdates', () => {
    it('creates new audit from branch when no existing audit', () => {
      const record = { id: 'r1', name: 'new' };
      const branchAudit = auditor.createAuditFrom(record as Record, userId);
      const updateAudits = new Map<string, AuditOf<Record>>();
      const ackIds = new Set<string>();
      const existingAudits = toArrayWithFindById<AuditOf<Record>>([]);

      processUpdates({
        audits: [branchAudit],
        existingAudits,
        logger: createLogger(),
        collectionName: 'test',
        updateAudits,
        ackIds,
        userId,
      });

      expect(updateAudits.has('r1')).toBe(true);
      expect(updateAudits.get('r1')).toBeDefined();
      expect(ackIds.size).toBe(0);
    });

    it('merges client audit with existing; updates or acks depending on merged date', () => {
      const record1 = { id: 'r1', name: 'v1' };
      const existingAudit = auditor.createAuditFrom(record1 as Record, userId);
      const record2 = { id: 'r1', name: 'v2' };
      const clientAudit = auditor.updateAuditWith(record2 as Record, existingAudit, userId);
      const updateAudits = new Map<string, AuditOf<Record>>();
      const ackIds = new Set<string>();
      const existingAudits = toArrayWithFindById<AuditOf<Record>>([existingAudit]);

      processUpdates({
        audits: [clientAudit],
        existingAudits,
        logger: createLogger(),
        collectionName: 'test',
        updateAudits,
        ackIds,
        userId,
      });

      // Merged audit is either newer (updateAudits) or same date (ackIds)
      expect(updateAudits.has('r1') || ackIds.has('r1')).toBe(true);
    });
  });

  describe('processAudits', () => {
    it('adds to removeIds when createRecordFrom returns null (deleted record)', () => {
      const record = { id: 'r1', name: 'x' };
      const audit = auditor.createAuditFrom(record as Record, userId);
      const deletedAudit = auditor.delete(audit, userId);
      const audits = new Map<string, AuditOf<Record>>([['r1', deletedAudit]]);
      const existingRecords = toArrayWithFindById<Record>([]);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();

      processAudits({
        audits,
        existingRecords,
        removeIds,
        updateRecords,
      });

      const newRecord = auditor.createRecordFrom(deletedAudit);
      if (newRecord == null) {
        expect(removeIds.has('r1')).toBe(true);
      }
      expect(updateRecords.size).toBeLessThanOrEqual(1);
    });

    it('adds to updateRecords when record does not exist', () => {
      const record = { id: 'r1', name: 'new' };
      const audit = auditor.createAuditFrom(record as Record, userId);
      const audits = new Map<string, AuditOf<Record>>([['r1', audit]]);
      const existingRecords = toArrayWithFindById<Record>([]);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();

      processAudits({
        audits,
        existingRecords,
        removeIds,
        updateRecords,
      });

      expect(updateRecords.get('r1')).toBeDefined();
      expect(updateRecords.get('r1')).toMatchObject({ id: 'r1', name: 'new' });
    });

    it('adds to updateRecords when record exists but is different from audit-derived record', () => {
      const existingRecord = { id: 'r1', name: 'old' };
      const newRecord = { id: 'r1', name: 'new' };
      const audit = auditor.createAuditFrom(newRecord as Record, userId);
      const audits = new Map<string, AuditOf<Record>>([['r1', audit]]);
      const existingRecords = toArrayWithFindById<Record>([existingRecord as Record]);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();

      processAudits({
        audits,
        existingRecords,
        removeIds,
        updateRecords,
      });

      expect(updateRecords.get('r1')).toBeDefined();
      expect(updateRecords.get('r1')).toMatchObject({ id: 'r1', name: 'new' });
    });

    it('does not add to updateRecords when existing record equals audit-derived record', () => {
      const record = { id: 'r1', name: 'same' };
      const audit = auditor.createAuditFrom(record as Record, userId);
      const audits = new Map<string, AuditOf<Record>>([['r1', audit]]);
      const existingRecords = toArrayWithFindById<Record>([record as Record]);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();

      processAudits({
        audits,
        existingRecords,
        removeIds,
        updateRecords,
      });

      expect(updateRecords.size).toBe(0);
    });
  });
});
