import type { MXDBCollection } from '../common';
import { useDb } from './providers';
import { useClient } from './hooks';
import type { Socket } from 'socket.io';
import type { Unsubscribe } from '@anupheaus/common';

const clientWatchSubscriptions = new WeakMap<Socket, Unsubscribe>();

export function addClientWatches(client: Socket, collections: MXDBCollection[]): void {
  const db = useDb();
  const { syncRecords } = useClient();

  if (clientWatchSubscriptions.has(client)) return;

  clientWatchSubscriptions.set(client, db.onChange(async event => {
    const collection = collections.findBy('name', event.collectionName);
    if (!collection) return;
    switch (event.type) {
      case 'insert': case 'update': {
        await syncRecords(collection, event.records, []);
        break;
      }
      case 'delete': {
        await syncRecords(collection, [], event.recordIds);
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
