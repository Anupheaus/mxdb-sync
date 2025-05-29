import type { Record } from '@anupheaus/common';
import type { MXDBOnChangeEvent } from '../../../common';

export type ServerDbChangeEvent = { collectionName: string; } & MXDBOnChangeEvent;

export interface ServerDbCollectionSyncResponse<RecordType extends Record> {
  acknowledgedIds: string[];
  updated: RecordType[];
  removedIds: string[];
}

// export type ServerDbCollectionChangeEvent<RecordType extends Record> = {
//   type: 'insert' | 'update';
//   records: RecordType[];
// } | {
//   type: 'delete';
//   recordIds: string[];
// };
