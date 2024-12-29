import type { Record } from '@anupheaus/common';
import { mxdbSyncAction } from '../../common/internalActions';
import type { MXDBSyncServerRecord } from '../../common/internalModels';
import { useCollection } from '../collections';
import { useAuditTools, useClientTools } from '../hooks';
import { useDb, useLogger } from '../providers';
import { createServerAction } from './createServerAction';
import { isNewer } from '../../common';

export const serverSyncAction = createServerAction(mxdbSyncAction, async ({ collectionName, records }) => {
  const { collection } = useCollection(collectionName);
  const { logger: rawLogger } = useLogger();
  const logger = rawLogger.createSubLogger(collection.name).createSubLogger('Synchronise');
  const { getCollections, getMatchingRecords, bulkWrite } = useDb();
  const { createRecordFromSyncRecord, mergeSyncRecords, isNewRecord } = useAuditTools();
  const { addToClientIds } = useClientTools();
  const { dataCollection, syncCollection } = getCollections(collection);
  const matchingSyncRecords = await getMatchingRecords(syncCollection, records);
  // const matchingRecords = await getMatchingRecords(dataCollection, records);
  const syncRecords: MXDBSyncServerRecord[] = [];
  const updatedRecordIds: string[] = [];
  const updatedRecords: Record[] = [];
  const newRecordIds: string[] = [];
  const newRecords: Record[] = [];
  const removedRecordIds: string[] = [];
  logger.debug('Synchronising records...', { records: records.length });
  if (records.length === 0) return { updated: updatedRecords, savedIds: newRecordIds, removedIds: removedRecordIds };
  records.forEach(record => {
    try {
      const matchingSyncRecord = matchingSyncRecords.findById(record.id);
      if (matchingSyncRecord == null) {
        if (isNewRecord(record)) {
          const newRecord = createRecordFromSyncRecord(record);
          syncRecords.push(record);
          if (!newRecord) {
            logger.silly(`New record "${record.id}" has been pushed from client, but last update was a deletion.  Recorded but now asking client to remove.`);
            removedRecordIds.push(record.id);
            return;
          }
          logger.silly(`Record "${record.id}" is a new record from the client.`);
          newRecordIds.push(record.id);
          newRecords.push(newRecord);
        } else {
          logger.error('Record not found in sync collection and is not a new record from the client.', { record });
          removedRecordIds.push(record.id);
        }
      } else {
        const syncRecord = mergeSyncRecords(matchingSyncRecord.original, matchingSyncRecord, record);
        syncRecords.push(syncRecord);
        const updatedRecord = createRecordFromSyncRecord(syncRecord);
        if (!updatedRecord) {
          logger.silly(`Record "${record.id}" has been deleted, updating client.`, { syncRecord });
          removedRecordIds.push(record.id);
          return;
        }
        if (!isNewer(syncRecord, record.lastSyncTimestamp)) return;
        // const existingRecord = matchingRecords.findById(record.id);
        // if (record.id === '647b22bd-4b25-4d97-aadb-8f3ab9e27ed9') console.log('################', { updatedRecord, existingRecord });
        // if (is.deepEqual(updatedRecord, existingRecord)) return;
        updatedRecordIds.push(record.id);
        updatedRecords.push(updatedRecord);
      }
    } catch (error) {
      logger.error('Error synchronising record', { record, error });
    }
  });
  logger.debug('Bulk writing updated and new records...', { updatedRecords: updatedRecords.length, newRecords: newRecords.length });
  await bulkWrite(dataCollection, updatedRecords.concat(newRecords));
  logger.debug('Bulk writing synchronisation records...', { syncRecords: syncRecords.length });
  bulkWrite(syncCollection, syncRecords); // do not wait on these to complete
  addToClientIds(collection.name, records.mapWithoutNull(({ id }) => removedRecordIds.includes(id) ? undefined : id));
  logger.debug('Returning synchronisation results', { updatedRecords: updatedRecordIds.length, newRecords: newRecordIds.length, removedRecords: removedRecordIds.length });
  return { updated: updatedRecords, savedIds: newRecordIds, removedIds: removedRecordIds };
});