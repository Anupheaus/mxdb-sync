import type { DataFilters, DataResponse, Logger, AuditOf } from '@anupheaus/common';
import { auditor, bind, DataSorts, InternalError, is, type Record } from '@anupheaus/common';
import type { MXDBCollectionConfig, MXDBCollectionIndex } from '../../../common';
import { configRegistry, type MongoDocOf, type MXDBCollection, type QueryProps, type DistinctProps } from '../../../common';
import type { Collection, Db, Filter, IndexDescriptionInfo, Sort, SortDirection, WithId } from 'mongodb';
import { dbUtils } from './db-utils';
import { useSocketAPI } from '@anupheaus/socket-api/server';
import { DateTime } from 'luxon';

const slowFilterParseThreshold = 1000;
const slowQueryThreshold = 3000;

interface DbCollectionSyncProps<RecordType extends Record> {
  updated: RecordType[];
  updatedAudits: AuditOf<RecordType>[];
  removedIds: string[];
}

interface Props<RecordType extends Record> {
  getDb(): Promise<Db>;
  collection: MXDBCollection<RecordType>;
  collectionNames: Promise<Set<string>>;
  logger: Logger;
}

export class ServerDbCollection<RecordType extends Record = Record> {
  constructor({ getDb, collection, collectionNames, logger }: Props<RecordType>) {
    this.#getDb = getDb;
    this.#collection = collection;
    this.#collectionNames = collectionNames;
    this.#config = configRegistry.getOrError(collection);
    this.#logger = logger.createSubLogger(collection.name);
    this.#configure();
  }

  #getDb: () => Promise<Db>;
  #collectionNames: Promise<Set<string>>;
  #collection: MXDBCollection<RecordType>;
  #config: MXDBCollectionConfig;
  #logger: Logger;

