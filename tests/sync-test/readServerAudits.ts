import { MongoClient } from 'mongodb';
import type { ServerAuditOf } from '../../src/common';
import { dbUtils } from '../../src/server/providers/db/db-utils';
import type { SyncTestRecord } from './types';

const MONGO_DB_NAME = 'mxdb-sync-test';

/**
 * Load all persisted audit documents from Mongo `{liveCollectionName}_sync`
 * (same companion as {@link ServerDbCollection}’s `#getAuditCollection`).
 */
export async function readServerAuditDocuments(
  mongoUri: string,
  liveCollectionName: string,
): Promise<Map<string, ServerAuditOf<SyncTestRecord>>> {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    const coll = db.collection(`${liveCollectionName}_sync`);
    const docs = await coll.find({}).toArray();
    const map = new Map<string, ServerAuditOf<SyncTestRecord>>();
    for (const doc of docs) {
      const des = dbUtils.deserialize(doc as never) as ServerAuditOf<SyncTestRecord> | undefined;
      if (des?.id != null) map.set(des.id, des);
    }
    return map;
  } finally {
    await client.close();
  }
}
