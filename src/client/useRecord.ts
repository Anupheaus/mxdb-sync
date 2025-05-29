import { is, type Record } from '@anupheaus/common';
import type { MXDBCollection } from '../common';
import { useCollection } from './hooks/useCollection/useCollection';

export type RecordTypeOfCollection<Collection extends MXDBCollection<Record>> = Collection extends MXDBCollection<infer RecordType> ? RecordType : never;

export function useRecord<Collection extends MXDBCollection<Record>>(recordOrId: RecordTypeOfCollection<Collection> | string | undefined, collection: Collection) {
  const { useGet, upsert, remove } = useCollection<RecordTypeOfCollection<Collection>>(collection as any);
  const { record: recordFromId, isLoading, error } = useGet(is.string(recordOrId) ? recordOrId : undefined);
  const recordFromRecord = is.plainObject<RecordTypeOfCollection<Collection>>(recordOrId) ? recordOrId : undefined;

  return {
    record: recordFromRecord ?? recordFromId,
    isLoading,
    error,
    upsert,
    remove,
  };
}
