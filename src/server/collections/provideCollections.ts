import { AsyncLocalStorage } from 'async_hooks';
import type { MXDBSyncedCollection } from '../../common';

export const CollectionsStore = new AsyncLocalStorage<MXDBSyncedCollection[]>();

export function provideCollections<T>(collections: MXDBSyncedCollection[], fn: () => T) {
  return CollectionsStore.run(collections, fn);
}
