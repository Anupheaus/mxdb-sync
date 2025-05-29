import type { Record } from '@anupheaus/common';
// import type { DbCollection } from './DbCollection';

// export type Upsert<RecordType extends Record> = DbCollection<RecordType>['upsert'];
// export type Get<RecordType extends Record> = DbCollection<RecordType>['get'];
// export type Delete<RecordType extends Record> = DbCollection<RecordType>['delete'];
// export type Clear<RecordType extends Record> = DbCollection<RecordType>['clear'];
// export type Count<RecordType extends Record> = DbCollection<RecordType>['count'];
// export type Distinct<RecordType extends Record> = DbCollection<RecordType>['distinct'];

export type MXDBCollectionEvent<RecordType extends Record> = {
  type: 'upsert';
  records: RecordType[];
  auditAction: 'default' | 'branched';
} | {
  type: 'remove';
  ids: string[];
  auditAction: 'remove' | 'markAsDeleted';
} | {
  type: 'clear';
  ids: string[];
};