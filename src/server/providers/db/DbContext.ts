import type { Db } from 'mongodb';
import type { MXDBSyncedCollection, MXDBSyncedCollectionWatchUpdate } from '../../../common';
import type { Record } from '@anupheaus/common';

export interface DbContextProps {
  db: Db;
  onWatch<RecordType extends Record = Record>(watchId: string, collection: MXDBSyncedCollection<RecordType>, callback: (update: MXDBSyncedCollectionWatchUpdate<RecordType>) => void): void;
  removeWatch(watchId: string): void;
}
