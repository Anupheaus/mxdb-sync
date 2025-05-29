// import type { Db } from 'mongodb';
// import type { MXDBCollection, MXDBSyncedCollectionWatchUpdate } from '../../../common';
// import type { Record } from '@anupheaus/common';

import { AsyncLocalStorage } from 'async_hooks';
import type { ServerDb } from './ServerDb';

// export interface DbContextProps {
//   db: Db;
//   onWatch<RecordType extends Record = Record>(watchId: string, collection: MXDBCollection<RecordType>, callback: (update: MXDBSyncedCollectionWatchUpdate<RecordType>) => void): void;
//   removeWatch(watchId: string): void;
// }

export const DbProvider = new AsyncLocalStorage<ServerDb>();
