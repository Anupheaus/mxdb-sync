import { mxdbUpsertAction, type MXDBSyncedCollection } from '../common';
import { useSync } from './providers';
import type { Record } from '@anupheaus/common';
import { useDataCollection, useSyncCollection } from './useInternalCollections';
import { useLogger } from './logger';
import { useAction } from './hooks';

export function createUpsert<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const logger = useLogger();
  const { upsert: mxdbUpsert } = useDataCollection(collection, dbName);
  const { upsert: syncUpsert, markAsSynced, unmarkAsSynced } = useSyncCollection(collection, dbName);
  const { mxdbUpsertAction: serverUpsert, isConnected } = useAction(mxdbUpsertAction);
  const { finishSyncing } = useSync();

  async function upsert(record: RecordType): Promise<void>;
  async function upsert(records: RecordType[]): Promise<void>;
  async function upsert(records: RecordType | RecordType[]): Promise<void> {
    records = Array.isArray(records) ? records : [records];
    if (records.length === 0) return;
    await finishSyncing();
    logger.debug('Upserting records...', { records });
    await mxdbUpsert(records);
    logger.debug('Upserting sync records...');
    await syncUpsert(records);
    if (isConnected()) {
      logger.debug('Upserting server records...', { records });
      // mark the records as synced so that when the server pushes an update, they will be overwritten by any changes made on the server
      const syncData = await markAsSynced(records);
      try {
        await serverUpsert({ collectionName: collection.name, records });
      } catch (error) {
        await unmarkAsSynced(syncData);
        throw error;
      }
    }
    logger.debug('Upsert completed.');
  }

  return upsert;
}