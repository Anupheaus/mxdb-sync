import { createComponent, useLogger } from '@anupheaus/react-ui';
import { useServerActionHandler } from '@anupheaus/socket-api/client';
import { mxdbServerToClientSyncAction, auditor } from '../../../common';
import type { ServerToClientSyncAck, ServerToClientSyncAckItem, MXDBServerToClientSyncPayloadItem } from '../../../common/models';
import { useDb } from '../dbs';
import { useClientToServerSync } from './useClientToServerSync';
import type { Logger } from '@anupheaus/common';

export const ServerToClientProvider = createComponent('ServerToClientProvider', () => {
  const { db } = useDb();
  const { waitForS2CGate } = useClientToServerSync();
  const logger = useLogger();

  useServerActionHandler(mxdbServerToClientSyncAction)(async payload => {
    await waitForS2CGate();

    const ack: ServerToClientSyncAck = [];

    for (const item of payload) {
      const ackItem = await applyS2CItem(db, item, logger);
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
): Promise<ServerToClientSyncAckItem> {
  const collection = db.use(item.collectionName);
  const successfulRecordIds: string[] = [];
  const deletedRecordIds: string[] = [];

  for (const { record, lastAuditEntryId } of item.updates) {
    try {
      const existingAudit = await collection.getAudit(record.id);
      if (existingAudit != null && auditor.hasPendingChanges(existingAudit)) continue;

      await collection.upsert(record as any, 'branched', lastAuditEntryId);
      successfulRecordIds.push(record.id);
    } catch {
      // Omit from ack — server will leave mirror unchanged
    }
  }

  for (const { recordId, lastAuditEntryId } of item.deletions) {
    try {
      const existingAudit = await collection.getAudit(recordId);
      logger.silly('Applying S2C update for deleted record', { recordId, lastAuditEntryId, existingAudit });
      if (existingAudit != null && auditor.hasPendingChanges(existingAudit)) continue;

      if (existingAudit != null) {
        logger.silly(`Collapsing audit on "${recordId}" to "${lastAuditEntryId}"...`);
        await collection.collapseAudit(recordId, lastAuditEntryId);
      }
      logger.silly(`Deleting local record "${recordId}"...`);
      await collection.delete(recordId as any, { auditAction: 'remove' });
      deletedRecordIds.push(recordId);
      logger.silly(`Deleted local record "${recordId}".`);
    } catch (error) {
      logger.error('Failed to apply update from server.', { error, recordId, lastAuditEntryId });
      // Omit from ack
    }
  }

  return { collectionName: item.collectionName, successfulRecordIds, deletedRecordIds };
}
