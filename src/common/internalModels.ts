import type { AnyObject, Record } from '@anupheaus/common';

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
  original: MXDBSyncRecordOriginal<RecordType>;
  audit: globalThis.Record<number, MXDBSyncRecordAudit>;
}

export interface MXDBSyncClientRecord<RecordType extends Record = any> extends MXDBSyncRecord<RecordType> {
  lastSyncTimestamp: number;
}

export interface MXDBSyncServerRecord<RecordType extends Record = Record> extends MXDBSyncRecord<RecordType> {
}

export interface MXDBSyncRequestRecord<RecordType extends Record> extends MXDBSyncClientRecord<RecordType> { }

export interface MXDBSyncRequest<RecordType extends Record = any> {
  collectionName: string;
  records: MXDBSyncRequestRecord<RecordType>[];
}

export interface SubscriptionRequest {
  type: string;
  subscriberId: string;
  props: AnyObject;
}

export interface SubscriptionResponse<RecordType extends Record> {
  records: RecordType[];
  total: number;
}
