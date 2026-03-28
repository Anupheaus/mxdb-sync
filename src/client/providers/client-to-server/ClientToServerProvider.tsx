import { createComponent, useOnUnmount, useSet } from '@anupheaus/react-ui';
import { useDb } from '../dbs';
import { useMemo } from 'react';
import { auditor } from '../../../common';
import { hashRecord, contentHash } from '../../../common/auditor/hash';
import { useClientToServerSyncInstance } from './useClientToServerSyncInstance';

/**
 * §3.1 — Replaces immediate mxdbUpsertAction / mxdbRemoveAction with enqueue on
 * ClientToServerSynchronisation. Each local upsert/remove (non-branched) calls enqueue;
 * the C2S class handles debounced batching and server delivery.
 */
export const ClientToServerProvider = createComponent('ClientToServerProvider', () => {
  const { db, collections } = useDb();
  const unsubscribeCallbacks = useSet<() => void>();
  const c2s = useClientToServerSyncInstance();

  useMemo(() => {
    if (c2s == null) return;

    collections.forEach(collection => {
      const dbCollection = db.use(collection.name);

      unsubscribeCallbacks.add(dbCollection.onChange(async event => {
        switch (event.type) {
          case 'upsert': {
            // §4.5 — Branched upserts do NOT enqueue (server-driven reconciliation)
            if (event.auditAction === 'branched') return;

            for (const record of event.records) {
              const audit = await dbCollection.getAudit(record.id);
              if (audit == null) continue;
              const lastAuditEntryId = auditor.getLastEntryId(audit);
              if (lastAuditEntryId == null) continue;
              const recordHash = await hashRecord(record);
              c2s.enqueue({ collectionName: collection.name, recordId: record.id, recordHash, lastAuditEntryId });
            }
            break;
          }
          case 'remove': {
            // §4.5 — 'remove' auditAction means server-driven deletion, skip enqueue
            if (event.auditAction === 'remove') return;

            for (const id of event.ids) {
              const audit = await dbCollection.getAudit(id);
              if (audit == null) continue;
              const lastAuditEntryId = auditor.getLastEntryId(audit);
              if (lastAuditEntryId == null) continue;
              // Deleted row → hash of null
              const recordHash = contentHash(null);
              c2s.enqueue({ collectionName: collection.name, recordId: id, recordHash, lastAuditEntryId });
            }
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
