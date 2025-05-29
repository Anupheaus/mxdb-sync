// import type { PromiseMaybe } from '@anupheaus/common';
// import { InternalError, is, to, type Record } from '@anupheaus/common';
// import type { MXDBSyncClientRecord, MXDBSyncOperationRecord, MXDBSyncRecord, MXDBSyncRequestRecord, MXDBSyncServerRecord } from '../internalModels';
// import type { DiffOps } from 'just-diff-apply';
// import { diffApply } from 'just-diff-apply';
// import { diff } from 'just-diff';
// import { getNowTime } from '../utils';

// function removeOpFromAudit<RecordType extends Record>(syncRecord: MXDBSyncRecord<RecordType>, key: number, op: MXDBSyncOperationRecord): boolean {
//   const audit = syncRecord.audit;
//   if (audit == null || audit[key] == null) return false;
//   const index = audit[key].operations.findIndex(o => o === op);
//   if (index === -1) return false;
//   audit[key].operations = audit[key].operations.filter(o => o !== op);
//   return true;
// }

// async function createRecordFromSyncRecord<RecordType extends Record>(syncRecord: MXDBSyncRecord<RecordType>, updatedSyncRecord?: () => PromiseMaybe<void>): Promise<RecordType | undefined> {
//   const originalRecord = syncRecord.original.value;
//   const originalRecordId = originalRecord.id;
//   if (syncRecord.id !== originalRecordId) throw new InternalError('Sync record id does not match original record id', { meta: { syncRecord, originalRecord } });
//   let hasUpdatedSyncRecord = false;
//   const opsInOrder: [number, MXDBSyncOperationRecord[]][] = Object.entries(syncRecord.audit)
//     .orderBy(([key]) => key)
//     .mapWithoutNull(([key, value]) => {
//       const timestamp = to.number(key);
//       return timestamp == null ? undefined : [timestamp, value.operations] as [number, MXDBSyncOperationRecord[]];
//     });
//   if (opsInOrder.last()?.[1].last()?.op === 'delete') return; // if the last operation is a delete, return undefined - the record has been deleted
//   let currentRecord = Object.clone(originalRecord);
//   opsInOrder
//     .forEach(([key, ops]) => {
//       ops.forEach(op => {
//         if (op.op === 'delete') return;
//         if (op.op === 'restore') { currentRecord = Object.clone(op.value); return; }
//         try {
//           diffApply(currentRecord, [op] as DiffOps);
//           if (currentRecord.id !== originalRecordId) throw new InternalError('Record id has changed', { meta: { currentRecord, originalRecord, op } });
//         } catch (error) {
//           if (error instanceof Error && error.message.includes('expected to find property')) {
//             if (removeOpFromAudit(syncRecord, key, op)) hasUpdatedSyncRecord = true;
//           } else if (error instanceof InternalError) {
//             throw error;
//           } else {
//             throw new InternalError('Failed to apply operations to record', { meta: { record: originalRecord, ops, error } });
//           }
//         }
//       });
//     });
//   if (hasUpdatedSyncRecord) await updatedSyncRecord?.();
//   return currentRecord;
// }

// // eslint-disable-next-line max-len
// async function createSyncRecordsFromRecords<RecordType extends Record>(existingSyncRecords: MXDBSyncRecord<RecordType>[], toRecords: RecordType[],
// syncTime: number, userId: string): Promise<MXDBSyncRecord<RecordType>[]> {
//   return toRecords.mapPromise(record => createSyncRecordFromRecord(record, existingSyncRecords.findById(record.id), userId, syncTime));
// }

// async function createSyncRecordFromRecord<RecordType extends Record, SyncRecordType extends MXDBSyncRecord<RecordType>>(currentRecord: RecordType, syncRecord: SyncRecordType | undefined, userId: string,
//   syncTime: number = getNowTime()): Promise<SyncRecordType> {
//   let defaultSyncRecord = { id: currentRecord.id, original: { userId, value: currentRecord, timestamp: syncTime }, audit: {} } as SyncRecordType;
//   if (is.browser()) {
//     defaultSyncRecord = { lastSyncTimestamp: syncTime, ...defaultSyncRecord } satisfies MXDBSyncClientRecord<RecordType>;
//   } else {
//     defaultSyncRecord = defaultSyncRecord satisfies MXDBSyncServerRecord<RecordType>;
//   }
//   if (syncRecord == null) return defaultSyncRecord;
//   if (isNewer(syncRecord, syncTime)) return syncRecord;
//   const previousRecord = await createRecordFromSyncRecord(syncRecord);
//   if (previousRecord == null) return syncRecord; // return the current sync record as this occurs when the record has been deleted
//   const operations = diff(previousRecord, currentRecord);
//   if (operations.length === 0) return syncRecord;
//   return {
//     ...syncRecord,
//     audit: {
//       ...syncRecord.audit,
//       [syncTime]: {
//         userId,
//         operations,
//       },
//     },
//   };
// }

// // eslint-disable-next-line max-len
// async function createDeletedSyncRecordsFromRecords<RecordType extends Record>(existingSyncRecords: MXDBSyncServerRecord<RecordType>[], toRecords: RecordType[],
// syncTime: number, userId: string): Promise<MXDBSyncServerRecord<RecordType>[]> {
//   return toRecords.mapPromise(async record => {
//     const existingSyncRecord = existingSyncRecords.findById(record.id);
//     if (existingSyncRecord != null) {
//       const existingRecord = await createRecordFromSyncRecord(existingSyncRecord);
//       if (existingRecord == null) return existingSyncRecord; // already deleted

//       return {
//         ...existingSyncRecord,
//         audit: {
//           ...existingSyncRecord.audit,
//           [syncTime]: {
//             userId,
//             operations: [{ op: 'delete', path: [''], value: existingRecord }],
//           },
//         },
//       };
//     } else {
//       return {
//         id: record.id,
//         original: { userId, value: record, timestamp: syncTime },
//         audit: {
//           [syncTime]: {
//             userId,
//             operations: [{ op: 'delete', path: [''], value: record }],
//           },
//         },
//       };
//     }
//   });
// }

// function isNewer<RecordType extends Record>(record: MXDBSyncRecord<RecordType> | undefined, time?: number) {
//   if (record == null) return false;
//   const allTimestamps = Object.keys(record.audit ?? {}).map<number | undefined>(to.number).concat(record.original?.timestamp).removeNull();
//   if (allTimestamps.length === 0) return false;
//   const latestTimestamp = allTimestamps.max();
//   if (is.browser()) {
//     time = time ?? (record as MXDBSyncClientRecord<RecordType>).lastSyncTimestamp;
//     if (time == null) return false;
//   } else {
//     time ??= getNowTime();
//   }
//   return latestTimestamp > time;
// }

// function isNewRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncServerRecord<RecordType> & MXDBSyncRequestRecord<RecordType> {
//   return 'original' in record && record.original != null;
// }

// function isExistingRecord<RecordType extends Record>(record: MXDBSyncRequestRecord<RecordType>): record is MXDBSyncRequestRecord<RecordType> & { original: undefined; } {
//   return record.original == null;
// }

// export function useSyncTools() {
//   return {
//     createSyncRecordsFromRecords,
//     createDeletedSyncRecordsFromRecords,
//     createSyncRecordFromRecord,
//     createRecordFromSyncRecord,
//     isNewRecord,
//     isNewer,
//     isExistingRecord,
//   };
// }