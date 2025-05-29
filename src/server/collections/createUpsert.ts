// import type { Record } from '@anupheaus/common';
// import type { ServerDbCollection } from '../providers';
// import { useClient } from '../providers';

// export function createUpsert<RecordType extends Record>(collection: ServerDbCollection<RecordType>) {
//   async function upsert(record: RecordType): Promise<void>;
//   async function upsert(records: RecordType[]): Promise<void>;
//   async function upsert(records: RecordType | RecordType[]): Promise<void> {
//     if (!Array.isArray(records)) return upsert([records].removeNull()); // make sure we call it with an array
//     if (records.length === 0) return;
//     const client = useClient();
//     await collection.upsert(records);
//     // add ids after the upsert has completed to avoid having the db watch to send the records to the client
//     if (client != null) client.addIds(collection.name, records.ids());
//   }

//   return upsert;
// }