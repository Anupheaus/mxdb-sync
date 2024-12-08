import { InternalError, type Record } from '@anupheaus/common';
import { diff } from 'just-diff';
import type { MXDBSyncOperationRecord, MXDBSyncRecord, MXDBSyncRecordOriginal, MXDBSyncRequestRecord, MXDBSyncServerRecord } from '../../common/internalModels';
import type { DiffOps } from 'just-diff-apply';
import { diffApply } from 'just-diff-apply';

function applyOpsToRecord<RecordType extends Record>(record: RecordType, ops: MXDBSyncOperationRecord[]): RecordType | undefined {
  if (ops.last()?.op === 'delete') return;
  const usefulOps = ops.mapWithoutNull(op => (op.op === 'delete' || op.op === 'restore') ? undefined : op as DiffOps[number]);
  if (usefulOps.length === 0) return record;
  try {
    return diffApply(record, usefulOps);
  } catch (error) {
    throw new InternalError('Failed to apply operations to record', { meta: { record, ops: usefulOps, error } });
  }
}


// eslint-disable-next-line max-len
function generateSyncRecordsFrom<RecordType extends Record>(existingSyncRecords: MXDBSyncServerRecord<RecordType>[], from: RecordType[], to: RecordType[], syncTime: number, userId: string): MXDBSyncServerRecord<RecordType>[] {
  return to.map((record): MXDBSyncServerRecord<RecordType> => {
    const existingSyncRecord = existingSyncRecords.findById(record.id);
    const existingRecord = from.findById(record.id);
    if (existingSyncRecord != null && existingRecord != null) {
      const operations = diff(existingRecord, record);
      if (operations.length === 0) return existingSyncRecord;
      return {
        ...existingSyncRecord,
        audit: {
          ...existingSyncRecord.audit,
          [syncTime]: {
            userId,
            operations: diff(existingRecord, record)
          },
        }
      };
    } else {
      return {
        id: record.id,
        original: { userId, value: record, timestamp: syncTime },
        audit: {}
      };
    }
  });
}

function getOps<RecordType extends Record>(record: MXDBSyncRecord<RecordType>): MXDBSyncOperationRecord[] {
  return Object.entries(record.audit).orderBy(([key]) => key).mapMany(([, value]) => value.operations);
}

function mergeSyncRecords<RecordType extends Record>(original: MXDBSyncRecordOriginal<RecordType>, ...records: MXDBSyncRecord<RecordType>[]): MXDBSyncServerRecord<RecordType> {
  if (records.length === 0) return { id: original.value.id, original, audit: {} };
  const audit = records.reduce((acc, record) => ({
    ...acc,
    ...record.audit,
  }), {});
  return {
    id: records[0].id,
    audit,
    original,
  };
}

function createRecordFromSyncRecord<RecordType extends Record>(record: MXDBSyncServerRecord<RecordType>) {
  return applyOpsToRecord(record.original.value, getOps(record));
}

function isNewRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncServerRecord<RecordType> & MXDBSyncRequestRecord<RecordType> {
  return 'original' in record && record.original != null;
}

function isExistingRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncRequestRecord<RecordType> & { original: undefined; } {
  return record.original == null;
}

export function useAuditTools() {
  return {
    generateSyncRecordsFrom,
    getOps,
    mergeSyncRecords,
    createRecordFromSyncRecord,
    isNewRecord,
    isExistingRecord,
  };
}