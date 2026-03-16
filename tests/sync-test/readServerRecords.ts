import { MongoClient } from 'mongodb';
import type { SyncTestRecord, SyncTestMetadata } from './types';

const MONGO_DB_NAME = 'mxdb-sync-test';

type Doc = {
  _id: string;
  clientId: string;
  updatedAt: number;
  name?: string;
  metadata?: SyncTestMetadata;
  tags?: string[];
  value?: string;
};

/**
 * Read all records from the server's syncTest collection via the Mongo URI (e.g. from MongoDB Memory Server).
 */
export async function readServerRecords(
  mongoUri: string,
): Promise<SyncTestRecord[]> {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    const coll = db.collection<Doc>('syncTest');
    const docs = await coll.find({}).toArray();
    return docs.map(doc => {
      const record: SyncTestRecord = {
        id: doc._id,
        clientId: doc.clientId,
        updatedAt: doc.updatedAt,
      };
      if (doc.name !== undefined) record.name = doc.name;
      if (doc.metadata !== undefined) record.metadata = doc.metadata;
      if (doc.tags !== undefined) record.tags = doc.tags;
      if (doc.value !== undefined) record.value = doc.value;
      return record;
    });
  } finally {
    await client.close();
  }
}
