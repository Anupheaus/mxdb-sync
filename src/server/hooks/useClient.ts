import { is, useLogger, type Record } from '@anupheaus/common';
import { useEvent, useSocketAPI } from '@anupheaus/socket-api/server';
import { mxdbServerPush, type MXDBCollection } from '../../common';
import type { Socket } from 'socket.io';

const globalStoreClientIds = new WeakMap<Socket, Map<string, Set<string>>>();

export function useClient() {
  const result = useSocketAPI();

  function getClientIds(collectionName: string): Set<string> {
    const client = result.getClient(true);
    const clientIds = globalStoreClientIds.getOrSet(client, () => new Map<string, Set<string>>());
    return clientIds.getOrSet(collectionName, () => new Set<string>());
  }

  function addToClientIds(collection: MXDBCollection, recordsOrIds: (Record | string)[]) {
    if (recordsOrIds.length === 0) return;
    const clientIds = getClientIds(collection.name);
    recordsOrIds.forEach(recordOrId => {
      if (is.record(recordOrId)) clientIds.add(recordOrId.id);
      if (is.not.blank(recordOrId)) clientIds.add(recordOrId);
    });
  }

  function removeFromClientIds(collection: MXDBCollection, ids: string[]) {
    if (ids.length === 0) return;
    const clientIds = getClientIds(collection.name);
    ids.forEach(id => clientIds.delete(id));
  }

  async function syncRecords<RecordType extends Record>(collection: MXDBCollection<RecordType>, updated: RecordType[], removedIds: string[], doNotFilterIds: boolean = false) {
    const clientIds = getClientIds(collection.name);
    const serverPush = useEvent(mxdbServerPush);
    removedIds = removedIds.filter(id => clientIds.has(id));
    if (!doNotFilterIds) updated = updated.filter(record => !clientIds.has(record.id));
    if (updated.length === 0 && removedIds.length === 0) return;
    const logger = getLogger(collection.name);
    logger.debug('Syncing records with client', { updated, removedIds });
    addToClientIds(collection, updated);
    removeFromClientIds(collection, removedIds);
    await serverPush({ collectionName: collection.name, updatedRecords: updated, removedRecordIds: removedIds });
  }

  async function pushRecords<RecordType extends Record>(collection: MXDBCollection<RecordType>, records: RecordType[]) {
    // console.log('pushing records', { collection: collection.name, recordIds: records.ids(), clientIds: getClientIds(collection.name) });
    await syncRecords(collection, records, []);
  }

  async function removeRecords(collection: MXDBCollection, ids: string[]) {
    await syncRecords(collection, [], ids);
  }

  function getLogger(subLoggerName?: string) {
    const parentLogger = useLogger();
    const client = result.getClient();
    const clientLogger = parentLogger.createSubLogger(client?.id ?? 'admin');
    if (subLoggerName != null) return clientLogger.createSubLogger(subLoggerName);
    return clientLogger;
  }

  const additions = {
    pushRecords,
    removeRecords,
    syncRecords,
    addToClientIds,
    removeFromClientIds,
    getLogger,
  };

  return Object.assign(result, additions);
}
