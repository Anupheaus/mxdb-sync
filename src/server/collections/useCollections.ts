import type { AnyFunction } from '@anupheaus/common';
import { CollectionsStore } from './provideCollections';
import type { MXDBSyncedCollection } from '../../common';

export function useProvidedCollections(collections: MXDBSyncedCollection[]) {
  return <T extends AnyFunction>(handler: T) => ((...args) => CollectionsStore.run(collections, () => handler(...args))) as T;
}

export function useContextCollections() {
  const collections = CollectionsStore.getStore();
  if (collections == null) throw new Error('Unable to use useCollections at this location, the collections are not available.');
  return {
    collections,
    provideCollections: <T extends AnyFunction>(handler: T) => ((...args) => CollectionsStore.run(collections, () => handler(...args))) as T,
  };
}

export function useCollections(): ReturnType<typeof useContextCollections>;
export function useCollections(collections: MXDBSyncedCollection[]): ReturnType<typeof useProvidedCollections>;
export function useCollections(...args: unknown[]): ReturnType<typeof useContextCollections> | ReturnType<typeof useProvidedCollections> {
  if (args.length == 0) return useContextCollections();
  if (args.length === 1 && args[0] instanceof Array) return useProvidedCollections(args[0] as MXDBSyncedCollection[]);
  throw new Error('Invalid arguments for useCollections');
}
