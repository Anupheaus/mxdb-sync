import { configRegistry } from '../common/registries';
import { useCollection } from './collections';
import { Error, InternalError, is, useLogger } from '@anupheaus/common';

import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../common';

interface EnsureCountPropsWithFixedRecords<RecordType extends Record> {
  count?: number;
  fixedRecords: RecordType[];
  create?(): RecordType;
  validate?(record: RecordType): RecordType | boolean | void;
}

interface EnsureCountPropsWithCreate<RecordType extends Record> {
  count: number;
  fixedRecords?: RecordType[];
  create(): RecordType;
  validate?(record: RecordType): RecordType | boolean | void;
}

type EnsureCountProps<RecordType extends Record> = EnsureCountPropsWithFixedRecords<RecordType> | EnsureCountPropsWithCreate<RecordType>;

function seedWith<RecordType extends Record>({ getAll, upsert, remove }: ReturnType<typeof useCollection<RecordType>>) {
  return async ({ count: providedCount, fixedRecords, create, validate }: EnsureCountProps<RecordType>) => {
    const count = providedCount ?? fixedRecords?.length;
    if (count == null) throw new InternalError('Count or Fixed Records is required for seeding.');
    const storedRecords = await getAll();
    const recordIdsToUpsert = new Set<string>();
    const recordIdsToRemove = new Set<string>();

    let records = storedRecords.slice();
    if (fixedRecords != null && fixedRecords.length > 0) {
      recordIdsToUpsert.addMany(fixedRecords.mapWithoutNull(fixedRecord => {
        const existingStoredRecord = storedRecords.findById(fixedRecord.id);
        if (!existingStoredRecord) {
          records.push(fixedRecord);
          return fixedRecord.id;
        } else {
          if (is.deepEqual(existingStoredRecord, fixedRecord)) return;
          records = records.repsert(fixedRecord);
          return fixedRecord.id;
        }
      }));
    }

    if (records.length > count) {
      const fixedIds = fixedRecords?.ids();
      const totalToRemoveCount = records.length - count;
      recordIdsToRemove.addMany((fixedIds == null ? records : records.filter(({ id }) => !fixedIds.includes(id))).slice(0, totalToRemoveCount).ids());
    }

    if (records.length < count) {
      if (!is.function(create)) throw new InternalError('Create function is required for seeding when count is greater than the number of records in the database.');
      const recordsToCreate = Array.ofSize(count - records.length).map(() => create());
      records = records.concat(recordsToCreate);
      recordIdsToUpsert.addMany(recordsToCreate.ids());
    }

    if (is.function(validate)) {
      await records.forEachAsync(async record => {
        if (recordIdsToRemove.has(record.id)) return;
        let validated = validate(record);
        if (validated === false) {
          if (!is.function(create)) throw new InternalError('Create function is required for seeding when validate returns false.');
          validated = { ...create(), id: record.id };
        }
        if (validated == null || validated === true) return;
        records = records.repsert(validated);
        recordIdsToUpsert.add(validated.id);
      });
    }

    records = records.filterByIds(recordIdsToUpsert.toArray());
    await upsert(records, { resetAudit: true });
    await remove(recordIdsToRemove.toArray(), { clearAudit: true });

    return records;
  };
}

function createSeedUseCollection() {
  return <RecordType extends Record>(collection: MXDBCollection<RecordType>) => {
    const result = useCollection<RecordType>(collection);

    return {
      ...result,
      seedWith: seedWith<RecordType>(result),
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
