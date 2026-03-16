import { mxdbSyncCollectionsAction } from '../../common/internalActions';
import { createServerAction } from '@anupheaus/socket-api/server';
import { useClient } from '../hooks';
import { useDb } from '../providers';
import type { MXDBSyncId, MXDBSyncResponse } from '../../common/internalModels';
import type { Logger } from '@anupheaus/common';
import { auditor, is, useLogger, type AuditOf, type Record } from '@anupheaus/common';

interface ProcessIdsProps {
  ids: MXDBSyncId[];
  existingRecords: Record[];
  existingAudits: AuditOf<Record>[];
  removeIds: Set<string>;
  updateRecords: Map<string, Record>;
  logger: Logger;
  collectionName: string;
  ackIds: Set<string>;
}

export function processIds({ ids, existingRecords, existingAudits, removeIds, updateRecords, logger, collectionName, ackIds }: ProcessIdsProps) {
  // these ids are the ones that the client has downloaded before, so we need to check if they have been updated since then
  ids.forEach(({ id, timestamp }) => {
    const existingAudit = existingAudits.findById(id);
    const existingRecord = existingRecords.findById(id);

    if (existingAudit == null || existingRecord == null) {
      // there is no audit currently and this is one that thinks has been uploaded before, which is a bit weird, so let's remove the id from the front end
      removeIds.add(id);
    } else {
      const lastUpdatedDate = auditor.lastUpdated(existingAudit);
      if (lastUpdatedDate == null) {
        // there is an existing audit, but the last date can't be found, so raise an error
        logger.error(`Audit for record "${id}" in collection "${collectionName}" has no last updated date`);
      } else if (lastUpdatedDate > timestamp) {
        // the saved audit is newer than the client's audit, so we need to update the client
        updateRecords.set(id, existingRecord);
      } else {
        // The server audit has not changed, but the server's materialised record can drift
        // (e.g. a prior upsert/delete failed mid-flight). Enforce server audit -> record.
        const materialized = auditor.createRecordFrom(existingAudit);
        if (materialized == null) {
          removeIds.add(id);
        } else if (existingRecord == null || !is.deepEqual(existingRecord, materialized)) {
          updateRecords.set(id, materialized);
        }
        ackIds.add(id);
      }
    }
  });
}

interface ProcessUpdatesProps {
  audits: AuditOf<Record>[];
  existingAudits: AuditOf<Record>[];
  existingRecords: Record[];
  removeIds: Set<string>;
  updateRecords: Map<string, Record>;
  logger: Logger;
  collectionName: string;
  updateAudits: Map<string, AuditOf<Record>>;
  ackIds: Set<string>;
}

export function processUpdates({ audits, existingAudits, existingRecords, removeIds, updateRecords, logger, collectionName, updateAudits, ackIds }: ProcessUpdatesProps) {
  // these are the audits that need to be updated
  audits.forEach(audit => {
    const existingAudit = existingAudits.findById(audit.id);

    if (existingAudit == null) {
      // No existing audit on the server: this is the first time we see this id.
      // Treat the client's audit as the authoritative initial history; processAudits
      // will materialise or delete the record via auditor.createRecordFrom.
      if (!auditor.isAudit(audit)) {
        logger.error(`The new audit for a record in collection "${collectionName}" is not a valid audit object`, { audit });
        return;
      }
      updateAudits.set(audit.id, audit);
    } else {
      // Merge client's audit history with server's so the full sequence of user
      // changes is preserved. The auditor applies ops one-by-one and skips remove
      // when the path is already missing, so duplicate/out-of-order removes do not throw.

      // Detect potential conflicts by checking if timestamps overlap
      const clientLastTimestamp = auditor.lastUpdated(audit);
      const serverLastTimestamp = auditor.lastUpdated(existingAudit);

      if (clientLastTimestamp != null && serverLastTimestamp != null &&
        Math.abs(clientLastTimestamp - serverLastTimestamp) < 1000) {
        // Potential concurrent operation within 1 second - log for debugging
        logger.debug(`Potential concurrent operation detected for record "${audit.id}" in collection "${collectionName}"`, {
          clientTimestamp: clientLastTimestamp,
          serverTimestamp: serverLastTimestamp,
          clientId: (audit.history.last() as any)?.userId,
          serverAuditId: existingAudit.id
        });
      }

      // Extract the client's current record from their audit for validation
      const clientCurrentRecord = updateRecords.get(audit.id);
      if (clientCurrentRecord == null) {
        logger.error(`The client's current record for record "${audit.id}" in collection "${collectionName}" is not found`, { audit });
        return;
      }

      const mergedAudit = auditor.merge(existingAudit, audit, clientCurrentRecord);
      const mergedAuditDate = auditor.lastUpdated(mergedAudit);
      const existingAuditDate = auditor.lastUpdated(existingAudit);
      if (mergedAuditDate == null || existingAuditDate == null) {
        logger.error(`The merged audit date or the existing audit date for record "${audit.id}" in collection "${collectionName}" is not valid`, { mergedAuditDate, existingAuditDate });
      } else if (mergedAuditDate !== existingAuditDate) {
        updateAudits.set(audit.id, mergedAudit);
      } else {
        // Even if the audit itself is unchanged, the server's materialised record can drift.
        const existingRecord = existingRecords.findById(audit.id);
        const materialized = auditor.createRecordFrom(existingAudit);
        if (materialized == null) {
          removeIds.add(audit.id);
        } else if (existingRecord == null || !is.deepEqual(existingRecord, materialized)) {
          updateRecords.set(audit.id, materialized);
        }
        ackIds.add(audit.id);
      }
    }
  });
}