  public get name() { return this.#collection.name; }

  public get collection() { return this.#collection; }

  public async get(id: string): Promise<RecordType | undefined>;
  public async get(ids: string[]): Promise<RecordType[]>;
  @bind
  public async get(ids: string | string[]): Promise<RecordType | RecordType[] | undefined> {
    const collection = await this.#getCollection();
    const isArray = Array.isArray(ids);
    const justIds = (isArray ? ids : [ids]) as any[];
    const docs = (await collection.find({ _id: { $in: justIds } }).toArray()).mapWithoutNull(dbUtils.deserialize);
    return isArray ? docs : docs[0];
  }

  public async getAudit(id: string): Promise<AuditOf<RecordType> | undefined>;
  public async getAudit(ids: string[]): Promise<AuditOf<RecordType>[]>;
  @bind
  public async getAudit(ids: string | string[]): Promise<AuditOf<RecordType> | AuditOf<RecordType>[] | undefined> {
    const collection = await this.#getAuditCollection();
    const isArray = Array.isArray(ids);
    const justIds = (isArray ? ids : [ids]) as any[];
    const docs = (await collection.find({ _id: { $in: justIds } }).toArray()).mapWithoutNull(dbUtils.deserialize);
    return isArray ? docs : docs[0];
  }

  @bind
  public async find(query: Filter<MongoDocOf<RecordType>>): Promise<RecordType | undefined> {
    const collection = await this.#getCollection();
    const doc = await collection.findOne(query);
    if (doc == null) return;
    return dbUtils.deserialize(doc);
  }

  @bind
  public async query(request?: QueryProps<RecordType>): Promise<DataResponse<RecordType>> {
    const collection = await this.#getCollection();
    if (request == null) {
      const innerDocs = (await collection.find().toArray()).mapWithoutNull(dbUtils.deserialize);
      return { data: innerDocs, total: innerDocs.length };
    } else {
      let filters: Filter<MongoDocOf<RecordType>> | undefined;
      let offset: number | undefined;
      let limit: number | undefined;

      if (request.filters != null && Object.keys(request.filters).length > 0) {
        const startTime = performance.now();
        filters = this.#parseFilters(request.filters);
        const endTime = performance.now();
        if (endTime - startTime >= slowFilterParseThreshold) this.#logger.warn(`Slow filter parsing found for "${collection.collectionName}"`, { request, duration: endTime - startTime });
      }
      if (request.pagination != null) {
        offset = request.pagination.offset ?? 0;
        limit = request.pagination.limit;
      }
      const sort = this.#parseSorts(request.sorts);
      this.#logger.debug('Querying database', { filters, sort, offset, limit });
      const startTime = performance.now();
      const rawDocs = await collection.find(filters ?? {}, { sort, skip: offset, limit }).toArray();
      const endTime = performance.now();
      if (endTime - startTime >= slowQueryThreshold) this.#logger.warn(`Slow query found for "${collection.collectionName}"`, { request, duration: endTime - startTime });
      const data = rawDocs.mapWithoutNull(dbUtils.deserialize);
      if (request.getAccurateTotal !== true) return { data, total: data.length, offset, limit };
      const totalCount = await collection.countDocuments(filters);
      return { data, total: totalCount, offset, limit };
    }
  }

  @bind
  public async getAll(): Promise<RecordType[]> {
    const collection = await this.#getCollection();
    return (await collection.find().toArray()).mapWithoutNull(dbUtils.deserialize);
  }

  public async upsert(record: RecordType): Promise<void>;
  public async upsert(records: RecordType[]): Promise<void>;
  @bind
  public async upsert(records: RecordType | RecordType[]): Promise<void> {
    const collection = await this.#getCollection();
    records = Array.isArray(records) ? records : [records];
    if (records.length === 0) return;
    const result = await collection.bulkWrite(records.map(record => ({ replaceOne: { replacement: dbUtils.serialize(record), filter: { _id: record.id as any }, upsert: true } })));
    if (!result.isOk()) throw new InternalError('Bulk write failed - result is not as expected');
    const upsertedRecordCount = result.matchedCount + result.upsertedCount;
    const recordCount = records.length;
    if (upsertedRecordCount !== recordCount) throw new InternalError(`Upsert failed - count of upserted records (${upsertedRecordCount}) does not match the count of records to upsert (${recordCount})`);
    const existingRecords = await this.get(records.ids());
    if (this.#config.disableAudit !== true) this.#upsertAudit(existingRecords, records); // do not wait on the audit update
  }

  public async delete(id: string): Promise<void>;
  public async delete(ids: string[]): Promise<void>;
  @bind
  public async delete(ids: string | string[]): Promise<void> {
    const collection = await this.#getCollection();
    ids = Array.isArray(ids) ? ids : [ids];
    const result = await collection.deleteMany({ _id: { $in: ids as any[] } });
    if (!result.acknowledged) throw new InternalError('Delete failed - result is not as expected');
    const deletedRecordCount = result.deletedCount;
    const recordCount = ids.length;
    if (deletedRecordCount !== recordCount)
      throw new InternalError(`Delete failed in "${this.#collection.name}" - count of deleted records (${deletedRecordCount}) does not match the count of records to delete (${recordCount})`);
    if (this.#config.disableAudit !== true) this.#deleteAudit(ids);
  }

  @bind
  public async distinct({ field, filters, sorts }: DistinctProps<RecordType>): Promise<RecordType[]> {
    const collection = await this.#getCollection();
    const mongoFilters = this.#parseFilters(filters);
    const mongoSorts = this.#parseSorts(sorts);
    const records = await collection.aggregate<WithId<MongoDocOf<RecordType>>>([mongoFilters == null ? undefined : {
      $match: mongoFilters
    }, {
      $group: { doc: { $first: '$$ROOT' }, _id: `$${field.toString()}` },
    }, {
      $replaceRoot: { newRoot: '$doc' },
    }, mongoSorts == null ? undefined : {
      $sort: mongoSorts,
    }].removeNull()).toArray();
    return records.mapWithoutNull(dbUtils.deserialize);
  }

  @bind
  public async count(): Promise<number> {
    const collection = await this.#getCollection();
    return await collection.countDocuments();
  }

  @bind
  public async clear() {
    const collection = await this.#getCollection();
    await collection.deleteMany();
    if (this.#config.disableAudit !== true) this.#clearAudit();
  }

  public async sync({ updated, updatedAudits, removedIds }: DbCollectionSyncProps<RecordType>) {
    const collection = await this.#getCollection();
    await this.#writeRecords(updated);
    await this.#writeAuditRecords(updatedAudits);
    const result = await collection.deleteMany({ _id: { $in: removedIds as any[] } });
    if (!result.acknowledged) throw new InternalError('Sync failed - unable to delete records requested');
    // we do not check the count of deleted records as it is possible that some of the records have already been deleted    
  }

  #parseFilters(filters: DataFilters<RecordType> | undefined): Filter<MongoDocOf<RecordType>> | undefined {
    if (filters == null) return;
    const clonedFilters = Object.clone(filters) as Filter<MongoDocOf<RecordType>>;
    const parse = (target: unknown) => {
      if (!is.plainObject(target)) return;
      Object.entries(target).forEach(([key, value]) => {
        if (key === 'id') {
          Reflect.deleteProperty(target, 'id');
          Reflect.set(target, '_id', value);
        } else if (DateTime.isDateTime(value) && !(value instanceof Date)) {
          Reflect.set(target, key, value.toJSDate());
        } else {
          parse(value);
        }
      });
    };
    parse(clonedFilters);
    return clonedFilters;
  }

  #parseSorts(sorts: DataSorts<RecordType> | undefined): Sort | undefined {
    const strictSorts = DataSorts.toArray(sorts);
    if (strictSorts.length === 0) return;
    if (strictSorts.length === 0) strictSorts.push(['id', 'asc']);
    return strictSorts.map(([field, direction]): [string, SortDirection] => [field === 'id' ? '_id' : field as string, direction]);
  }

  async #getCollectionByName<R extends Record = RecordType>(name: string) {
    const db = await this.#getDb();
    const names = await this.#collectionNames;
    if (names.has(name)) return db.collection<MongoDocOf<R>>(name);
    names.add(name);
    return db.createCollection<MongoDocOf<R>>(name);
  }

  async #getCollection() {
    return this.#getCollectionByName(this.#collection.name);
  }

  async #getAuditCollection() {
    return this.#getCollectionByName<AuditOf<RecordType>>(`${this.#collection.name}_sync`);
  }

