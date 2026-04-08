import { MongoClient } from 'mongodb';
import { E2E_MONGO_DB_NAME } from './mongoConstants';
import { e2eTestCollection } from './e2eTestFixture';

export interface ClearLiveAndAuditOptions {
  /** Live collection name (audit collection is `{name}_sync`). Default: {@link e2eTestCollection}. */
  liveCollectionName?: string;
  dbName?: string;
}

/**
 * Remove all documents from a live collection and its `_sync` audit companion.
 * Default: {@link e2eTestCollection} in {@link E2E_MONGO_DB_NAME}.
 */
export async function clearLiveAndAuditCollections(
  mongoUri: string,
  options?: ClearLiveAndAuditOptions,
): Promise<void> {
  const live = options?.liveCollectionName ?? e2eTestCollection.name;
  const dbName = options?.dbName ?? E2E_MONGO_DB_NAME;
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.collection(live).deleteMany({});
    await db.collection(`${live}_sync`).deleteMany({});
  } finally {
    await client.close();
  }
}

/** @inheritdoc clearLiveAndAuditCollections — default `e2eTest` fixture only. */
export async function clearE2eTestCollections(mongoUri: string): Promise<void> {
  await clearLiveAndAuditCollections(mongoUri);
}
