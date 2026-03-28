import type { MXDBCollection } from '../common';
import { auditor, configRegistry } from '../common';
import { Logger, is } from '@anupheaus/common';
import { hashRecord } from '../common/auditor/hash';
import { useDb } from './providers';
import type { ServerToClientSynchronisation } from './ServerToClientSynchronisation';
import type { Socket } from 'socket.io';
import type { Unsubscribe } from '@anupheaus/common';

const clientWatchSubscriptions = new WeakMap<Socket, Unsubscribe>();

/**
 * §2.4 — Feed DB changes into the per-connection ServerToClientSynchronisation mirror.
 * When the mirror detects staleness (hash or lastAuditEntryId differs), it emits
 * mxdbServerToClientSyncAction to the client.
 */
export function addClientWatches(client: Socket, collections: MXDBCollection[], s2c: ServerToClientSynchronisation): void {
  const db = useDb();

  if (clientWatchSubscriptions.has(client)) return;

  clientWatchSubscriptions.set(client, db.onChange(async event => {
    const collection = collections.findBy('name', event.collectionName);
    if (!collection) return;
    const config = configRegistry.getOrError(collection);
    const watchLog = !is.browser() ? Logger.getCurrent()?.createSubLogger('clientDbWatches') : undefined;

    switch (event.type) {
      case 'insert': case 'update': {
        watchLog?.debug('changeStream batch → S2C mirror (insert/update)', {
          socketId: client.id,
          collectionName: event.collectionName,
          recordIds: event.records.ids(),
          updatedAts: event.records.map(r => (r as { updatedAt?: number }).updatedAt),
        });
        const dbCollection = db.use(event.collectionName);
        const changes = await Promise.all(event.records.map(async record => {
          let lastAuditEntryId: string;
          if (config.disableAudit === true) {
            lastAuditEntryId = '';
          } else {
            const serverAudit = await dbCollection.getAudit(record.id);
            lastAuditEntryId = serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
          }
          const recordHash = await hashRecord(record);
          return { recordId: record.id, record, lastAuditEntryId, recordHash };
        }));
        await s2c.onDbChange(event.collectionName, changes);
        break;
      }
      case 'delete': {
        watchLog?.debug('changeStream batch → S2C mirror (delete)', {
          socketId: client.id,
          collectionName: event.collectionName,
          recordIds: event.recordIds,
        });
        const dbCollection = db.use(event.collectionName);
        const changes = await Promise.all(event.recordIds.map(async recordId => {
          let lastAuditEntryId = '';
          if (config.disableAudit !== true) {
            const serverAudit = await dbCollection.getAudit(recordId);
            lastAuditEntryId = serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
          }
          return { recordId, lastAuditEntryId, recordHash: '', deleted: true };
        }));
        await s2c.onDbChange(event.collectionName, changes);
        break;
      }
    }
  }));
}

export function removeClientWatches(client: Socket): void {
  const unsubscription = clientWatchSubscriptions.get(client);
  if (unsubscription == null) return;
  unsubscription();
  clientWatchSubscriptions.delete(client);
}
