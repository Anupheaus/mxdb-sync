// import { AsyncLocalStorage } from 'async_hooks';
// import type { MXDBCollection } from '../../common';

// const collectionsProvider = new AsyncLocalStorage<MXDBCollection[]>();

// export function provideCollections<R>(collections: MXDBCollection[], delegate: () => R): R {
//   return collectionsProvider.run(collections, delegate);
// }

// export function useCollections(): MXDBCollection[] {
//   const collections = collectionsProvider.getStore();
//   if (collections == null) throw new Error('useCollections must be used within a provideCollections context');
//   return collections;
// }
