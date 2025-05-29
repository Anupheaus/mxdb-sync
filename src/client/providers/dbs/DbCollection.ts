import type { AuditOf, DataFilters, DataRequest, Record, Unsubscribe } from '@anupheaus/common';
import { auditor, bind, DataSorts, is } from '@anupheaus/common';
import { utils } from './utils';
import { deserialise } from './transforms';
import type { DistinctProps, DistinctResults, MXDBCollectionConfig, QueryResults } from '../../../common/models';
import type { MXDBCollectionEvent } from './models';
import { SYNC_COLLECTION_SUFFIX } from './dbs-consts';
import sift, { type Query as Filter } from 'sift';

export interface UpsertConfig {
  auditAction?: 'branched' | 'default';
  ifHasHistory?: 'default' | 'doNotUpsert';
}

export interface DeleteConfig {
  keepIfHasHistory?: boolean;
  auditAction?: 'remove' | 'default';
}

export class DbCollection<RecordType extends Record = Record> {
  constructor(db: Promise<IDBDatabase>, config: MXDBCollectionConfig<RecordType>) {
    this.#name = config.name;
    this.#isAudited = config.disableAudit !== true;
    this.#db = db;
    this.#records = new Map();
    this.#auditRecords = new Map();
    this.#callbacks = new Set();
    this.#loadingPromise = this.#loadData();
  }

  #name: string;
  #isAudited: boolean;
  #db: Promise<IDBDatabase>;
  #records: Map<string, RecordType>;
  #auditRecords: Map<string, AuditOf<RecordType>>;
  #loadingPromise: Promise<void>;
  #callbacks: Set<(event: MXDBCollectionEvent<RecordType>) => void>;

