import { InternalError, is, to, type Record } from '@anupheaus/common';
import type { MXDBSyncClientRecord, MXDBSyncOperationRecord, MXDBSyncRecord, MXDBSyncRequestRecord, MXDBSyncServerRecord } from '../internalModels';
import type { DiffOps } from 'just-diff-apply';
import { diffApply } from 'just-diff-apply';
import { diff } from 'just-diff';
import { getNowTime } from '../utils';

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

function getOps<RecordType extends Record>(record: MXDBSyncRecord<RecordType>): MXDBSyncOperationRecord[] {
  return Object.entries(record.audit).orderBy(([key]) => key).mapMany(([, value]) => value.operations);
}

function createRecordFromSyncRecord<RecordType extends Record>(record: MXDBSyncRecord<RecordType>) {
  return applyOpsToRecord(record.original.value, getOps(record));
}

// eslint-disable-next-line max-len
function createSyncRecordsFromRecords<RecordType extends Record>(existingSyncRecords: MXDBSyncRecord<RecordType>[], toRecords: RecordType[], syncTime: number, userId: string): MXDBSyncRecord<RecordType>[] {
  return toRecords.map((record): MXDBSyncRecord<RecordType> => createSyncRecordFromRecord(record, existingSyncRecords.findById(record.id), userId, syncTime));
}

function createSyncRecordFromRecord<RecordType extends Record, SyncRecordType extends MXDBSyncRecord<RecordType>>(currentRecord: RecordType, syncRecord: SyncRecordType | undefined, userId: string,
  syncTime: number = getNowTime()): SyncRecordType {
  let defaultSyncRecord = { id: currentRecord.id, original: { userId, value: currentRecord, timestamp: syncTime }, audit: {} } as SyncRecordType;
  if (is.browser()) {
    defaultSyncRecord = { lastSyncTimestamp: syncTime, ...defaultSyncRecord } satisfies MXDBSyncClientRecord<RecordType>;
  } else {
    defaultSyncRecord = defaultSyncRecord satisfies MXDBSyncServerRecord<RecordType>;
  }
  if (syncRecord == null) return defaultSyncRecord;
  if (isNewer(syncRecord, syncTime)) return syncRecord;
  const previousRecord = applyOpsToRecord(syncRecord.original.value, getOps(syncRecord));
  if (previousRecord == null) return syncRecord; // return the current sync record as this occurs when the record has been deleted
  const operations = diff(previousRecord, currentRecord);
  if (operations.length === 0) return syncRecord;
  return {
    ...syncRecord,
    audit: {
      ...syncRecord.audit,
      [syncTime]: {
        userId,
        operations,
      },
    },
  };
}

// eslint-disable-next-line max-len
function createDeletedSyncRecordsFromRecords<RecordType extends Record>(existingSyncRecords: MXDBSyncServerRecord<RecordType>[], toRecords: RecordType[], syncTime: number, userId: string): MXDBSyncServerRecord<RecordType>[] {
  return toRecords.map((record): MXDBSyncServerRecord<RecordType> => {
    const existingSyncRecord = existingSyncRecords.findById(record.id);
    if (existingSyncRecord != null) {
      const existingRecord = createRecordFromSyncRecord(existingSyncRecord);
      if (existingRecord == null) return existingSyncRecord; // already deleted

      return {
        ...existingSyncRecord,
        audit: {
          ...existingSyncRecord.audit,
          [syncTime]: {
            userId,
            operations: [{ op: 'delete', path: [''], value: existingRecord }],
          },
        },
      };
    } else {
      return {
        id: record.id,
        original: { userId, value: record, timestamp: syncTime },
        audit: {
          [syncTime]: {
            userId,
            operations: [{ op: 'delete', path: [''], value: record }],
          },
        },
      };
    }
  });
}

function isNewer<RecordType extends Record>(record: MXDBSyncRecord<RecordType> | undefined, time?: number) {
  if (record == null) return false;
  const allTimestamps = Object.keys(record.audit ?? {}).map<number | undefined>(to.number).concat(record.original?.timestamp).removeNull();
  if (allTimestamps.length === 0) return false;
  const latestTimestamp = allTimestamps.max();
  if (is.browser()) {
    time = time ?? (record as MXDBSyncClientRecord<RecordType>).lastSyncTimestamp;
    if (time == null) return false;
  } else {
    time ??= getNowTime();
  }
  return latestTimestamp > time;
}

function isNewRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncServerRecord<RecordType> & MXDBSyncRequestRecord<RecordType> {
  return 'original' in record && record.original != null;
}

function isExistingRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncRequestRecord<RecordType> & { original: undefined; } {
  return record.original == null;
}

export function useSyncTools() {
  return {
    createSyncRecordsFromRecords,
    createDeletedSyncRecordsFromRecords,
    createSyncRecordFromRecord,
    createRecordFromSyncRecord,
    getOps,
    isNewRecord,
    isNewer,
    isExistingRecord,
  };
}