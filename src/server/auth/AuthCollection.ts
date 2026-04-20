/**
 * Thin MongoDB wrapper for the `mxdb_authentication` collection.
 *
 * Intentionally NOT a ServerDbCollection — auth records should never be synced
 * to clients, and we don't need change streams or Atlas Admin-level index setup.
 */

import type { Collection } from 'mongodb';
import type { WebAuthnAuthRecord, WebAuthnAuthStore } from '@anupheaus/socket-api/common/auth';
import type { ServerDb } from '../providers';

const COLLECTION_NAME = 'mxdb_authentication';

type AuthDoc = Omit<WebAuthnAuthRecord, 'requestId'> & { _id: string };

function toDoc(record: WebAuthnAuthRecord): AuthDoc {
  const { requestId, ...rest } = record;
  return { _id: requestId, ...rest };
}

function fromDoc(doc: AuthDoc): WebAuthnAuthRecord {
  const { _id, ...rest } = doc;
  return { requestId: _id, ...rest };
}

export class AuthCollection implements WebAuthnAuthStore {
  constructor(db: ServerDb) {
    this.#coll = this.#init(db);
  }

  #coll: Promise<Collection<AuthDoc>>;

  async #init(serverDb: ServerDb): Promise<Collection<AuthDoc>> {
    const db = await serverDb.getMongoDb();
    const names = await db.listCollections({ name: COLLECTION_NAME }).toArray();
    if (names.length === 0) {
      const coll = await db.createCollection<AuthDoc>(COLLECTION_NAME);
      await coll.createIndex({ userId: 1 });
      await coll.createIndex({ sessionToken: 1 }, { sparse: true });
      await coll.createIndex({ deviceId: 1 }, { sparse: true });
      await coll.createIndex({ keyHash: 1 }, { sparse: true });
      return coll;
    }
    return db.collection<AuthDoc>(COLLECTION_NAME);
  }

  async create(record: WebAuthnAuthRecord): Promise<void> {
    const coll = await this.#coll;
    await coll.insertOne(toDoc(record));
  }

  async findById(requestId: string): Promise<WebAuthnAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ _id: requestId } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findBySessionToken(token: string): Promise<WebAuthnAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ sessionToken: token } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByDevice(userId: string, deviceId: string): Promise<WebAuthnAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ userId, deviceId } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByRegistrationToken(registrationToken: string): Promise<WebAuthnAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ registrationToken } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined> {
    const coll = await this.#coll;
    const doc = await coll.findOne({ keyHash } as any);
    return doc ? fromDoc(doc) : undefined;
  }

  async findByUserId(userId: string): Promise<WebAuthnAuthRecord[]> {
    const coll = await this.#coll;
    const docs = await coll.find({ userId } as any).toArray();
    return docs.map(fromDoc);
  }

  async update(requestId: string, patch: Partial<WebAuthnAuthRecord>): Promise<void> {
    const coll = await this.#coll;
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