interface ProcessAuditsProps {
  audits: Map<string, AuditOf<Record>>;
  existingRecords: Record[];
  removeIds: Set<string>;
  updateRecords: Map<string, Record>;
}

export function processAudits({ audits, existingRecords, removeIds, updateRecords }: ProcessAuditsProps) {
  // just make sure that records are created from the audits provided
  audits.forEach(audit => {
    const existingRecord = existingRecords.findById(audit.id);
    const newRecord = auditor.createRecordFrom(audit);
    if (newRecord == null) {
      // the new record has been deleted, so we need to remove the id from the front end
      removeIds.add(audit.id);
    } else if (existingRecord == null) {
      // the record does not exist, so we need to create a new one
      updateRecords.set(audit.id, newRecord);
    } else {
      // the record exists, so we need to check if it has been updated
      if (is.deepEqual(existingRecord, newRecord)) return;
      updateRecords.set(audit.id, newRecord);
    }
  });
}

export const serverSyncAction = createServerAction(mxdbSyncCollectionsAction, async requests => {
  const db = useDb();
  const { syncRecords, addToClientIds } = useClient();
  const logger = useLogger();

  const result = await requests.mapAsync(async (request): Promise<MXDBSyncResponse> => {
    logger.info(`Syncing collection "${request.collectionName}"...`, request);
    try {
      const dbCollection = db.use(request.collectionName);
      const allIds = request.ids.ids().concat(request.updates.ids()).distinct();
      const existingRecords = await dbCollection.get(allIds);
      const existingAudits = await dbCollection.getAudit(allIds);
      const removeIds = new Set<string>();
      const updateRecords = new Map<string, Record>();
      const updateAudits = new Map<string, AuditOf<Record>>();
      const ackIds = new Set<string>();
      processIds({ ids: request.ids, existingRecords, existingAudits, removeIds, updateRecords, logger, collectionName: request.collectionName, ackIds });
      processUpdates({ audits: request.updates, existingAudits, existingRecords, removeIds, updateRecords, logger, collectionName: request.collectionName, updateAudits, ackIds });
      processAudits({ audits: updateAudits, existingRecords, removeIds, updateRecords });
      const updated = Array.from(updateRecords.values());
      const removedIds = Array.from(removeIds);
      const acknowledgedIds = Array.from(ackIds).concat(updated.ids()).concat(removedIds).distinct();
      const collection = dbCollection.collection;
      const updatedAudits = Array.from(updateAudits.values());
      logger.debug(`Sync plan for collection "${request.collectionName}"`, { updated, updatedAudits, removedIds, acknowledgedIds });
      if (updated.length > 0 || updatedAudits.length > 0 || removedIds.length > 0) await dbCollection.sync({ updated, updatedAudits, removedIds });
      // Structured log for test diagnostics: what the server actually persisted/removed
      logger.info('sync_complete', {
        collectionName: request.collectionName,
        updatedCount: updated.length,
        removedCount: removedIds.length,
        updatedIds: updated.ids().slice(0, 30),
        removedIds: removedIds.slice(0, 30),
        acknowledgedCount: acknowledgedIds.length,
      });
      // we add all of the ids to the client because the client has these records
      if (acknowledgedIds.length > 0) addToClientIds(collection, acknowledgedIds);
      logger.debug(`Sync complete, updating client for collection "${request.collectionName}"`, { updated, removedIds });
      if (updated.length > 0 || removedIds.length > 0) await syncRecords(collection, updated, removedIds);
      logger.info(`Sync complete for collection "${request.collectionName}"`, { acknowledgedIds });
      return { collectionName: request.collectionName, ids: acknowledgedIds };
    } catch (error) {
      logger.error(`Error syncing collection "${request.collectionName}"`, { error });
      throw error;
    }
  });
  return result;
});
