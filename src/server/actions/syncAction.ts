import { is, type Record } from '@anupheaus/common';
import { mxdbSyncCollectionAction } from '../../common/internalActions';
import type { MXDBSyncRequestRecord, MXDBSyncServerRecord } from '../../common/internalModels';
import { useCollection } from '../collections';
import { useSyncTools } from '../../common';
import { createServerAction, useLogger } from '@anupheaus/socket-api/server';
import { useDb } from '../providers';
import { useClient } from '../hooks';

function mergeSyncRecords<RecordType extends Record>(existingSyncRecord: MXDBSyncServerRecord<RecordType>, syncRecord: MXDBSyncRequestRecord<RecordType>): MXDBSyncServerRecord<RecordType> {
  return {
    ...existingSyncRecord,
    audit: {
      ...existingSyncRecord.audit,
      ...syncRecord.audit,
    },
  };
}

export const serverSyncAction = createServerAction(mxdbSyncCollectionAction, async ({ collectionName, records }) => {
  const { collection } = useCollection(collectionName);
  const { syncRecords, addExistingClientIds } = useClient();
  const rawLogger = useLogger();
  const logger = rawLogger.createSubLogger(collection.name).createSubLogger('Synchronise');
  const { getCollections, getMatchingRecords, bulkWrite } = useDb();
  const { createRecordFromSyncRecord } = useSyncTools();
  const { dataCollection, syncCollection } = getCollections(collection);
  const matchingDataRecords = await getMatchingRecords(dataCollection, records);
  const matchingSyncRecords = await getMatchingRecords(syncCollection, records);
  const dataRecordsToUpdate: Record[] = [];
  const clientDataRecordsToUpdate: Record[] = [];
  const updatedSyncRecords: MXDBSyncServerRecord[] = [];
  const removedRecordIds: string[] = [];
  const addClientRecordIds: string[] = [];
  logger.debug('Synchronising records...', { records: records.length });
  if (records.length === 0) return;
  records.forEach(syncRecord => {
    addClientRecordIds.push(syncRecord.id);
    try {
      const matchingSyncRecord = matchingSyncRecords.findById(syncRecord.id);
      const clientDataRecord = createRecordFromSyncRecord(syncRecord);
      if (matchingSyncRecord == null) {
        updatedSyncRecords.push(syncRecord);
        if (!clientDataRecord) {
          logger.silly(`New record "${syncRecord.id}" has been pushed from client, but last update was a deletion.  Recorded but now asking client to remove.`);
          removedRecordIds.push(syncRecord.id);
          return;
        }
        logger.silly(`Record "${syncRecord.id}" is a new record from the client.`);
        dataRecordsToUpdate.push(clientDataRecord);
      } else {
        const matchingDataRecord = matchingDataRecords.findById(syncRecord.id);
        const mergedSyncRecord = mergeSyncRecords(matchingSyncRecord, syncRecord);
        if (!is.deepEqual(matchingSyncRecord, mergedSyncRecord)) updatedSyncRecords.push(mergedSyncRecord);
        const newDataRecord = createRecordFromSyncRecord(mergedSyncRecord);
        if (!newDataRecord) {
          logger.silly(`Record "${syncRecord.id}" has been deleted, updating client.`, { syncRecord });
          removedRecordIds.push(syncRecord.id);
          return;
        }
        // if (syncRecord.id === 'f67089d8-f658-4db0-919d-e6235fe3ead6') {
        //   console.log('check', {
        //     clientDataRecord, matchingDataRecord, newDataRecord, matchingSyncRecord, syncRecord, mergedSyncRecord, isServerEqual: is.deepEqual(matchingDataRecord, newDataRecord),
        //     isClientEqual: is.deepEqual(clientDataRecord, newDataRecord)
        //   });
        // }
        if (!is.deepEqual(clientDataRecord, newDataRecord)) clientDataRecordsToUpdate.push(newDataRecord);
        if (!is.deepEqual(matchingDataRecord, newDataRecord)) dataRecordsToUpdate.push(newDataRecord);
      }
    } catch (error) {
      logger.error('Error synchronising record', { syncRecord, error });
    }
  });

  // add the client ids to the collection so that any changes being stored are pushed out to the client
  addExistingClientIds(collection, addClientRecordIds);
  logger.debug('Bulk writing updated and new records...', { updatedRecords: dataRecordsToUpdate.length });
  await bulkWrite(dataCollection, dataRecordsToUpdate);
  logger.debug('Bulk writing synchronisation records...', { syncRecords: updatedSyncRecords.length });
  bulkWrite(syncCollection, updatedSyncRecords); // do not wait on these to complete
  logger.debug('Pushing synchronisation results out to client', { updatedRecords: clientDataRecordsToUpdate.length, removedRecords: removedRecordIds.length });
  // if updates have been made to the database, then we do not need to push them out here because the database change will push them out, unless no changes have been made and we have to remove some ids, then
  // force a push out to the client
  if (dataRecordsToUpdate.length === 0 || removedRecordIds.length > 0) await syncRecords(collection, clientDataRecordsToUpdate, removedRecordIds, true);
});