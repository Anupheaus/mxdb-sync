import type { MXDBSyncedCollection } from '../common';
import { useSync } from './providers';
import type { Record } from '@anupheaus/common';
import { useDataCollection, useSyncCollection } from './useInternalCollections';
import { useLogger } from './logger';

export function createUpsert<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const logger = useLogger();
  const { upsert: mxdbUpsert } = useDataCollection(collection, dbName);
  const { upsert: syncUpsert } = useSyncCollection(collection, dbName);
  const { finishSyncing } = useSync();

  async function upsert(record: RecordType): Promise<void>;
  async function upsert(records: RecordType[]): Promise<void>;
  async function upsert(records: RecordType | RecordType[]): Promise<void> {
    records = Array.isArray(records) ? records : [records];
    if (records.length === 0) return;
    await finishSyncing();
    logger.debug('Upserting records...', records);
    await mxdbUpsert(records);
    logger.debug('Upserting sync records...', records);
    await syncUpsert(records);
    logger.debug('Upsert completed.');
  }

  return upsert;
}