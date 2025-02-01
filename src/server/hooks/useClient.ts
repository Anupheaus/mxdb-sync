import { is, type Record } from '@anupheaus/common';
import { useEvent, useSocketAPI } from '@anupheaus/socket-api/server';
import { mxdbServerPush, type MXDBSyncedCollection } from '../../common';

export function useClient() {
  const result = useSocketAPI();

  function getClientIds(collectionName: string): Set<string> {
    const collectionClientIds = result.getData('clientIds', () => new Map<string, Set<string>>());
    return collectionClientIds.getOrSet(collectionName, () => new Set<string>());
  }

  function addExistingClientIds(collection: MXDBSyncedCollection, recordsOrIds: (Record | string)[]) {
    const clientIds = getClientIds(collection.name);
    recordsOrIds.forEach(recordOrId => {
      if (is.record(recordOrId)) clientIds.add(recordOrId.id);
      if (is.not.empty(recordOrId)) clientIds.add(recordOrId);
    });
  }

  function removeClientIds(collection: MXDBSyncedCollection, ids: string[]) {
    const clientIds = getClientIds(collection.name);
    ids.forEach(id => clientIds.add(id));
  }

  async function syncRecords<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, updated: RecordType[], removedIds: string[], doNotFilterIds: boolean = false) {
    const clientIds = getClientIds(collection.name);
    const serverPush = useEvent(mxdbServerPush);
    removedIds = removedIds.filter(id => clientIds.has(id));
    if (!doNotFilterIds) updated = updated.filter(record => !clientIds.has(record.id));
    if (updated.length === 0 && removedIds.length === 0) return;
    await serverPush({ collectionName: collection.name, updatedRecords: updated, removedRecordIds: removedIds });
    addExistingClientIds(collection, updated);
    removeClientIds(collection, removedIds);
  }

  async function pushRecords<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, records: RecordType[]) {
    await syncRecords(collection, records, []);
  }

  async function removeRecords(collection: MXDBSyncedCollection, ids: string[]) {
    syncRecords(collection, [], ids);
  }

  const additions = {
    pushRecords,
    removeRecords,
    syncRecords,
    addExistingClientIds,
    removeClientIds,
  };

  return Object.assign(result, additions);
}
