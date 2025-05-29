import { configRegistry } from '../common/registries';
import { useCollection } from './collections';
import { Error, is, useLogger } from '@anupheaus/common';

import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../common';

interface EnsureCountProps<RecordType extends Record> {
  count: number;
  fixedRecords?: RecordType[];
  create(): RecordType;
  validate?(record: RecordType): RecordType | boolean | void;
}

function ensureCount<RecordType extends Record>({ getAll, upsert, remove }: ReturnType<typeof useCollection<RecordType>>) {
  return async ({ count, fixedRecords, create, validate }: EnsureCountProps<RecordType>) => {
    const storedRecords = await getAll();
    const recordIdsToUpsert = new Set<string>();
    const recordIdsToRemove = new Set<string>();

    const storedRecordIds = storedRecords.ids();
    let records = storedRecords.slice();
    if (fixedRecords != null && fixedRecords.length > 0) {
      const fixedRecordIds = fixedRecords.ids();
      const fixedRecordIdsToAdd = fixedRecordIds.except(storedRecordIds);
      recordIdsToUpsert.addMany(fixedRecordIdsToAdd);
      recordIdsToUpsert.addMany(fixedRecords.map(fixedRecord => {
        const existingStoredRecord = storedRecords.findById(fixedRecord.id);
        if (!existingStoredRecord) {
          records.push(fixedRecord);
          return fixedRecord.id;
        } else {
          if (is.deepEqual(existingStoredRecord, fixedRecord)) return;
          records = records.upsert(fixedRecord);
          return fixedRecord.id;
        }
      }).removeNull());
    }

    if (records.length > count) {
      const fixedIds = fixedRecords?.ids();
      const totalToRemoveCount = records.length - count;
      recordIdsToRemove.addMany((fixedIds == null ? records : records.filter(({ id }) => !fixedIds.includes(id))).slice(0, totalToRemoveCount).ids());
    }

    if (records.length < count) {
      const recordsToCreate = Array.ofSize(count - records.length).map(() => create());
      records = records.concat(recordsToCreate);
      recordIdsToUpsert.addMany(recordsToCreate.ids());
    }

    if (is.function(validate)) {
      await records.forEachPromise(async record => {
        if (recordIdsToRemove.has(record.id)) return;
        let validated = validate(record);
        if (validated === false) validated = { ...create(), id: record.id };
        if (validated == null || validated === true) return;
        records = records.upsert(validated);
        recordIdsToUpsert.add(validated.id);
      });
    }

    await upsert(records.filterByIds(recordIdsToUpsert.toArray()));
    await remove(recordIdsToRemove.toArray());

    records = records.filterByIds(recordIdsToUpsert.toArray());

    return records;
  };
}

function createSeedUseCollection() {
  return <RecordType extends Record>(collection: MXDBCollection<RecordType>) => {
    const result = useCollection<RecordType>(collection);

    return {
      ...result,
      ensureTotalCount: ensureCount<RecordType>(result),
    };
  };
}

export type UseSeedCollection = ReturnType<typeof createSeedUseCollection>;

export async function seedCollections(collections: MXDBCollection[]) {
  const logger = useLogger();
  logger.info('Seeding collections...');
  for (const collection of collections) {
    const config = configRegistry.get(collection);
    if (config == null) {
      logger.warn(`No config found for collection "${collection.name}", skipping seeding.`);
      return;
    }
    if (config.onSeed == null) continue;
    logger.silly(`Seeding "${collection.name}" collection...`);
    const startTime = Date.now();
    try {
      await config.onSeed(createSeedUseCollection());
      logger.debug(`Collection "${collection.name}" seeded (time taken: ${Date.now() - startTime}ms).`);
    } catch (error) {
      logger.error(`Error seeding collection "${collection.name}":`, { error: new Error({ error }) });
    }
  }
  logger.info('Collections seeded.');
}
