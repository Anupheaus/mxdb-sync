
// import type { Record } from '@anupheaus/common';
// import { useClient, type ServerDbCollection } from '../providers';

// export function createClear<RecordType extends Record>(collection: ServerDbCollection<RecordType>) {
//   return async () => {
//     const client = useClient();
//     if (client != null) client.clearIds(collection.name);
//     collection.clear();
//   };
// }