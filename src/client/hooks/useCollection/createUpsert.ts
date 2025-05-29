import { useSync } from '../../providers';
import type { Logger, Record } from '@anupheaus/common';
import type { DbCollection } from '../../providers';

export function createUpsert<RecordType extends Record>(dbCollection: DbCollection<RecordType>, userId: string, logger: Logger) {
  const { finishSyncing } = useSync();

  async function upsert(record: RecordType): Promise<void>;
  async function upsert(records: RecordType[]): Promise<void>;
  async function upsert(records: RecordType | RecordType[]): Promise<void> {
    records = Array.isArray(records) ? records : [records].removeNull();
    if (records.length === 0) {
      logger.warn('Upsert requested with no records to upsert.', { collectionName: dbCollection.name });
      return;
    }
    await finishSyncing();
    logger.debug('Upserting records...', { records });
    await dbCollection.upsert(records, userId);
    logger.debug('Upsert completed.');
  }

  return upsert;
}