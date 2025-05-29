import type { PromiseMaybe } from '@anupheaus/common';
import { InternalError, type Record } from '@anupheaus/common';
import { DbCollection } from './DbCollection';
import { utils } from './utils';
import type { MXDBCollectionConfig, MXDBCollectionIndex } from '../../../common/models';
import { SYNC_COLLECTION_SUFFIX } from './dbs-consts';

export class Db {
  constructor(name: string, collections: MXDBCollectionConfig[]) {
    this.#name = name;
    this.#db = this.#openDb(collections);
    this.#collections = new Map(collections.map(config => [config.name, new DbCollection(this.#db, config)]));
  }

  #name: string;
  #db: Promise<IDBDatabase>;
  #collections: Map<string, DbCollection>;

  public get name() { return this.#name; }

  public use<RecordType extends Record>(collectionName: string): DbCollection<RecordType> {
    const collection = this.#collections.get(collectionName) as DbCollection<RecordType> | undefined;
    if (collection == null) throw new InternalError(`Collection "${collectionName}" not found`);
    return collection;
  }

  public async close() {
    const db = await this.#db;
    db.close();
  }

  async #openDb(collections: MXDBCollectionConfig[], version?: number): Promise<IDBDatabase> {
    const request = window.indexedDB.open(this.#name, version);
    let hasUpgraded = false;
    request.onupgradeneeded = event => {
      const db = (event.target as any).result as IDBDatabase;
      this.#ensureSystemCollection(db);
      collections.forEach(this.#addCollection(db));
      this.#removeUnneededCollections(db, collections);
      hasUpgraded = true;
    };
    let db = await utils.wrap(request);
    if (hasUpgraded) await this.#updateSystemCollection(db, collections);
    if (await this.#validateCollections(db, collections)) return db;
    if (version != null) throw new InternalError(`Database "${this.#name}" attempted to reconfigure itself with new collections, but it failed to validate the new collections`);
    const nextVersion = db.version + 1;
    db.close();
    db = await this.#openDb(collections, nextVersion);
    await this.#updateSystemCollection(db, collections);
    return db;
  }

  #ensureSystemCollection(db: IDBDatabase) {
    if (db.objectStoreNames.contains('__mxdb')) return;
    db.createObjectStore('__mxdb', { keyPath: 'collectionName' });
  }

  async #openSystemCollection<T>(db: IDBDatabase, delegate: (store: IDBObjectStore) => PromiseMaybe<T>): Promise<T> {
    if (!db.objectStoreNames.contains('__mxdb')) throw new InternalError('System collection not found');
    const transaction = db.transaction('__mxdb', 'readwrite');
    const store = transaction.objectStore('__mxdb');
    try {
      return await delegate(store);
    } finally {
      transaction.commit();
    }
  }

  #addCollection(db: IDBDatabase) {
    return (collection: MXDBCollectionConfig) => {
      if (collection.disableAudit !== true) this.#addAuditCollection(db, collection.name);
      if (db.objectStoreNames.contains(collection.name)) return;
      const store = db.createObjectStore(collection.name, { keyPath: 'id' });
      this.#updateIndexes(store, collection.indexes ?? []);
    };
  }

  #addAuditCollection(db: IDBDatabase, collectionName: string) {
    const auditCollectionName = `${collectionName}${SYNC_COLLECTION_SUFFIX}`;
    if (db.objectStoreNames.contains(auditCollectionName)) return;
    db.createObjectStore(auditCollectionName, { keyPath: 'id' });
  }

  #removeUnneededCollections(db: IDBDatabase, collections: MXDBCollectionConfig[]) {
    const allCollectionNames = this.#getAllCollectionNames(collections);
    Array.from(db.objectStoreNames).filter(name => !allCollectionNames.includes(name) && name !== '__mxdb').forEach(name => db.deleteObjectStore(name));
  }

  #updateIndexes(store: IDBObjectStore, indexes: MXDBCollectionIndex[]) {
    const indexesToRemove = Array.from(store.indexNames).filter(name => indexes.findBy('name', name) == null);
    indexesToRemove.forEach(name => store.deleteIndex(name));
    indexes.forEach(index => store.createIndex(index.name, index.fields, { unique: index.isUnique }));
  }

  #getAllCollectionNames(collections: MXDBCollectionConfig[]): string[] {
    return collections.mapMany(({ name, disableAudit }) => [name, disableAudit !== true ? `${name}${SYNC_COLLECTION_SUFFIX}` : undefined].removeNull());
  }

  async #validateCollections(db: IDBDatabase, collections: MXDBCollectionConfig[]): Promise<boolean> {
    const allCollectionNames = this.#getAllCollectionNames(collections);
    if (db.objectStoreNames.length !== allCollectionNames.length + 1) return false;
    return this.#openSystemCollection(db, async systemCollection => {
      for (const collection of collections) {
        if (!db.objectStoreNames.contains(collection.name)) return false;
        const collectionData = await utils.wrap(systemCollection.get(collection.name));
        if (collectionData == null) return false;
        if (collectionData.hash != Object.hash(collection)) return false;
      }
      return true;
    });
  }

  async #updateSystemCollection(db: IDBDatabase, collections: MXDBCollectionConfig[]) {
    await this.#openSystemCollection(db, async systemCollection => {
      await utils.wrap(systemCollection.clear());
      await collections.forEachPromise(async collection => { await utils.wrap(systemCollection.put({ collectionName: collection.name, hash: Object.hash(collection) })); });
    });
  }
}
