import { Db } from 'mongodb';
import { MXDBSyncedCollection, MXDBSyncedCollectionWatchUpdate } from '../../../common';
import { Record } from '@anupheaus/common';

export interface DbContextProps {
  db: Db;
  onWatch<RecordType extends Record>(watchId: string, collection: MXDBSyncedCollection<RecordType>, callback: (update: MXDBSyncedCollectionWatchUpdate<RecordType>) => void): void;
  removeWatch(watchId: string): void;
}