  public get name() { return this.#name; }

  @bind
  public async getAll(): Promise<RecordType[]> {
    await this.#loadingPromise;
    return Array.from(this.#records.values());
  }

  public async upsert(record: RecordType, userId: string, config?: UpsertConfig): Promise<void>;
  public async upsert(records: RecordType[], userId: string, config?: UpsertConfig): Promise<void>;
  @bind
  public async upsert(records: RecordType | RecordType[], userId: string, config?: UpsertConfig): Promise<void> {
    await this.#loadingPromise;
    if (!Array.isArray(records)) return this.upsert([records].removeNull(), userId, config);
    if (records.length === 0) return;
    const { auditAction = 'default', ifHasHistory = 'default' } = config ?? {};
    const upsertedRecords: RecordType[] = [];
    const auditRecords = records.mapWithoutNull(record => {
      const oldRecord = this.#records.get(record.id);
      if (is.deepEqual(oldRecord, record)) return;
      if (this.#isAudited && ifHasHistory === 'doNotUpsert') {
        const auditRecord = this.#auditRecords.get(record.id);
        if (auditRecord && auditor.hasHistory(auditRecord)) return;
      }
      this.#records.set(record.id, record);
      upsertedRecords.push(record);
      if (this.#isAudited === false) return;
      const auditRecord = this.#auditRecords.get(record.id);
      const updatedAuditRecord = (() => {
        if (auditRecord != null) return auditor.updateAuditWith(record, auditRecord, userId);
        if (auditAction === 'branched') return auditor.createBranchFrom(record);
        return auditor.createAuditFrom(record, userId);
      })();
      this.#auditRecords.set(record.id, updatedAuditRecord);
      return updatedAuditRecord;
    });
    if (upsertedRecords.length === 0) return;
    this.#upsert(upsertedRecords, auditRecords);
    this.#invokeOnChange({ type: 'upsert', records: upsertedRecords, auditAction });
  }

  public async get(id: string): Promise<RecordType | undefined>;
  public async get(ids: string[]): Promise<RecordType[]>;
  @bind
  public async get(idOrIds: string | string[]): Promise<RecordType | RecordType[] | undefined> {
    await this.#loadingPromise;
    if (!Array.isArray(idOrIds)) return this.#records.get(idOrIds);
    return idOrIds.map(id => this.#records.get(id)).removeNull();
  }

  public async delete(id: string, userId: string, config?: DeleteConfig): Promise<boolean>;
  public async delete(ids: string[], userId: string, config?: DeleteConfig): Promise<boolean>;
  public async delete(record: RecordType, userId: string, config?: DeleteConfig): Promise<boolean>;
  public async delete(records: RecordType[], userId: string, config?: DeleteConfig): Promise<boolean>;
  @bind
  public async delete(idsOrRecords: string | string[] | RecordType | RecordType[], userId: string, config?: DeleteConfig): Promise<boolean> {
    await this.#loadingPromise;
    if (!Array.isArray(idsOrRecords)) return this.delete([idsOrRecords].removeNull() as any, userId, config);
    if (idsOrRecords.length === 0) return false;
    const { auditAction = 'default', keepIfHasHistory = false } = config ?? {};
    const idsToDelete = idsOrRecords.mapWithoutNull(idOrRecord => {
      const id = is.not.blank(idOrRecord) ? idOrRecord : idOrRecord.id;
      const record = this.#records.get(id);
      if (record == null) return;
      if (this.#isAudited && keepIfHasHistory === true) {
        const auditRecord = this.#auditRecords.get(id);
        if (auditRecord && auditor.hasHistory(auditRecord)) return;
      }
      this.#records.delete(id);
      if (this.#isAudited === false) return id;
      const auditRecord = this.#auditRecords.get(id);
      if (auditRecord == null) return id;
      const deletedAuditRecord = auditor.delete(auditRecord, userId);
      if (auditAction === 'default') {
        this.#auditRecords.set(id, deletedAuditRecord);
      } else if (auditAction === 'remove') {
        this.#auditRecords.delete(id);
      }
      return id;
    });
    if (idsToDelete.length === 0) return false;
    await this.#delete(idsToDelete, auditAction === 'remove' ? 'remove' : 'markAsDeleted');
    this.#invokeOnChange({ type: 'remove', ids: idsToDelete, auditAction: auditAction === 'remove' ? 'remove' : 'markAsDeleted' });
    return true;
  }

  @bind
  public async query({ filters, pagination, sorts }: DataRequest<RecordType>): Promise<QueryResults<RecordType>> {
    await this.#loadingPromise;
    let records = await this.getAll();
    const mongoFilters = this.#parseFilters(filters);
    if (mongoFilters != null) records = records.filter(sift(mongoFilters));
    if (sorts) records = DataSorts.applyTo(records, sorts);
    const total = records.length;
    if (pagination) {
      const start = pagination.offset ?? 0;
      const end = start + pagination.limit;
      records = records.slice(start, end);
    }
    return { records, total };
  }

  @bind
  public async distinct<Key extends keyof RecordType>({ field, filters, sorts }: DistinctProps<RecordType, Key>): Promise<DistinctResults<RecordType, Key>> {
    await this.#loadingPromise;
    const { records } = await this.query({ filters, sorts });
    return records.distinct(record => record[field]).map(record => record[field]);
  }

  @bind
  public async clear(auditAction: 'preserveWithHistory' | 'all' = 'preserveWithHistory'): Promise<void> {
    await this.#loadingPromise;
    if (this.#isAudited && auditAction === 'preserveWithHistory') {
      const recordIdsToClear = this.#auditRecords.toValuesArray().mapWithoutNull(auditRecord => !auditor.hasHistory(auditRecord) ? auditRecord.id : undefined);
      recordIdsToClear.forEach(id => {
        this.#records.delete(id);
        this.#auditRecords.delete(id);
      });
      this.#delete(recordIdsToClear, 'remove');
      this.#invokeOnChange({ type: 'clear', ids: recordIdsToClear });
    }
    const ids = Array.from(this.#records.keys());
    this.#records.clear();
    if (this.#isAudited) this.#auditRecords.clear();
    this.#clear();
    this.#invokeOnChange({ type: 'clear', ids });
  }

  @bind
  public async count(): Promise<number> {
    await this.#loadingPromise;
    return this.#records.size;
  }

  @bind
  public async exists(id: string): Promise<boolean> {
    await this.#loadingPromise;
    return this.#records.has(id);
  }

  @bind
  public async getAllAudits(request: 'all' | 'withHistory' = 'all'): Promise<AuditOf<RecordType>[]> {
    await this.#loadingPromise;
    if (this.#isAudited === false) return [];
    if (request === 'all') return this.#auditRecords.toValuesArray();
    return this.#auditRecords.toValuesArray().filter(auditRecord => auditor.hasHistory(auditRecord));
  }

  public async resetAuditsOn(id: string): Promise<void>;
  public async resetAuditsOn(ids: string[]): Promise<void>;
  public async resetAuditsOn(record: RecordType): Promise<void>;
  public async resetAuditsOn(records: RecordType[]): Promise<void>;
  public async resetAuditsOn(auditRecord: AuditOf<RecordType>): Promise<void>;
  public async resetAuditsOn(auditRecords: AuditOf<RecordType>[]): Promise<void>;
  @bind
  public async resetAuditsOn(arg: string | string[] | RecordType | RecordType[] | AuditOf<RecordType> | AuditOf<RecordType>[]): Promise<void> {
    await this.#loadingPromise;
    if (this.#isAudited === false) return;
    const values = (!Array.isArray(arg) ? [arg] : arg).removeNull();
    if (values.length === 0) return;
    // existing audit records
    const newAuditRecords = values.mapWithoutNull(value => {
      const id = is.string(value) ? value : value.id;
      const record = this.#records.get(id);
      if (record == null) return;
      const newAuditRecord = auditor.createBranchFrom(record);
      this.#auditRecords.set(id, newAuditRecord);
      return newAuditRecord;
    });
    if (newAuditRecords.length > 0) this.#upsertAudits(newAuditRecords);
    // removed audit records
    const removedAuditRecords = values.mapWithoutNull(value => {
      const id = is.string(value) ? value : value.id;
      const auditRecord = this.#auditRecords.get(id);
      if (!auditRecord || !auditor.isDeleted(auditRecord)) return;
      return auditRecord.id;
    });
    if (removedAuditRecords.length > 0) this.#delete(removedAuditRecords, 'remove');
  }

  @bind
  public onChange(callback: (event: MXDBCollectionEvent<RecordType>) => void): Unsubscribe {
    this.#callbacks.add(callback);
    return () => this.#callbacks.delete(callback);
  }

  #invokeOnChange(event: MXDBCollectionEvent<RecordType>) {
    this.#callbacks.forEach(callback => callback(event));
  }

  async #loadRecordsFromDb<T extends Record>(collectionName: string): Promise<Map<string, T>> {
    const db = await this.#db;
    const transaction = db.transaction(collectionName, 'readonly');
    const store = transaction.objectStore(collectionName);
    const records = await utils.wrap(store.getAll());
    transaction.abort();
    return new Map(records.map(record => [record.id, deserialise(record)]));
  }

  async #loadData() {
    this.#records = await this.#loadRecordsFromDb(this.#name);
    if (this.#isAudited === true) {
      this.#auditRecords = await this.#loadRecordsFromDb(`${this.#name}${SYNC_COLLECTION_SUFFIX}`);
    }
  }

  async #upsert(records: RecordType[], auditRecords: AuditOf<RecordType>[]) {
    const db = await this.#db;
    utils.upsertRecordUsingWebWorker(db.name, this.#name, records);
    if (auditRecords.length > 0) utils.upsertRecordUsingWebWorker(db.name, `${this.#name}${SYNC_COLLECTION_SUFFIX}`, auditRecords);
  }

  async #delete(ids: string[], auditAction: 'markAsDeleted' | 'remove' = 'markAsDeleted') {
    const db = await this.#db;
    utils.deleteRecordUsingWebWorker(db.name, this.#name, ids);
    if (this.#isAudited === true) {
      if (auditAction === 'markAsDeleted') {
        const auditRecords = ids.mapWithoutNull(id => this.#auditRecords.get(id));
        utils.upsertRecordUsingWebWorker(db.name, `${this.#name}${SYNC_COLLECTION_SUFFIX}`, auditRecords);
      } else if (auditAction === 'remove') {
        utils.deleteRecordUsingWebWorker(db.name, `${this.#name}${SYNC_COLLECTION_SUFFIX}`, ids);
      }
    }
  }

  async #clear() {
    const db = await this.#db;
    utils.clearRecordUsingWebWorker(db.name, this.#name);
    utils.clearRecordUsingWebWorker(db.name, `${this.#name}${SYNC_COLLECTION_SUFFIX}`);
  }

  async #upsertAudits(auditRecords: AuditOf<RecordType>[]) {
    const db = await this.#db;
    utils.upsertRecordUsingWebWorker(db.name, `${this.#name}${SYNC_COLLECTION_SUFFIX}`, auditRecords);
  }

  #parseFilters(filters: DataFilters<RecordType> | undefined): Filter<RecordType> | undefined {
    if (filters == null) return;
    const clonedFilters = Object.clone(filters) as Filter<RecordType>;
    const parse = (target: unknown) => {
      if (!is.plainObject(target)) return;
      Object.entries(target).forEach(([key, value]) => {
        if (value === undefined) {
          Reflect.deleteProperty(target, key);
        } else {
          parse(value);
        }
      });
    };
    parse(clonedFilters);
    return clonedFilters;
  }

}
