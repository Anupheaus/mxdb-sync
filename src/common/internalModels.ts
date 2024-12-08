import type { Record } from '@anupheaus/common';
import type { DistinctProps, QueryProps } from '@anupheaus/mxdb';

export type MXDBSyncOperationRecordOperation = 'remove' | 'move' | 'replace' | 'add' | 'delete' | 'restore';

export interface MXDBSyncOperationRecord {
  op: MXDBSyncOperationRecordOperation;
  path: (string | number)[];
  value?: any;
}

export interface MXDBSyncRecordAudit {
  userId: string;
  operations: MXDBSyncOperationRecord[];
}

export interface MXDBSyncRecordOriginal<RecordType extends Record> {
  userId: string;
  value: RecordType;
  timestamp: number;
}

export interface MXDBSyncRecord<RecordType extends Record> extends Record {
  original?: MXDBSyncRecordOriginal<RecordType>;
  audit: globalThis.Record<number, MXDBSyncRecordAudit>;
}

export interface MXDBSyncClientRecord<RecordType extends Record = any> extends MXDBSyncRecord<RecordType> {
  lastSyncTimestamp: number;
}

export interface MXDBSyncServerRecord<RecordType extends Record> extends MXDBSyncRecord<RecordType> {
  original: MXDBSyncRecordOriginal<RecordType>;
}

// export namespace MXDBSyncClientRecord {

//   export function getSyncData<RecordType extends Record>(currentRecord: RecordType | undefined, syncRecord: MXDBSyncClientRecord<RecordType>): MXDBSyncRecordData<RecordType> | undefined {
//     if (currentRecord == null) return;
//     const lastSyncTimestamp = syncRecord.lastSyncTimestamp;
//     const audits = Object.entries(syncRecord.audit ?? {}).filter(([timestamp]) => parseInt(timestamp) > lastSyncTimestamp);
//     return {
//       ...syncRecord,
//       audit: audits.reduce((acc, [timestamp, audit]) => ({ ...acc, [timestamp]: audit }), {}),
//       current: currentRecord,
//     };
//   }

//   export function setSyncData<RecordType extends Record>(auditRecord: MXDBSyncRecordData<RecordType>): MXDBSyncRecord<RecordType> {
//     return (({ current: ignored, lastSyncTimestamp, ...rest }: MXDBSyncRecordData<RecordType>) => rest)(auditRecord);
//   }
// }

export interface MXDBSyncRequestRecord<RecordType extends Record> extends MXDBSyncClientRecord<RecordType> { }

export interface MXDBSyncRequest<RecordType extends Record = any> {
  records: MXDBSyncRequestRecord<RecordType>[];
}

export interface MXDBSyncResponse<RecordType extends Record = any> {
  updated: RecordType[];
  savedIds: string[];
  removedIds: string[];
}

export interface CommonSubscriptionRequest {
  subscriberId: string;
}

export interface QuerySubscriptionRequest<RecordType extends Record> extends Omit<QueryProps<RecordType>, 'disable'>, CommonSubscriptionRequest {
  subscriptionType: 'query';
}

export interface DistinctSubscriptionRequest<RecordType extends Record> extends Omit<DistinctProps<RecordType>, 'disable'>, CommonSubscriptionRequest {
  subscriptionType: 'distinct';
}

export type SubscriptionRequest<RecordType extends Record> = QuerySubscriptionRequest<RecordType> | DistinctSubscriptionRequest<RecordType>;

export interface SubscriptionResponse<RecordType extends Record> {
  records: RecordType[];
  total: number;
}