import type { MXDBSyncedCollection } from '../../common';

let globalCollections: MXDBSyncedCollection[] = [];

export function useProvidedCollections(collections: MXDBSyncedCollection[]) {
  globalCollections = collections;
}

export function useContextCollections() {
  return globalCollections;
}

export function useCollections(): ReturnType<typeof useContextCollections>;
export function useCollections(collections: MXDBSyncedCollection[]): void;
export function useCollections(...args: unknown[]): ReturnType<typeof useContextCollections> | ReturnType<typeof useProvidedCollections> {
  if (args.length == 0) return useContextCollections();
  if (args.length === 1 && args[0] instanceof Array) return useProvidedCollections(args[0] as MXDBSyncedCollection[]);
  throw new Error('Invalid arguments for useCollections');
}
