// import type { Record, DataFilters } from '@anupheaus/common';
// import type { MXDBCollection } from '../../common';
// import { useDb } from '../providers';

// export function createFind<RecordType extends Record>(collection: MXDBCollection<RecordType>) {
//   const { getCollections, fromMongoDocs, convertFilter } = useDb();
//   const { dataCollection } = getCollections(collection);

//   return async (filters: DataFilters<RecordType>): Promise<RecordType | undefined> => {
//     const mongoFilters = convertFilter(filters);
//     const rawDoc = await dataCollection.findOne(mongoFilters);
//     if (rawDoc == null) return;
//     return fromMongoDocs([rawDoc])[0];
//   };
// }
