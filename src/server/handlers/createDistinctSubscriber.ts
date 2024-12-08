import type { Record } from '@anupheaus/common';
import type { MongoDocOf } from '../../common';
import { useDb } from '../providers';
import type { DistinctProps } from '@anupheaus/mxdb';
import type { CollectionSubscriber } from './createCollectionSubscription';

// interface LocalDistinctRequest<RecordType extends Record> extends Omit<DistinctRequest<RecordType>, 'filter' | 'handlerId'> {
//   collectionName: string;
//   filter: Filter<MongoDocOf<RecordType>>;
//   lastRecordIds: string[];
// }

// function convertToMongoSort<RecordType extends Record>(sort: SortableField<RecordType> | undefined): Sort | undefined {
//   if (sort == null) return;
//   if (is.string(sort)) sort = { field: sort, direction: 'asc' };
//   if (sort.field === 'id') sort.field = '_id' as any;
//   return { [sort.field]: sort.direction === 'asc' ? 1 : -1 };
// }

// async function performDistinct<RecordType extends Record>({ collectionName, filter, field, sort }: LocalDistinctRequest<RecordType>, hasClientGotRecordId: (id: string) => boolean) {
//   const { db, fromMongoDoc } = useDb();
//   const collection = db.collection<MongoDocOf<RecordType>>(collectionName);
//   let total: number | undefined;
//   const mongoSort = convertToMongoSort(sort);
//   if (field === 'id') field = '_id' as any;
//   const mongoRecords = await collection.aggregate([{ $match: filter }, { $group: { _id: `$${field.toString()}`, doc: { $top: { output: '$$ROOT', sortBy: (mongoSort ?? { '_id': 1 }) } } } }]).toArray();
//   const records: RecordType[] = [];
//   const allRecordIds: string[] = [];
//   mongoRecords.forEach(mongoRecord => {
//     const id = mongoRecord.doc._id as string;
//     allRecordIds.push(id);
//     if (hasClientGotRecordId(id)) return;
//     records.push(fromMongoDoc(mongoRecord.doc));
//   });
//   if (total == null) total = mongoRecords.length;
//   return { records, total, allRecordIds };
// }

// export function createCollectionDistinctUpdateRegister<RecordType extends Record>(syncCollection: MXDBSyncedCollection<RecordType>, logger: Logger, emit: SocketEmit) {
//   const { onWatch, modifyFilter } = useDb();
//   const { createHasClientGotRecordId } = useClientIds();

//   return SyncEvents.collection(syncCollection).distinctUpdateRegister.createSocketHandler(async ({ filter, field, sort, handlerId }) => {
//     const hasClientGotRecordId = createHasClientGotRecordId(syncCollection.name);
//     const mongoFilter = modifyFilter(filter as Filter<RecordType> | undefined);
//     const distinctRequest: LocalDistinctRequest<RecordType> = {
//       collectionName: syncCollection.name,
//       filter: mongoFilter,
//       sort,
//       field,
//       lastRecordIds: [],
//     };
//     logger.debug('Distinct update request', { collection: syncCollection.name, filter: mongoFilter, field, sort, handlerId });

//     async function informClientOfDistinctUpdate(forceUpdate: boolean = false) {
//       const { records, total, allRecordIds } = await performDistinct(distinctRequest, hasClientGotRecordId);
//       if (!forceUpdate && is.deepEqual(distinctRequest.lastRecordIds, allRecordIds)) return; // nothing has changed in the request
//       distinctRequest.lastRecordIds = allRecordIds;
//       await SyncEvents.collection(syncCollection).queryUpdate(handlerId).emit(emit, { records, total });
//     }

//     onWatch(handlerId, syncCollection, async ({ type, records: updatedOrRemovedRecords }) => {
//       let needsRequery = false;
//       let forceUpdate = false;
//       switch (type) {
//         case 'remove': {
//           const removedIds = updatedOrRemovedRecords;
//           if (distinctRequest.lastRecordIds.hasAnyOf(removedIds)) needsRequery = true;
//           break;
//         }
//         case 'upsert': {
//           needsRequery = true;
//           forceUpdate = distinctRequest.lastRecordIds.hasAnyOf(updatedOrRemovedRecords.ids());
//           break;
//         }
//       }
//       if (needsRequery) informClientOfDistinctUpdate(forceUpdate);
//     });

//     informClientOfDistinctUpdate(); // do this to update the client immediately
//   });
// }

// export function createCollectionDistinctUpdateUnregister<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, logger: Logger) {
//   const { removeWatch } = useDb();
//   return SyncEvents.collection(collection).distinctUpdateUnregister.createSocketHandler(async handlerId => {
//     logger.info(`Unregistering distinct hook for collection "${collection.name}"...`, { handlerId });
//     removeWatch(handlerId);
//     logger.info(`Distinct hook for collection "${collection.name}" unregistered successfully`, { handlerId });
//   });
// }

export const createDistinctSubscriber = <RecordType extends Record = Record>(): CollectionSubscriber<RecordType, DistinctProps<RecordType>> => ({
  subscriptionType: 'distinct',
  async onChanged({ syncCollection, filter: dataFilter, field, sort, hasClientGotRecordOrId }) {
    const { db, fromMongoDoc, modifyFilter, modifySort } = useDb();
    const filter = modifyFilter(dataFilter);
    const collection = db.collection<MongoDocOf<RecordType>>(syncCollection.name);
    let total: number | undefined;
    const mongoSort = modifySort(sort);
    if (field === 'id') field = '_id' as any;
    const mongoRecords = await collection.aggregate([{ $match: filter }, { $group: { _id: `$${field.toString()}`, doc: { $top: { output: '$$ROOT', sortBy: (mongoSort ?? { '_id': 1 }) } } } }]).toArray();
    const records: RecordType[] = [];
    const allRecordIds: string[] = [];
    mongoRecords.forEach(mongoRecord => {
      const id = mongoRecord.doc._id as string;
      allRecordIds.push(id);
      if (hasClientGotRecordOrId(id)) return;
      records.push(fromMongoDoc(mongoRecord.doc));
    });
    if (total == null) total = mongoRecords.length;
    return { records, total, allRecordIds };
  },
});