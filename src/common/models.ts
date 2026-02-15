import type { DataFilters, DataRequest, DataSorts, Record } from '@anupheaus/common';
import type { DateTime } from 'luxon';
import type { UseSeedCollection } from '../server/seeding';

export type MongoDocOf<RecordType extends Record> = {
  [K in keyof RecordType as K extends 'id' ? '_id' : K]: RecordType[K] extends DateTime<any> ? string : RecordType[K];
};

export interface QueryProps<RecordType extends Record> extends DataRequest<RecordType> {
  getAccurateTotal?: boolean;
  disable?: boolean;
}

export interface QueryResults<RecordType extends Record> {
  records: RecordType[];
  total: number;
}

export type QueryRequest<RecordType extends Record = Record> = Omit<QueryProps<RecordType>, 'disable'> & {
  collectionName: string;
};

export type QueryResponse = number;

export interface MXDBCollection<RecordType extends Record = any> {
  name: string;
  type: RecordType;
}

export type UseCollection = UseSeedCollection;

export interface MXDBCollectionIndex<RecordType extends Record = Record> {
  name: string;
  fields: (keyof RecordType)[];
  isUnique?: boolean;
  isSparse?: boolean;
}

export interface MXDBCollectionConfig<RecordType extends Record = any> {
  name: string;
  version: number;
  indexes: MXDBCollectionIndex<RecordType>[];
  // onUpgrade?(prevVersion: number, records: RecordType[]): RecordType[];
  // onWrite?(records: RecordType[]): PromiseMaybe<RecordType[]>;
  // onRead?(records: RecordType[]): PromiseMaybe<RecordType[]>;
  disableSync?: boolean;
  disableAudit?: boolean;
}

export interface UpsertRequest {
  collectionName: string;
  records: Record[];
}

export type UpsertResponse = string[];

export interface RemoveRequest {
  collectionName: string;
  recordIds: string[];
  locallyOnly: boolean;
}


export type RemoveResponse = void;

export interface UnauthorisedOperationDetails {
  userId: string | undefined;
  token: string | undefined;
  collectionName: string;
  operation: 'upsert' | 'remove';
}

export interface GetRequest {
  collectionName: string;
  ids: string[];
}

export interface GetAllRequest {
  collectionName: string;
}

export type GetResponse = string[];

export interface DistinctProps<RecordType extends Record = Record, Key extends keyof RecordType = keyof RecordType> {
  field: Key;
  filters?: DataFilters<RecordType>;
  sorts?: DataSorts<RecordType>;
  disable?: boolean;
}

export type DistinctResults<RecordType extends Record, Key extends keyof RecordType = keyof RecordType> = RecordType[Key][];

export interface DistinctRequest<RecordType extends Record = Record> extends DistinctProps<RecordType> {
  collectionName: string;
}

export type DistinctResponse = string;

export { UseSeedCollection };

export interface MXDBOnUpsertChangeEvent {
  type: 'insert' | 'update';
  records: Record[];
}

export interface MXDBOnDeleteChangeEvent {
  type: 'delete';
  recordIds: string[];
}

export type MXDBOnChangeEvent = MXDBOnUpsertChangeEvent | MXDBOnDeleteChangeEvent;
