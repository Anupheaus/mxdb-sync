import type { Record } from '@anupheaus/common';
import { mxdbSyncCollectionAction } from '../../common/internalActions';
import type { MXDBSyncServerRecord } from '../../common/internalModels';
import { useCollection } from '../collections';
import { useAuditTools } from '../hooks';
import { useClient, useDb, useLogger } from '../providers';
import { createServerAction } from './createServerAction';
import { isNewer } from '../../common';

export const serverSyncAction = createServerAction(mxdbSyncCollectionAction, async ({ collectionName, records }) => {
  const { collection } = useCollection(collectionName);
  const { syncRecords, addExistingClientIds } = useClient();
  const rawLogger = useLogger();
  const logger = rawLogger.createSubLogger(collection.name).createSubLogger('Synchronise');
  const { getCollections, getMatchingRecords, bulkWrite } = useDb();
  const { createRecordFromSyncRecord, mergeSyncRecords, isNewRecord } = useAuditTools();
  const { dataCollection, syncCollection } = getCollections(collection);
  const matchingSyncRecords = await getMatchingRecords(syncCollection, records);
  const updatedRecords: Record[] = [];
  const updatedSyncRecords: MXDBSyncServerRecord[] = [];
  const removedRecordIds: string[] = [];
  const addClientRecordIds: string[] = [];
  logger.debug('Synchronising records...', { records: records.length });
  if (records.length === 0) return;
  records.forEach(record => {
    try {
      const matchingSyncRecord = matchingSyncRecords.findById(record.id);
      if (matchingSyncRecord == null) {
        if (isNewRecord(record)) {
          const newRecord = createRecordFromSyncRecord(record);
          updatedSyncRecords.push(record);
          if (!newRecord) {
            logger.silly(`New record "${record.id}" has been pushed from client, but last update was a deletion.  Recorded but now asking client to remove.`);
            removedRecordIds.push(record.id);
            return;
          }
          logger.silly(`Record "${record.id}" is a new record from the client.`);
          updatedRecords.push(newRecord);
          addClientRecordIds.push(newRecord.id);
        } else {
          logger.error('Record not found in sync collection and is not a new record from the client.', { record });
          removedRecordIds.push(record.id);
        }
      } else {
        const syncRecord = mergeSyncRecords(matchingSyncRecord.original, matchingSyncRecord, record);
        updatedSyncRecords.push(syncRecord);
        const updatedRecord = createRecordFromSyncRecord(syncRecord);
        if (!updatedRecord) {
          logger.silly(`Record "${record.id}" has been deleted, updating client.`, { syncRecord });
          removedRecordIds.push(record.id);
          return;
        }
        addClientRecordIds.push(updatedRecord.id);
        if (!isNewer(syncRecord, record.lastSyncTimestamp)) return;
        updatedRecords.push(updatedRecord);
      }
    } catch (error) {
      logger.error('Error synchronising record', { record, error });
    }
  });

  logger.debug('Bulk writing updated and new records...', { updatedRecords: updatedRecords.length });
  await bulkWrite(dataCollection, updatedRecords);
  logger.debug('Bulk writing synchronisation records...', { syncRecords: syncRecords.length });
  bulkWrite(syncCollection, updatedSyncRecords); // do not wait on these to complete
  logger.debug('Pushing synchronisation results out to client', { updatedRecords: updatedRecords.length, removedRecords: removedRecordIds.length });
  if (updatedRecords.length != addClientRecordIds.length) addExistingClientIds(collection, addClientRecordIds);
  await syncRecords(collection, updatedRecords, removedRecordIds, true);
});