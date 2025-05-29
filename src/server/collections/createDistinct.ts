// import { type Record } from '@anupheaus/common';
// import type { DistinctRequest, MongoDocOf, MXDBCollection } from '../../common';
// import { useDb } from '../providers';
// import type { Filter } from 'mongodb';

// export function createDistinct<RecordType extends Record>(collection: MXDBCollection<RecordType>) {
//   const { getCollections, fromMongoDocs } = useDb();
//   const { dataCollection } = getCollections(collection);

//   return async ({ field, filters, sorts }: DistinctRequest<RecordType>): Promise<Record[]> => {
//     let mongoFilters: Filter<MongoDocOf<RecordType>> = {};

//     if (field == 'id') field = '_id' as any;
//     if (filters != null) {
//       mongoFilters = filters as any;
//       Reflect.walk(filters, ({ name, rename }) => {
//         if (name === 'id') rename('_id');
//       });
//     }
//     const docs = fromMongoDocs(await dataCollection.aggregate<MongoDocOf<RecordType>>([{
//       $match: mongoFilters
//     }, {
//       $group: { doc: { $first: '$$ROOT' }, _id: `$${field.toString()}` },
//     }, {
//       $replaceRoot: { newRoot: '$doc' },
//     }]).toArray());
//     if (sorts != null) return docs.orderBy(sorts);
//     return docs;
//   };
// }
