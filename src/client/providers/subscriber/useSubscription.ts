// import { useId, useOnUnmount } from '@anupheaus/react-ui';
// import type { MXDBSyncedCollection } from '../../../common';
// import { useContext, useRef } from 'react';
// import { CollectionSubscriptionContext } from './CollectionSubscriptionContext';

// interface UseCollectionSubscriptionProps {
//   type: string;
//   collection: MXDBSyncedCollection;
//   dbName?: string;
// }

// interface SubscriberProps<Props extends {}, Response> {
//   props: Props;
//   hash?: string;
//   disable?: boolean;
//   onUpdate(response: Response): void;
// }

// export function useSubscription<Props extends {} = {}, Response = void>({ type, collection, dbName }: UseCollectionSubscriptionProps) {
//   const { isValid, subscribe, unsubscribe } = useContext(CollectionSubscriptionContext);
//   const hookId = useId();
//   const lastHash = useRef<string>();

//   if (!isValid) throw new Error('useSubscription must be used within a MXDBSync component.');

//   useOnUnmount(() => {
//     unsubscribe(hookId);
//   });

//   return async ({ hash, props, disable, onUpdate }: SubscriberProps<Props, Response>): Promise<void> => {
//     if (disable) {
//       if (lastHash.current == null) return;
//       lastHash.current = undefined;
//       await unsubscribe(hookId);
//       return;
//     }
//     hash = Object.hash({ props, collection: collection.name, dbName });
//     if (hash === lastHash.current) return;
//     lastHash.current = hash;
//     await subscribe({ type, hookId, hash, props, collection, dbName, onUpdate });
//   };
// }