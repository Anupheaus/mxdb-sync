// import { createComponent, useMap } from '@anupheaus/react-ui';
// import { type ReactNode, useMemo } from 'react';
// import { type CollectionSubscriptionContextProps, CollectionSubscriptionContext } from './CollectionSubscriptionContext';
// import { CollectionSubscriptionHandler } from './CollectionSubscriptionHandler';
// import { useSocket } from '../socket';

// interface Props {
//   children?: ReactNode;
// }

// export const CollectionSubscriptionProvider = createComponent('CollectionSubscriptionProvider', ({
//   children = null,
// }: Props) => {
//   const { emit, on } = useSocket();
//   const queryUpdateHandlers = useMap<string, CollectionSubscriptionHandler>();
//   const hookHashes = useMap<string, string>();

//   const context = useMemo<CollectionSubscriptionContextProps>(() => ({
//     isValid: true,
//     async subscribe({ hash, collection, dbName, hookId, props, type, onUpdate }) {
//       const existingHash = hookHashes.get(hookId);
//       if (existingHash != null && existingHash !== hash) {
//         const currentHandler = queryUpdateHandlers.get(existingHash);
//         if (currentHandler) currentHandler.unregisterHook(hookId);
//       }
//       const handler = queryUpdateHandlers.getOrSet(hash, () => new CollectionSubscriptionHandler({ collection, dbName, props, type, onUpdate, emit, on }));
//       await handler.registerOrUpdateHook({ hookId, onUpdate });
//       hookHashes.set(hookId, hash);
//     },
//     async unsubscribe(hookId) {
//       const hash = hookHashes.get(hookId);
//       if (hash == null) return;
//       const handler = queryUpdateHandlers.get(hash);
//       if (handler != null) {
//         handler.unregisterHook(hookId);
//         if (handler.length === 0) queryUpdateHandlers.delete(hash);
//       }
//       hookHashes.delete(hookId);
//     },
//   }), []);

//   return (
//     <CollectionSubscriptionContext.Provider value={context}>
//       {children}
//     </CollectionSubscriptionContext.Provider>
//   );
// });
