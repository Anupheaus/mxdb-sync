// import { createContext } from 'react';
// import type { MXDBSyncedCollection } from '../../../common';

// export interface CollectionSubscriptionSubscribeProps<Props extends {}, Response> {
//   type: string;
//   hookId: string;
//   hash: string;
//   props: Props;
//   collection: MXDBSyncedCollection;
//   dbName?: string;
//   onUpdate(response: Response): void;
// }

// export interface CollectionSubscriptionContextProps {
//   isValid: boolean;
//   subscribe<Props extends {}, Response>(props: CollectionSubscriptionSubscribeProps<Props, Response>): Promise<void>;
//   unsubscribe(subscriberId: string): Promise<void>;
// }

// export const CollectionSubscriptionContext = createContext<CollectionSubscriptionContextProps>({
//   isValid: false,
//   subscribe: () => Promise.resolve(),
//   unsubscribe: () => Promise.resolve(),
// });