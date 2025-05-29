import { createComponent, useOnUnmount, useSet } from '@anupheaus/react-ui';
import { useDb } from '../dbs';
import { useMemo } from 'react';
import { useAction } from '@anupheaus/socket-api/client';
import { mxdbRemoveAction, mxdbUpsertAction } from '../../../common';

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
            await removeAction({ collectionName: collection.name, recordIds: event.ids, locallyOnly: true });
            break;
          case 'upsert':
            if (event.auditAction === 'branched') return;
            await upsertAction({ collectionName: collection.name, records: event.records });
            await dbCollection.resetAuditsOn(event.records.ids());
            break;
          case 'remove':
            await removeAction({ collectionName: collection.name, recordIds: event.ids, locallyOnly: event.auditAction === 'remove' });
            await dbCollection.resetAuditsOn(event.ids);
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
