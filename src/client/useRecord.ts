import { is, type Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../common';
import { useCollection } from './useCollection';

type RecordTypeOfCollection<Collection extends MXDBSyncedCollection<Record>> = Collection extends MXDBSyncedCollection<infer RecordType> ? RecordType : never;

export function useRecord<Collection extends MXDBSyncedCollection<Record>>(recordOrId: RecordTypeOfCollection<Collection> | string | undefined, collection: Collection) {
  const { useGet, upsert } = useCollection<RecordTypeOfCollection<Collection>>(collection as any);
  const { record: recordFromId, isLoading } = useGet(is.string(recordOrId) ? recordOrId : undefined);
  const recordFromRecord = is.plainObject<RecordTypeOfCollection<Collection>>(recordOrId) ? recordOrId : undefined;

  return {
    record: recordFromRecord ?? recordFromId,
    isLoading,
    upsert,
  };
}
