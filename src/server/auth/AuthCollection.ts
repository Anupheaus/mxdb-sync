/**
 * Thin MongoDB wrapper for the `mxdb_authentication` collection.
 *
 * Intentionally NOT a ServerDbCollection — auth records should never be synced
 * to clients, and we don't need change streams or Atlas Admin-level index setup.
 *
 * Abstract generic base: subclasses bind a concrete TRecord type and may override
 * createIndexes() to add extra indices (call super.createIndexes() first).
 */

import type { Collection } from 'mongodb';
import type { SocketAPIAuthRecord, SocketAPIAuthStore } from '@anupheaus/socket-api/common/auth';
import type { ServerDb } from '../providers';

const COLLECTION_NAME = 'mxdb_authentication';

type AuthDoc<TRecord extends SocketAPIAuthRecord> = Omit<TRecord, 'requestId'> & { _id: string };

function toDoc<TRecord extends SocketAPIAuthRecord>(record: TRecord): AuthDoc<TRecord> {
  const { requestId, ...rest } = record;
  return { _id: requestId, ...rest } as AuthDoc<TRecord>;
}

function fromDoc<TRecord extends SocketAPIAuthRecord>(doc: AuthDoc<TRecord>): TRecord {
  const { _id, ...rest } = doc;
  return { requestId: _id, ...rest } as TRecord;
}

export abstract class AuthCollection<TRecord extends SocketAPIAuthRecord>
  implements SocketAPIAuthStore<TRecord> {

  constructor(db: ServerDb) {
    this._coll = this.#init(db);
  }

  // Protected so subclasses can reach into it for extra queries.
  protected _coll: Promise<Collection<AuthDoc<TRecord>>>;

  async #init(serverDb: ServerDb): Promise<Collection<AuthDoc<TRecord>>> {
    const db = await serverDb.getMongoDb();
    const names = await db.listCollections({ name: COLLECTION_NAME }).toArray();
    if (names.length === 0) {
      const coll = await db.createCollection<AuthDoc<TRecord>>(COLLECTION_NAME);
      await this.createIndexes(coll);
      return coll;
    }
    return db.collection<AuthDoc<TRecord>>(COLLECTION_NAME);
  }

  // Non-abstract so subclasses can call super.createIndexes() before adding their own.
  protected async createIndexes(coll: Collection<AuthDoc<TRecord>>): Promise<void> {
    await coll.createIndex({ userId: 1 });
    await coll.createIndex({ sessionToken: 1 }, { sparse: true });
    await coll.createIndex({ deviceId: 1 }, { sparse: true });
  }

  async create(record: TRecord): Promise<void> {
    const coll = await this._coll;
    await coll.insertOne(toDoc(record) as any);
  }

  async findById(requestId: string): Promise<TRecord | undefined> {
    const coll = await this._coll;
    const doc = await coll.findOne({ _id: requestId } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findBySessionToken(token: string): Promise<TRecord | undefined> {
    const coll = await this._coll;
    const doc = await coll.findOne({ sessionToken: token } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined> {
    const coll = await this._coll;
    const doc = await coll.findOne({ userId, deviceId } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  // Not part of SocketAPIAuthStore — internal helper for device management and subclasses.
  async findAllByUserId(userId: string): Promise<TRecord[]> {
    const coll = await this._coll;
    const docs = await coll.find({ userId } as any).toArray();
    return docs.map(fromDoc);
  }

  async update(requestId: string, patch: Partial<TRecord>): Promise<void> {
    const coll = await this._coll;
    const setFields: Record<string, unknown> = {};
    const unsetFields: Record<string, 1> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unsetFields[key] = 1;
      else setFields[key] = value;
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(setFields).length > 0) update['$set'] = setFields;
    if (Object.keys(unsetFields).length > 0) update['$unset'] = unsetFields;
    if (Object.keys(update).length > 0) {
      await coll.updateOne({ _id: requestId } as any, update);
    }
  }
}
