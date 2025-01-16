import { is, type AnyFunction, type Record } from '@anupheaus/common';
import { ClientAsyncStore } from './provideClient';
import { mxdbServerPush, type MXDBSyncedCollection } from '../../../common';
import { useEvent } from '../../events';

export function useClient() {
  const store = ClientAsyncStore.getStore();

  function getData<T>(key: string, defaultValue: () => T): T;
  function getData<T>(key: string): T | undefined;
  function getData<T>(key: string, defaultValue?: () => T): T | undefined {
    const scopedStore = ClientAsyncStore.getStore();
    if (scopedStore == null) throw new Error('UserData is not available at this location.');
    if (!scopedStore.data.has(key)) {
      if (defaultValue == null) return undefined;
      scopedStore.data.set(key, defaultValue());
    }
    return scopedStore.data.get(key);
  }

  function setData<T>(key: string, value: T) {
    const scopedStore = ClientAsyncStore.getStore();
    if (scopedStore == null) throw new Error('UserData is not available at this location.');
    scopedStore.data.set(key, value);
  }

  function provideClient<T extends AnyFunction>(handler: T) {
    if (store == null) throw new Error('provideClient is not available in the current context, it must be called within a connected client context.');
    return ((...args: Parameters<T>) => ClientAsyncStore.run(store, () => handler(...args))) as T;
  }

  function isDataAvailable() {
    return ClientAsyncStore.getStore() != null;
  }

  function getClientIds(collectionName: string): Set<string> {
    const collectionClientIds = getData('clientIds', () => new Map<string, Set<string>>());
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

  return {
    get client() {
      if (store == null) throw new Error('client is not available in the current context, it must be called within a connected client context.');
      return store.client;
    },
    provideClient,
    getData,
    setData,
    isDataAvailable,
    pushRecords,
    removeRecords,
    syncRecords,
    addExistingClientIds,
    removeClientIds,
  };
}
