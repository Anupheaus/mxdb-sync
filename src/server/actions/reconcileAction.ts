import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbReconcileAction } from '../../common';
import { useDb, useServerToClientSync } from '../providers';
import type { ReconcileRequest, ReconcileResponse } from '../../common/models';
import { configRegistry } from '../../common/registries';
import { useLogger } from '@anupheaus/socket-api/server';

export const reconcileAction = createServerActionHandler(mxdbReconcileAction, async (request: ReconcileRequest): Promise<ReconcileResponse> => {
  const db = useDb();
  const logger = useLogger();
  const { pushRecordsToClient } = useServerToClientSync();

  const response: ReconcileResponse = [];

  for (const item of request) {
    if (item.localIds.length === 0) continue;

    let dbCollection: ReturnType<typeof db.use>;
    try {
      dbCollection = db.use(item.collectionName);
    } catch {
      logger.warn(`Reconcile: unknown collection "${item.collectionName}" — skipping`);
      continue;
    }

    const deletedIds: string[] = [];
    for (const localId of item.localIds) {
      const serverRecord = await dbCollection.get(localId);
      if (serverRecord == null) deletedIds.push(localId);
    }

    if (deletedIds.length > 0) {
      logger.debug(`Reconcile: pushing ${deletedIds.length} stale deletions for "${item.collectionName}"`);
      const config = configRegistry.getOrError(dbCollection.collection);
      const disableAudit = config.disableAudit === true;
      // Fire-and-forget: pushRecordsToClient will seed the mirror and emit S2C deletions.
      void pushRecordsToClient(item.collectionName, [], deletedIds, disableAudit).catch(
        error => logger.error(`Reconcile: pushRecordsToClient failed for "${item.collectionName}"`, { error }),
      );
    }

    response.push({ collectionName: item.collectionName, deletedIds });
  }

  return response;
});