  async #upsertAudit(existingRecords: RecordType[], records: RecordType[]) {
    const { getUser } = useSocketAPI();
    const user = getUser();
    const userId = user?.id ?? Math.emptyId();
    const recordIds = records.ids();
    const existingAuditRecords = await this.#getAuditRecords(recordIds);
    const newAuditRecords = records.mapWithoutNull(record => {
      let existingAuditRecord = existingAuditRecords.findById(record.id);
      const existingRecord = existingRecords.findById(record.id);
      if (existingRecord != null) {
        if (is.deepEqual(existingRecord, record)) return;
        if (existingAuditRecord != null) {
          const existingRecordFromAudit = auditor.createRecordFrom(existingAuditRecord);
          if (!is.deepEqual(existingRecordFromAudit, existingRecord)) existingAuditRecord = auditor.updateAuditWith(existingRecord, existingAuditRecord, Math.emptyId());
        }
      }
      return existingAuditRecord == null ? auditor.createAuditFrom(record, userId) : auditor.updateAuditWith(record, existingAuditRecord, userId);
    });
    await this.#writeAuditRecords(newAuditRecords);
  }

  async #deleteAudit(ids: string[]) {
    const { getUser } = useSocketAPI();
    const user = getUser();
    const userId = user?.id ?? Math.emptyId();
    const existingAuditRecords = await this.#getAuditRecords(ids);
    const newAuditRecords = existingAuditRecords.map(auditRecord => auditor.delete(auditRecord, userId));
    await this.#writeAuditRecords(newAuditRecords);
  }

  async #clearAudit() {
    const collection = await this.#getAuditCollection();
    await collection.deleteMany();
  }

  #dropIndexIfNotRequired(collection: Collection<MongoDocOf<RecordType>>, indexes: MXDBCollectionIndex<RecordType>[]) {
    const indexNames = indexes.map(index => index.name);
    return async (existingIndex: IndexDescriptionInfo) => {
      const indexName = existingIndex.name;
      if (indexName == null || indexName === '_id_') return; // do not drop the _id index
      if (indexNames.includes(indexName)) return;
      await collection.dropIndex(indexName);
    };
  }

  #setupIndexOn(collection: Collection<MongoDocOf<RecordType>>, existingIndexes: IndexDescriptionInfo[]) {
    return async (index: MXDBCollectionIndex<RecordType>) => {
      const existingIndex = existingIndexes.find(info => info.name === index.name);
      if (existingIndex != null) {
        const isSame = (existingIndex.sparse === true) === (index.isSparse === true) && (existingIndex.unique === true) === (index.isUnique === true);
        if (isSame) return;
        await collection.dropIndex(index.name);
      }
      await collection.createIndex(index.fields as string[], { name: index.name, unique: index.isUnique === true, sparse: index.isSparse === true });
    };
  }

  async #enableChangeStreamPreAndPostImages(db: Db, collection: Collection<any>) {
    try {
      await db.command({ collMod: collection.collectionName, changeStreamPreAndPostImages: { enabled: true } });
    } catch (error) {
      throw new InternalError(`Unable to update the change stream pre and post images settings for the "${collection.collectionName}" collection, please make sure that the user is set to an Atlas Admin user.`);
    }
  }

  async #configureIndexes(collection: Collection<MongoDocOf<RecordType>>) {
    const existingIndexes = await collection.indexes();
    const indexes = this.#config.indexes;
    await existingIndexes.forEachPromise(this.#dropIndexIfNotRequired(collection, indexes));
    await indexes.forEachPromise(this.#setupIndexOn(collection, existingIndexes));
  }

  async #configure() {
    const db = await this.#getDb();
    const collection = await this.#getCollection();
    await this.#enableChangeStreamPreAndPostImages(db, collection);
    if (this.#config.disableAudit !== true) {
      const auditCollection = await this.#getAuditCollection();
      await this.#enableChangeStreamPreAndPostImages(db, auditCollection);
    }
    await this.#configureIndexes(collection);
  }

  async #getAuditRecords(ids: string[]) {
    const collection = await this.#getAuditCollection();
    return (await collection.find({ _id: { $in: ids } }).toArray()).mapWithoutNull(dbUtils.deserialize);
  }

  async #writeRecords(records: RecordType[]) {
    if (records.length === 0) return;
    const collection = await this.#getCollection();
    await collection.bulkWrite(records.map(record => ({ replaceOne: { replacement: dbUtils.serialize(record), filter: { _id: record.id as any }, upsert: true } })));
  }

  async #writeAuditRecords(records: AuditOf<RecordType>[]) {
    if (records.length === 0) return;
    const collection = await this.#getAuditCollection();
    await collection.bulkWrite(records.map(record => ({ replaceOne: { replacement: dbUtils.serialize(record), filter: { _id: record.id as any }, upsert: true } })));
  }

}