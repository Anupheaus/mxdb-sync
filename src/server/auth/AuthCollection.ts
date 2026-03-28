/**
 * §4.4 — Thin MongoDB wrapper for the `mxdb_authentication` collection.
 *
 * Intentionally NOT a ServerDbCollection — auth records should never be synced
 * to clients, and we don't need change streams or Atlas Admin-level index setup.
 */

import type { Collection } from 'mongodb';
import type { MXDBAuthRecord } from '../../common/models';
import type { ServerDb } from '../providers';

const COLLECTION_NAME = 'mxdb_authentication';

type AuthDoc = Omit<MXDBAuthRecord, 'requestId'> & { _id: string; };

function toDoc(record: MXDBAuthRecord): AuthDoc {
  const { requestId, ...rest } = record;
  return { _id: requestId, ...rest };
}

function fromDoc(doc: AuthDoc): MXDBAuthRecord {
  const { _id, ...rest } = doc;
  return { requestId: _id, ...rest };
}

export class AuthCollection {
  constructor(db: ServerDb) {
    this.#coll = this.#getOrCreateCollection(db);
  }

  #coll: Promise<Collection<AuthDoc>>;

  async #getOrCreateCollection(serverDb: ServerDb): Promise<Collection<AuthDoc>> {
    const db = await serverDb.getMongoDb();
    const names = await db.listCollections({ name: COLLECTION_NAME }).toArray();
    if (names.length === 0) {
      const coll = await db.createCollection<AuthDoc>(COLLECTION_NAME);
      await coll.createIndex({ userId: 1 });
      await coll.createIndex({ currentToken: 1 }, { sparse: true });
      await coll.createIndex({ pendingToken: 1 }, { sparse: true });
      await coll.createIndex({ keyHash: 1 }, { sparse: true });
      return coll;
    }
    return db.collection<AuthDoc>(COLLECTION_NAME);
  }

  async create(record: MXDBAuthRecord): Promise<void> {
    const coll = await this.#coll;
    await coll.insertOne(toDoc(record));
  }

  async findByRequestId(requestId: string): Promise<MXDBAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ _id: requestId });
    return doc ? fromDoc(doc) : undefined;
  }

  async findByRegistrationToken(registrationToken: string): Promise<MXDBAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ registrationToken });
    return doc ? fromDoc(doc) : undefined;
  }

  /** Looks up a record by `pendingToken` or `currentToken` (checked in that order). */
  async findByToken(token: string): Promise<MXDBAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ $or: [{ pendingToken: token }, { currentToken: token }] } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByKeyHash(keyHash: string): Promise<MXDBAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ keyHash } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByUserId(userId: string): Promise<MXDBAuthRecord[]> {
    const coll = await this.#coll;
    const docs = await coll.find({ userId } as any).toArray();
    return docs.map(fromDoc);
  }

  async update(requestId: string, patch: Partial<Omit<MXDBAuthRecord, 'requestId'>>): Promise<void> {
    const coll = await this.#coll;
    // Build $set and $unset from the patch
    const setFields: Record<string, unknown> = {};
    const unsetFields: Record<string, 1> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        unsetFields[key] = 1;
      } else {
        setFields[key] = value;
      }
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(setFields).length > 0) update['$set'] = setFields;
    if (Object.keys(unsetFields).length > 0) update['$unset'] = unsetFields;
    if (Object.keys(update).length > 0) {
      await coll.updateOne({ _id: requestId } as any, update);
    }
  }
}
