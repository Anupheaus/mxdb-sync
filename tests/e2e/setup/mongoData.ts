import { MongoClient } from 'mongodb';

const MONGO_DB_NAME = 'mxdb-sync-test';

/**
 * Remove all documents from the sync-test live collection and its `_sync` audit companion.
 */
export async function clearSyncTestCollections(mongoUri: string): Promise<void> {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    await db.collection('syncTest').deleteMany({});
    await db.collection('syncTest_sync').deleteMany({});
  } finally {
    await client.close();
  }
}
