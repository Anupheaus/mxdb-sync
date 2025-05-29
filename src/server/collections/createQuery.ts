// import { type DataRequest, type DataResponse, type Record } from '@anupheaus/common';
// import type { MongoDocOf, MXDBCollection } from '../../common';
// import { useDb } from '../providers';
// import type { Filter } from 'mongodb';
// import { useLogger } from '@anupheaus/common';

// const slowQueryThreshold = 3000;
// const slowFilterParseThreshold = 1000;

// export function createQuery<RecordType extends Record>(collection: MXDBCollection<RecordType>) {
//   const { getCollections, fromMongoDocs, convertSort } = useDb();
//   const logger = useLogger().createSubLogger(collection.name).createSubLogger('query');
//   const { dataCollection } = getCollections(collection);

//   return async (request?: DataRequest<RecordType>, getAccurateTotal = false, debug = false): Promise<DataResponse<RecordType>> => {
//     const [data, total, offset, limit] = await (async () => {
//       if (request == null) {
//         const innerDocs = fromMongoDocs(await dataCollection.find().toArray());
//         return [innerDocs, innerDocs.length];
//       } else {
//         let filters: Filter<MongoDocOf<RecordType>> = {};
//         let skip: number | undefined;
//         let max: number | undefined;

//         if (request.filters != null && Object.keys(request.filters).length > 0) {
//           filters = request.filters as any;
//           if (debug) logger.debug('Renaming id to _id in filters...');
//           const startTime = performance.now();
//           Reflect.walk(filters, ({ name, rename }) => {
//             if (name === 'id') rename('_id');
//           });
//           const endTime = performance.now();
//           if (endTime - startTime >= slowFilterParseThreshold) logger.warn(`Slow filter parsing found for "${collection.name}"`, { request, duration: endTime - startTime });
//           if (debug) logger.debug('Renaming id to _id in filters completed', { duration: endTime - startTime });
//         }
//         if (request.pagination != null) {
//           skip = request.pagination.offset ?? 0;
//           max = request.pagination.limit;
//         }
//         const sort = convertSort(request.sorts);
//         if (debug) logger.debug('Querying database', { filters, sort, skip, max });
//         const startTime = performance.now();
//         const rawDocs = await dataCollection.find(filters, { sort, skip, limit: max }).toArray();
//         const endTime = performance.now();
//         if (endTime - startTime >= slowQueryThreshold) logger.warn(`Slow query found for "${collection.name}"`, { request, duration: endTime - startTime });
//         const innerDocs = fromMongoDocs(rawDocs);
//         if (!getAccurateTotal) {
//           if (debug) logger.debug('Returning documents', { count: innerDocs.length });
//           return [innerDocs, innerDocs.length, skip, max];
//         }
//         const totalCount = await dataCollection.countDocuments(filters);
//         if (debug) logger.debug('Returning documents', { count: innerDocs.length, total: totalCount });
//         return [innerDocs, totalCount, skip, max];
//       }
//     })() as [RecordType[], number, number?, number?];

//     return {
//       data,
//       total,
//       offset,
//       limit,
//     };
//   };
// }
