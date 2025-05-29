// import { is, type Record } from '@anupheaus/common';
// import type { ServerDbCollection } from '../providers';
// import { useClient } from '../providers';

// export function createGet<RecordType extends Record>(collection: ServerDbCollection<RecordType>) {
//   async function get(id: string): Promise<RecordType | undefined>;
//   async function get(ids: string[]): Promise<RecordType[]>;
//   async function get(ids: string | string[]): Promise<RecordType | RecordType[] | undefined> {
//     if (!is.array(ids)) return get([ids]);
//     const client = useClient();
//     ids = ids.filter(is.string);
//     if (ids.length === 0) return [];
//     return collection.get(ids);
//   }

//   return get;
// }