import { createComponent, useOnUnmount, useSet } from '@anupheaus/react-ui';
import { useDb } from '../dbs';
import { useMemo } from 'react';
import { useClientToServerSyncInstance } from './useClientToServerSyncInstance';

/**
 * Subscribes to every configured collection's onChange stream and forwards
 * client-originated upserts and removes to the {@link ClientToServerSynchronisation}
 * wrapper. Branched upserts (server-driven) and `auditAction === 'remove'` removes
 * (server-driven reconciliation) are excluded.
 */
export const ClientToServerProvider = createComponent('ClientToServerProvider', () => {
  const { db, collections } = useDb();
  const unsubscribeCallbacks = useSet<() => void>();
  const c2s = useClientToServerSyncInstance();

  useMemo(() => {
    if (c2s == null) return;

    collections.forEach(collection => {
      const dbCollection = db.use(collection.name);
      unsubscribeCallbacks.add(dbCollection.onChange(event => {
        switch (event.type) {
          case 'upsert': {
            if (event.auditAction === 'branched') return;
            for (const record of event.records) c2s.enqueue(collection.name, record.id);
            break;
          }
          case 'remove': {
            if (event.auditAction === 'remove') return;
            for (const id of event.ids) c2s.enqueue(collection.name, id);
            break;
          }
          // 'clear' and 'reload' events are not client-originated mutations → no enqueue
        }
      }));
    });
  }, []);

  useOnUnmount(() => {
    unsubscribeCallbacks.forEach(unsubscribe => unsubscribe());
  });

  return null;
});
