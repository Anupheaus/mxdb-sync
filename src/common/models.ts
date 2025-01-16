import type { Record } from '@anupheaus/common';
import type { MXDBCollection, MXDBCollectionConfig, QueryProps, DistinctProps } from '@anupheaus/mxdb';
import type { DateTime } from 'luxon';
import type { useCollection as useServerCollection } from '../server/collections';

// export type MongoDocOf<RecordType extends Record> = Omit<RecordType, 'id'> & { _id: string; };
export type MongoDocOf<RecordType extends Record> = {
  [K in keyof RecordType as K extends 'id' ? '_id' : K]: RecordType[K] extends DateTime<any> ? string : RecordType[K];
};
//Omit<RecordType, 'id'> & { _id: string; };

export type QueryRequest<RecordType extends Record = Record> = Omit<QueryProps<RecordType>, 'disable'> & {
  collectionName: string;
  queryId?: string;
  registrationAction?: 'register' | 'unregister';
};

export type DistinctRequest<RecordType extends Record = Record> = Omit<DistinctProps<RecordType>, 'disable'> & {
  handlerId: string;
};

export type QueryResponse = number;

export type MXDBSyncedCollection<RecordType extends Record = any> = MXDBCollection<RecordType> & {};

export type MXDBSyncedCollectionWatchUpdate<RecordType extends Record = any> = {
  type: 'upsert';
  records: RecordType[];
} | {
  type: 'remove';
  records: string[];
};

export type UseCollection = typeof useServerCollection;

export interface MXDBSyncedCollectionConfig<RecordType extends Record = any> extends MXDBCollectionConfig<RecordType> {
  disableSync?: boolean;
  disableAudit?: boolean;
  onSeed?(useCollection: UseCollection): Promise<void>;
}

export interface UpsertRequest {
  collectionName: string;
  records: Record[];
}

export type UpsertResponse = string[];

export { QueryProps, DistinctProps };
