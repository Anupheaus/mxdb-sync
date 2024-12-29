// import type { DataFilters, DataPagination, PromiseMaybe, Record } from '@anupheaus/common';
// import { useDb } from '../providers';
// import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
// import type { SortableField } from '@anupheaus/mxdb';
// import { useClientTools } from '../hooks';

// interface ActionProps<Response = void> {
//   collection: MXDBSyncedCollection;
//   lastResponse?: Response;
// }

// type ActionChangeProps = {
//   updateType: 'upsert';
//   records: Record[];
// } | {
//   updateType: 'remove';
//   records: string[];
// };

// interface ServerActionConfig<Props extends {} | void = void, Response = void> {
//   name: string;
//   invoke(props: Props & ActionProps<Response>): PromiseMaybe<Response>;
//   onChanged?(props: ActionChangeProps & ActionProps<Response>): PromiseMaybe<boolean>;
// }

// function createServerSubscription<Props extends {} | void = void, Response = void>(actionConfig: ServerActionConfig<Props, Response>): void {

// }

// interface QueryActionRequest<RecordType extends Record = Record> {
//   filter: DataFilters<RecordType>;
//   sort: SortableField<RecordType>;
//   pagination: DataPagination;
// }

// interface QueryActionResponse {
//   recordIds: string[];
//   total: number;
// }

// export const serverQuerySubscription = createServerSubscription<QueryActionRequest, QueryActionResponse>({
//   name: 'query',
//   async invoke({ filter: dataFilter, sort, pagination, collection }) {
//     const { db, convertFilter, convertSort } = useDb();
//     const { pushRecords } = useClientTools();
//     const filter = convertFilter(dataFilter);
//     const dbCollection = db.collection<MongoDocOf<Record>>(collection.name);
//     let total: number | undefined;
//     if (pagination != null) total = await dbCollection.countDocuments(filter);
//     const mongoSort = convertSort(sort);
//     let filterResult = dbCollection.find(filter);
//     if (mongoSort != null) filterResult = filterResult.sort(mongoSort);
//     if (pagination != null) {
//       if (pagination.offset) filterResult = filterResult.skip(pagination.offset);
//       filterResult = filterResult.limit(pagination.limit);
//     }
//     const mongoRecords = await filterResult.toArray();
//     const recordIds = mongoRecords.ids();
//     if (total == null) total = mongoRecords.length;
//     await pushRecords(collection.name, mongoRecords);
//     return { recordIds, total };
//   },
//   onChanged({ updateType, records, lastResponse }) {
//     switch (updateType) {
//       case 'remove': {
//         const removedIds = records;
//         return lastResponse?.recordIds.hasAnyOf(removedIds) ?? false;
//       }
//       case 'upsert': return true;
//     }
//   },
// });
