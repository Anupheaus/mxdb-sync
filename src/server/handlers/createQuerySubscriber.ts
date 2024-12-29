import type { Record } from '@anupheaus/common';
import type { MongoDocOf } from '../../common';
// import type { SocketEmit } from '../providers';
import { useDb } from '../providers';
// import { SyncEvents } from '../../common/syncEvents';
import type { QueryProps } from '@anupheaus/mxdb';
import type { CollectionSubscriber } from './createCollectionSubscription';

// interface LocalQueryRequest<RecordType extends Record> extends Omit<QueryRequest<RecordType>, 'filter' | 'handlerId'> {
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

// async function performQuery<RecordType extends Record>({ collectionName, filter, pagination, sort }: LocalQueryRequest<RecordType>, hasClientGotRecordId: (id: string) => boolean) {
//   const { db, fromMongoDoc } = useDb();
//   const collection = db.collection<MongoDocOf<RecordType>>(collectionName);
//   let total: number | undefined;
//   if (pagination != null) total = await collection.countDocuments(filter);
//   const mongoSort = convertToMongoSort(sort);
//   let filterResult = collection.find(filter);
//   if (mongoSort != null) filterResult = filterResult.sort(mongoSort);
//   if (pagination != null) {
//     if (pagination.offset) filterResult = filterResult.skip(pagination.offset);
//     filterResult = filterResult.limit(pagination.limit);
//   }
//   const mongoRecords = await filterResult.toArray();
//   const records: RecordType[] = [];
//   const allRecordIds: string[] = [];
//   mongoRecords.forEach(mongoRecord => {
//     const id = mongoRecord._id as string;
//     allRecordIds.push(id);
//     if (hasClientGotRecordId(id)) return;
//     records.push(fromMongoDoc(mongoRecord));
//   });
//   if (total == null) total = mongoRecords.length;
//   return { records, total, allRecordIds };
// }

// export function createCollectionQueryUpdateRegister<RecordType extends Record>(syncCollection: MXDBSyncedCollection<RecordType>, logger: Logger, emit: SocketEmit) {
//   const { onWatch, modifyFilter } = useDb();
//   const { createHasClientGotRecordId } = useClientIds();

//   return SyncEvents.collection(syncCollection).queryUpdateRegister.createSocketHandler(async ({ filter, pagination, sort, handlerId }) => {
//     const hasClientGotRecordId = createHasClientGotRecordId(syncCollection.name);
//     const mongoFilter = modifyFilter(filter as Filter<RecordType> | undefined);
//     const queryRequest: LocalQueryRequest<RecordType> = {
//       collectionName: syncCollection.name,
//       filter: mongoFilter,
//       pagination,
//       sort,
//       lastRecordIds: [],
//     };
//     logger.debug('Query update request', { collection: syncCollection.name, filter: mongoFilter, pagination, sort, handlerId });

//     async function informClientOfQueryUpdate(forceUpdate: boolean = false) {
//       const { records, total, allRecordIds } = await performQuery(queryRequest, hasClientGotRecordId);
//       if (!forceUpdate && is.deepEqual(queryRequest.lastRecordIds, allRecordIds)) return; // nothing has changed in the query
//       queryRequest.lastRecordIds = allRecordIds;
//       await SyncEvents.collection(syncCollection).queryUpdate(handlerId).emit(emit, { records, total });
//     }

//     onWatch(handlerId, syncCollection, async ({ type, records: updatedOrRemovedRecords }) => {
//       let needsRequery = false;
//       let forceUpdate = false;
//       switch (type) {
//         case 'remove': {
//           const removedIds = updatedOrRemovedRecords;
//           if (queryRequest.lastRecordIds.hasAnyOf(removedIds)) needsRequery = true;
//           break;
//         }
//         case 'upsert': {
//           needsRequery = true;
//           forceUpdate = queryRequest.lastRecordIds.hasAnyOf(updatedOrRemovedRecords.ids());
//           break;
//         }
//       }
//       if (needsRequery) informClientOfQueryUpdate(forceUpdate);
//     });

//     informClientOfQueryUpdate(); // do this to update the client immediately
//   });
// }

// export function createCollectionQueryUpdateUnregister<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, logger: Logger) {
//   const { removeWatch } = useDb();
//   return SyncEvents.collection(collection).queryUpdateUnregister.createSocketHandler(async handlerId => {
//     logger.info(`Unregistering query hook for collection "${collection.name}"...`, { handlerId });
//     removeWatch(handlerId);
//     logger.info(`Query hook for collection "${collection.name}" unregistered successfully`, { handlerId });
//   });
// }

export const createQuerySubscriber = <RecordType extends Record = Record>(): CollectionSubscriber<RecordType, QueryProps<RecordType>> => ({
  subscriptionType: 'query',
  async onChanged({ syncCollection, filters: dataFilter, pagination, sorts, hasClientGotRecordOrId }) {
    const { db, fromMongoDoc, convertFilter, convertSort } = useDb();
    const filter = convertFilter(dataFilter);
    const collection = db.collection<MongoDocOf<RecordType>>(syncCollection.name);
    let total: number | undefined;
    if (pagination != null) total = await collection.countDocuments(filter);
    const mongoSort = convertSort(sorts);
    let filterResult = collection.find(filter);
    if (mongoSort != null) filterResult = filterResult.sort(mongoSort);
    if (pagination != null) {
      if (pagination.offset) filterResult = filterResult.skip(pagination.offset);
      filterResult = filterResult.limit(pagination.limit);
    }
    const mongoRecords = await filterResult.toArray();
    const records: RecordType[] = [];
    const allRecordIds: string[] = [];
    mongoRecords.forEach(mongoRecord => {
      const id = mongoRecord._id as string;
      allRecordIds.push(id);
      if (hasClientGotRecordOrId(id)) return;
      records.push(fromMongoDoc(mongoRecord));
    });
    if (total == null) total = mongoRecords.length;
    return { records, total, allRecordIds };
  },
});
