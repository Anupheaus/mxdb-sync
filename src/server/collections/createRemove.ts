// import type { Record } from '@anupheaus/common';
// import type { ServerDbCollection } from '../providers';
// import { useClient } from '../providers';

// export function createRemove<RecordType extends Record>(collection: ServerDbCollection<RecordType>) {
//   async function remove(record: RecordType): Promise<void>;
//   async function remove(records: RecordType[]): Promise<void>;
//   async function remove(records: RecordType | RecordType[]): Promise<void> {
//     if (!Array.isArray(records)) return remove([records]); // make sure we call it with an array
//     const client = useClient();
//     const ids = records.ids();
//     // remove ids before the delete has completed to avoid having the db watch to send a deletion request out to the client
//     if (client != null) client.removeIds(collection.name, ids);
//     await collection.delete(ids);
//   }

//   return remove;
// }