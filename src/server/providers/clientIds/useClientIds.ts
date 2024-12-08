import type { Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import { useUserData } from '../userData';

export function useClientIds() {
  const { isDataAvailable, getData } = useUserData();
  if (!isDataAvailable()) throw new Error('Client ids were requested but UserData was not available at this location.');

  function getClientIds(collectionName: string): Set<string> {
    const collectionClientIds = getData('clientIds', () => new Map<string, Set<string>>());
    return collectionClientIds.getOrSet(collectionName, () => new Set<string>());
  }

  function addToClientIds(collectionName: string, newRecordsOrIds: string[]) {
    const clientIds = getClientIds(collectionName);
    newRecordsOrIds.forEach(recordOrId => {
      if (is.not.empty(recordOrId)) clientIds.add(recordOrId);
    });
  }

  function createHasClientGotRecordId(collectionName: string) {
    const clientIds = getClientIds(collectionName);
    return (id: string) => clientIds.has(id);
  }

  function createFilterRecordsByIds<RecordType extends Record>(collectionName: string) {
    const clientIds = getClientIds(collectionName);
    return (records: RecordType[]) => {
      if (clientIds.size === 0) return records;
      return records.filter(record => !clientIds.has(record.id));
    };
  }

  function filterRecordsByIds<RecordType extends Record>(collectionName: string, records: RecordType[]): RecordType[] {
    return createFilterRecordsByIds<RecordType>(collectionName)(records);
  }

  return {
    addToClientIds,
    createHasClientGotRecordId,
    filterRecordsByIds,
    createFilterRecordsByIds,
  };
}