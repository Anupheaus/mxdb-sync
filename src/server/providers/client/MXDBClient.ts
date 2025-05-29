// import type { Record, Unsubscribe } from '@anupheaus/common';
// import { useDb } from '..';
// import { useEvent } from '@anupheaus/socket-api/server';
// import { mxdbServerPush } from '../../../common';
// import { useClient } from '../../hooks/useClient';

// export class MXDBClient {
//   constructor() {
//     this.#dbUnsubscribe = this.#listenForDbEvents();
//     this.#clientRecordIds = new Map();
//   }

//   #dbUnsubscribe: Unsubscribe;
//   #clientRecordIds: Map<string, Set<string>>;

//   // public addIds(collectionName: string, ids: string[]) {
//   //   const clientIds = this.#getIds(collectionName);
//   //   clientIds.addMany(ids);
//   // }

//   // public removeIds(collectionName: string, ids: string[]) {
//   //   const clientIds = this.#getIds(collectionName);
//   //   clientIds.deleteMany(ids);
//   // }

//   // public clearIds(collectionName: string) {
//   //   const clientIds = this.#getIds(collectionName);
//   //   clientIds.clear();
//   // }

//   public pushToClient(collectionName: string, records: Record[]) {
//     const sendToClient = useEvent(mxdbServerPush);
//     const clientIds = this.#getIds(collectionName);
//     const ids: string[] = [];
//     const newRecords = records.mapWithoutNull(record => {
//       if (clientIds.has(record.id)) return;
//       ids.push(record.id);
//       return record;
//     });
//     this.addIds(collectionName, ids);
//     sendToClient({ collectionName, updatedRecords: newRecords, removedRecordIds: [] });
//   }

//   public terminate() {
//     this.#dbUnsubscribe();
//   }

//   #getIds(collectionName: string) {
//     const {  } = useClient();
//     return this.#clientRecordIds.getOrSet(collectionName, () => new Set());
//   }

//   #listenForDbEvents() {
//     const db = useDb();
//     // const sendToClient = useEvent(mxdbServerPush);
//     return db.onChange(async event => {
//       // const clientIds = this.#getIds(event.collectionName);
//       const { pushRecords, removeRecords } = useClient();
//       switch (event.type) {
//         case 'insert': case 'update': {
//           await pushRecords(event.collectionName, event.records);
//           const updatedRecords: Record[] = [];
//           const updatedRecordIds: string[] = [];
//           event.records.forEach(record => {
//             if(!clientIds.has(record.id)) return;
//             updatedRecords.push(record);
//             updatedRecordIds.push(record.id);
//           });
//           await sendToClient({ collectionName: event.collectionName, updatedRecords, removedRecordIds: [] });
//           clientIds.addMany(updatedRecordIds);
//           break;
//         }
//         case 'delete': {
//           const removedRecordIds = event.recordIds.filter(id => clientIds.has(id));
//           await sendToClient({ collectionName: event.collectionName, updatedRecords: [], removedRecordIds });
//           clientIds.deleteMany(removedRecordIds);
//           break;
//         }
//       }
//     });
//   }
// }