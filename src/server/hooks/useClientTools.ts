// import type { Record } from '@anupheaus/common';
// import { is } from '@anupheaus/common';
// import { mxdbPushRecords, mxdbRemoveRecords, type MongoDocOf } from '../../common';
// import { useClient } from '../providers';
// import { useEvent } from '../events';

// export function useClientTools() {
//   const { getData } = useClient();
//   const pushRecordsToClient = useEvent(mxdbPushRecords);
//   const removeRecordsFromClient = useEvent(mxdbRemoveRecords);

//   function getClientIds(collectionName: string): Set<string> {
//     const collectionClientIds = getData('clientIds', () => new Map<string, Set<string>>());
//     return collectionClientIds.getOrSet(collectionName, () => new Set<string>());
//   }

//   function addToClientIds(collectionName: string, newIds: string[]) {
//     const clientIds = getClientIds(collectionName);
//     newIds.forEach(id => {
//       if (is.not.empty(id)) clientIds.add(id);
//     });
//   }
  
//   function createHasClientGotRecordOrId(collectionName: string) {
//     const clientIds = getClientIds(collectionName);
//     return (id: string | Record | MongoDocOf<Record>) => {
//       if (is.string(id)) return clientIds.has(id);
//       if (is.object(id)) {
//         if ('id' in id) return clientIds.has(id.id);
//         if ('_id' in id) return clientIds.has(id._id);
//       }
//       return false;
//     };
//   }

//   function createFilterRecordsByIds<RecordType extends Record>(collectionName: string) {
//     const clientIds = getClientIds(collectionName);
//     return (records: RecordType[]) => {
//       if (clientIds.size === 0) return records;
//       return records.filter(record => !clientIds.has(record.id));
//     };
//   }

//   function filterRecordsByIds<RecordType extends Record>(collectionName: string, records: RecordType[]): RecordType[] {
//     return createFilterRecordsByIds<RecordType>(collectionName)(records);
//   }

//   async function pushRecords<RecordType extends Record>(collectionName: string, records: RecordType[], doNotPushIfAlreadyGot: boolean = false): Promise<void> {
//     const clientIds = getClientIds(collectionName);
//     const allIds = records.ids();
//     const newIds = allIds.filter(id => !clientIds.has(id));
    
//     await pushRecordsToClient({ collectionName, records });
//   }

//   async function removeRecords(collectionName: string, ids: string[]): Promise<void> {
//     const clientIds = getClientIds(collectionName);
//     const idsToRemove = ids.filter(id=>clientIds.has(id));
//     if(idsToRemove.length===0) return;
//     idsToRemove.forEach(id => clientIds.delete(id));
//     await removeRecordsFromClient({ collectionName, ids: idsToRemove });
//   }

//   return {
//     // addToClientIds,
//     createHasClientGotRecordOrId,
//     filterRecordsByIds,
//     createFilterRecordsByIds,
//     pushRecords,
//     removeRecords,
//   };
// }