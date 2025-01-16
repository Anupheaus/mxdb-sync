import type { DataFilters, Record } from '@anupheaus/common';
import { DataSorts } from '@anupheaus/common';
import { InternalError, is } from '@anupheaus/common';
import { Context } from '../../contexts';
import type { DbContextProps } from './DbContext';
import type { Collection, Db, Filter, Sort, WithId } from 'mongodb';
import type { MongoDocOf, MXDBSyncedCollection } from '../../../common';
import { useLogger } from '../logger';
import type { MXDBSyncServerRecord } from '../../../common/internalModels';

function toMongoDoc<RecordType extends Record>(record: RecordType): MongoDocOf<RecordType> {
  return (({ id, ...rec }) => ({ ...rec, _id: record.id }))(record) as unknown as MongoDocOf<RecordType>;
}

function toMongoDocs<RecordType extends Record>(records: RecordType[]): MongoDocOf<RecordType>[] {
  return records.map(toMongoDoc);
}

function fromMongoDoc<RecordType extends Record>(record: WithId<MongoDocOf<RecordType>> | MongoDocOf<RecordType>): RecordType {
  return (({ _id, ...rec }) => ({ ...rec, id: record._id }))(record) as unknown as RecordType;
}

function fromMongoDocs<RecordType extends Record>(records: WithId<MongoDocOf<RecordType>>[] | MongoDocOf<RecordType>[]): RecordType[] {
  return records.map(fromMongoDoc) as RecordType[];
}

function convertFilter<RecordType extends Record>(filter: DataFilters<RecordType> | Filter<RecordType> | undefined): Filter<MongoDocOf<RecordType>> {
  if (filter == null) return {};
  const mongoFilter = Object.clone(filter) as Filter<MongoDocOf<RecordType>>;
  if (is.plainObject(mongoFilter) && Reflect.has(mongoFilter, 'id')) {
    mongoFilter._id = mongoFilter.id;
    delete mongoFilter.id;
  }
  return mongoFilter;
}

function convertSort<RecordType extends Record>(sorts: DataSorts<RecordType> | undefined, addDefaultSort = true): Sort {
  const strictSorts = DataSorts.toArray(sorts);
  if (addDefaultSort && strictSorts.length === 0) strictSorts.push(['id', 'asc']);
  return strictSorts.reduce((acc, [field, direction]) => ({
    ...acc,
    [field === 'id' ? '_id' : field]: direction === 'desc' ? -1 : 1,
  }), {});
}

async function getMatchingRecordsById<RecordType extends Record>(collection: Collection<MongoDocOf<RecordType>>, ids: string[]): Promise<RecordType[]> {
  return fromMongoDocs(await collection.find({ _id: { $in: ids as any } }).toArray());
}

async function getMatchingRecords<RecordType extends Record>(collection: Collection<MongoDocOf<RecordType>>, records: Record[]): Promise<RecordType[]> {
  return getMatchingRecordsById(collection, records.ids());
}

function getCollections(db: Db) {
  return <RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) => ({
    dataCollection: db.collection<MongoDocOf<RecordType>>(collection.name),
    syncCollection: db.collection<MongoDocOf<MXDBSyncServerRecord<RecordType>>>(collection.name + '_sync'),
  });
}

async function bulkWrite<RecordType extends Record>(collection: Collection<MongoDocOf<RecordType>>, records: RecordType[]): Promise<void> {
  if (records.length === 0) return;
  const logger = useLogger();
  try {
    const result = await collection.bulkWrite(records.map(r => ({ replaceOne: { replacement: toMongoDoc(r), filter: { _id: r.id as any }, upsert: true } })));
    if (!result.isOk()) throw new InternalError('Upsert failed - result is not as expected');
    const upsertedRecordCount = result.matchedCount + result.upsertedCount;
    const recordCount = records.length;
    if (upsertedRecordCount !== recordCount) {
      logger.debug('Upsert failed', {
        collection: collection.collectionName, upsertedRecordCount, recordCount,
        matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount,
        insertedCount: result.insertedCount, deletedCount: result.deletedCount, upsertedIds: result.upsertedIds, insertedIds: result.insertedIds,
      });
      throw new InternalError(`Upsert failed - count of upserted records (${upsertedRecordCount}) does not match the count of records to upsert (${recordCount})`);
    }
  } catch (error) {
    logger.error('Upsert error', { collection: collection.collectionName, error });
    throw error;
  }
}

export function useDb() {
  const context = Context.get<DbContextProps>('db');

  return {
    ...context,
    getCollections: getCollections(context.db),
    getMatchingRecordsById,
    getMatchingRecords,
    bulkWrite,
    toMongoDoc,
    toMongoDocs,
    fromMongoDoc,
    fromMongoDocs,
    convertFilter,
    convertSort,
  };
}