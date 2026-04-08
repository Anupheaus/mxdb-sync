import { MongoClient } from 'mongodb';
import { E2E_MONGO_DB_NAME } from './mongoConstants';
import type { E2eTestMetadata, E2eTestRecord } from './e2eTestFixture';
import { e2eTestCollection } from './e2eTestFixture';

type Doc = {
  _id: string;
  clientId: string;
  testDate: number;
  name?: string;
  metadata?: E2eTestMetadata;
  tags?: string[];
  value?: string;
};

export interface ReadServerRecordsOptions {
  /** Mongo collection name (default: {@link e2eTestCollection}). */
  liveCollectionName?: string;
  dbName?: string;
}

/**
 * Read all documents from a live collection as {@link E2eTestRecord} (default: `e2eTest` fixture shape).
 */
export async function readServerRecords(
  mongoUri: string,
  options?: ReadServerRecordsOptions,
): Promise<E2eTestRecord[]> {
  const collName = options?.liveCollectionName ?? e2eTestCollection.name;
  const dbName = options?.dbName ?? E2E_MONGO_DB_NAME;
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const coll = db.collection<Doc>(collName);
    const docs = await coll.find({}).toArray();
    return docs.map(doc => {
      const record: E2eTestRecord = {
        id: doc._id,
        clientId: doc.clientId,
        testDate: doc.testDate,
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
