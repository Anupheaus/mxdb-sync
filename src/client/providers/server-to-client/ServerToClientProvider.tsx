import { createComponent, useLogger } from '@anupheaus/react-ui';
import { useServerActionHandler } from '@anupheaus/socket-api/client';
import { mxdbServerToClientSyncAction, auditor } from '../../../common';
import type { ServerToClientSyncAck, ServerToClientSyncAckItem, MXDBServerToClientSyncPayloadItem } from '../../../common/models';
import { useDb } from '../dbs';
import { useClientToServerSync, type ClientToServerSyncGate } from './useClientToServerSync';
import type { Logger } from '@anupheaus/common';

export const ServerToClientProvider = createComponent('ServerToClientProvider', () => {
  const { db } = useDb();
  const c2sGate = useClientToServerSync();
  const logger = useLogger();

  useServerActionHandler(mxdbServerToClientSyncAction)(async payload => {
    await c2sGate.waitForS2CGate();

    const ack: ServerToClientSyncAck = [];

    for (const item of payload) {
      const ackItem = await applyS2CItem(db, item, logger, c2sGate);
      ack.push(ackItem);
    }

    return ack;
  });

  return null;
});

/** Apply a single S2C payload item (one collection) and return the ack for it. */
async function applyS2CItem(
  db: ReturnType<typeof useDb>['db'],
  item: MXDBServerToClientSyncPayloadItem,
  logger: Logger,
  c2sGate: ClientToServerSyncGate,
): Promise<ServerToClientSyncAckItem> {
  const collection = db.use(item.collectionName);
  const successfulRecordIds: string[] = [];
  const deletedRecordIds: string[] = [];

  for (const { record, lastAuditEntryId } of item.updates) {
    try {
      const existingAudit = await collection.getAudit(record.id);
      if (existingAudit != null && auditor.hasPendingChanges(existingAudit)) {
        const isQueued = c2sGate.hasQueuedPendingForRecord(item.collectionName, record.id);
        if (!isQueued) {
          logger.error(
            'S2C skipped upsert: local audit has pending changes but record is not in C2S queue',
            { collectionName: item.collectionName, recordId: record.id, lastAuditEntryId },
          );
        } else {
          logger.debug('[s2c-conv] S2C update deferred: local audit has pending changes (queued for C2S)', {
            collectionName: item.collectionName, recordId: record.id, lastAuditEntryId,
          });
        }
        continue;
      }

      logger.debug('[s2c-conv] S2C applying update', { collectionName: item.collectionName, recordId: record.id, lastAuditEntryId });
      await collection.upsert(record as any, 'branched', lastAuditEntryId);
      successfulRecordIds.push(record.id);
    } catch {
      // Omit from ack — server will leave mirror unchanged
    }
  }

  for (const { recordId, lastAuditEntryId } of item.deletions) {
    try {
      const existingAudit = await collection.getAudit(recordId);
      if (existingAudit != null && auditor.hasPendingChanges(existingAudit)) {
        const isQueued = c2sGate.hasQueuedPendingForRecord(item.collectionName, recordId);
        if (!isQueued) {
          logger.error(
            'S2C skipped deletion: local audit has pending changes but record is not in C2S queue',
            { collectionName: item.collectionName, recordId, lastAuditEntryId },
          );
        } else {
          logger.debug('[s2c-conv] S2C deletion deferred: local audit has pending changes (queued for C2S)', {
            collectionName: item.collectionName, recordId, lastAuditEntryId,
            localEntries: existingAudit.entries.map((e: any) => `${e.type}:${e.id}`),
          });
        }
        continue;
      }

      logger.debug('[s2c-conv] S2C applying deletion', {
        collectionName: item.collectionName, recordId, lastAuditEntryId,
        hadLocalAudit: existingAudit != null,
      });
      if (existingAudit != null) {
        logger.silly(`Collapsing audit on "${recordId}" to "${lastAuditEntryId}"...`);
        await collection.collapseAudit(recordId, lastAuditEntryId);
      }
      logger.silly(`Deleting local record "${recordId}"...`);
      await collection.delete(recordId, { skipAuditAppend: true });
      await collection.removeAuditTrail(recordId);
      collection.notifyRemove([recordId], 'remove');
      deletedRecordIds.push(recordId);
      logger.silly(`Deleted local record "${recordId}".`);
    } catch (error) {
      logger.error('Failed to apply update from server.', { error, recordId, lastAuditEntryId });
      // Omit from ack
    }
  }

  return { collectionName: item.collectionName, successfulRecordIds, deletedRecordIds };
}
