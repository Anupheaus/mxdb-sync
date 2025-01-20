import { DateTime } from 'luxon';
import type { MXDBSyncClientRecord, MXDBSyncOperationRecord, MXDBSyncRecord, MXDBSyncServerRecord } from './internalModels';
import type { Record } from '@anupheaus/common';
import { InternalError, is, to } from '@anupheaus/common';
import { diff } from 'just-diff';
import type { DiffOps } from 'just-diff-apply';
import { diffApply } from 'just-diff-apply';

export function generateSyncTime() {
  return DateTime.now().toUTC().valueOf();
}

export function isNewer<RecordType extends Record>(record: MXDBSyncRecord<RecordType> | undefined, time?: number) {
  if (record == null) return false;
  const allTimestamps = Object.keys(record.audit ?? {}).map<number | undefined>(to.number).concat(record.original?.timestamp).removeNull();
  if (allTimestamps.length === 0) return false;
  const latestTimestamp = allTimestamps.max();
  if (is.browser()) {
    time = time ?? (record as MXDBSyncClientRecord<RecordType>).lastSyncTimestamp;
    if (time == null) return false;
  } else {
    time ??= generateSyncTime();
  }
  return latestTimestamp > time;
}

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

// eslint-disable-next-line max-len
export function generateSyncRecordFromCurrentRecord<RecordType extends Record, SyncRecordType extends MXDBSyncRecord<RecordType>>(currentRecord: RecordType, syncRecord: SyncRecordType | undefined, userId: string, syncTime: number = generateSyncTime()): SyncRecordType {
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

export function createRecordFromSyncRecord<RecordType extends Record>(record: MXDBSyncRecord<RecordType>) {
  return applyOpsToRecord(record.original.value, getOps(record));
}