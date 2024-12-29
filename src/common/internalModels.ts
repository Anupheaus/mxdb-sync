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
  original?: MXDBSyncRecordOriginal<RecordType>;
  audit: globalThis.Record<number, MXDBSyncRecordAudit>;
}

export interface MXDBSyncClientRecord<RecordType extends Record = any> extends MXDBSyncRecord<RecordType> {
  lastSyncTimestamp: number;
}

export interface MXDBSyncServerRecord<RecordType extends Record = Record> extends MXDBSyncRecord<RecordType> {
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
  collectionName: string;
  records: MXDBSyncRequestRecord<RecordType>[];
}

export interface MXDBSyncResponse<RecordType extends Record = any> {
  updated: RecordType[];
  savedIds: string[];
  removedIds: string[];
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

export const MXDBEndpointSpec = Symbol('MXDBEndpointSpec');
