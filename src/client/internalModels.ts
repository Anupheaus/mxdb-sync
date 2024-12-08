import type { Record } from '@anupheaus/common';
import type { useCollection } from '@anupheaus/mxdb';
import type { MXDBSyncClientRecord } from '../common/internalModels';

export type MXDBGet<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['get'];
export type MXDBUpsert<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['upsert'];
export type MXDBRemove<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['remove'];
export type MXDBQuery<RecordType extends Record> = ReturnType<typeof useCollection<RecordType>>['query'];

export interface MXDBSyncRecordData<RecordType extends Record = Record> extends MXDBSyncClientRecord<RecordType> {
  current: RecordType;
}
