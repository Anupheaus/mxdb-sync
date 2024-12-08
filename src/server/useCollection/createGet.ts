import { is, type Record } from '@anupheaus/common';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
import { useDb } from '../providers';

export function createGet<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { db, getMatchingRecordsById } = useDb();
  const dbCollection = db.collection<MongoDocOf<RecordType>>(collection.name);

  async function get(id: string): Promise<RecordType | undefined>;
  async function get(ids: string[]): Promise<RecordType[]>;
  async function get(ids: string | string[]): Promise<RecordType | RecordType[] | undefined> {
    if (!is.array(ids)) return get([ids]);
    ids = ids.filter(is.string);
    if (ids.length === 0) return [];
    return getMatchingRecordsById(dbCollection, ids);
  }

  return get;
}