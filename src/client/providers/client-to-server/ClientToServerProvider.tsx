import { createComponent, useOnUnmount, useSet } from '@anupheaus/react-ui';
import { useDb } from '../dbs';
import { useMemo } from 'react';
import { useAction } from '@anupheaus/socket-api/client';
import { mxdbRemoveAction, mxdbUpsertAction } from '../../../common';

import { ACTION_TIMEOUT_MS, withTimeout } from '../../utils/actionTimeout';

export const ClientToServerProvider = createComponent('ClientToServerProvider', () => {
  const { db, collections } = useDb();
  const unsubscribeCallbacks = useSet<() => void>();
  const { isConnected, mxdbUpsertAction: upsertAction } = useAction(mxdbUpsertAction);
  const { mxdbRemoveAction: removeAction } = useAction(mxdbRemoveAction);

  useMemo(() => {
    collections.forEach(collection => {
      const dbCollection = db.use(collection.name);

      unsubscribeCallbacks.add(dbCollection.onChange(async event => {
        if (!isConnected()) return;
        switch (event.type) {
          case 'clear':
            await withTimeout(
              removeAction({ collectionName: collection.name, recordIds: event.ids, locallyOnly: true }),
              ACTION_TIMEOUT_MS,
              `mxdbRemoveAction(clear:${collection.name})`,
            );
            break;
          case 'upsert':
            if (event.auditAction === 'branched') return;
            try {
              const expectedIds = event.records.ids();
              const ackIds = await withTimeout(
                upsertAction({ collectionName: collection.name, records: event.records }) as Promise<string[] | undefined>,
                ACTION_TIMEOUT_MS,
                `mxdbUpsertAction(${collection.name})`,
              );
              // Only reset audits if the server explicitly acknowledged the ids we sent.
              // This prevents losing the only durable "intent" (audit history) when a disconnect/restart
              // happens mid-flight and the request was not actually persisted server-side.
              const ackSet = new Set((ackIds ?? []).removeNull());
              const allAcked = expectedIds.every(id => ackSet.has(id));
              if (allAcked) {
                await dbCollection.resetAuditsOn(expectedIds);
              }
            } catch {
              // If the request failed or timed out, keep audits intact so SyncProvider can replay via mxdbSyncCollectionsAction.
            }
            break;
          case 'remove':
            try {
              const expectedIds = event.ids;
              const ackIds = await withTimeout(
                removeAction({ collectionName: collection.name, recordIds: expectedIds, locallyOnly: event.auditAction === 'remove' }) as Promise<string[] | undefined>,
                ACTION_TIMEOUT_MS,
                `mxdbRemoveAction(${collection.name})`,
              );
              const ackSet = new Set((ackIds ?? []).removeNull());
              const allAcked = expectedIds.every(id => ackSet.has(id));
              if (allAcked) {
                await dbCollection.resetAuditsOn(expectedIds);
              }
            } catch {
              // Keep audits; reconnect sync can reconcile removals.
            }
            break;
        }
      }));
    });
  }, []);

  useOnUnmount(() => {
    unsubscribeCallbacks.forEach(unsubscribe => unsubscribe());
  });

  return null;
});
