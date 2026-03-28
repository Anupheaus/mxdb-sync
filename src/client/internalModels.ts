import type { Record } from '@anupheaus/common';
import type { useCollection } from './hooks/useCollection/useCollection';

export type MXDBGet<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['get'];
export type MXDBUpsert<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['upsert'];
export type MXDBRemove<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['remove'];
export type MXDBQuery<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['query'];

/** Client-side sync row view (local current record + sync metadata as needed by hooks). */
export interface MXDBSyncRecordData<RecordType extends Record = Record> {
  current: RecordType;
}
