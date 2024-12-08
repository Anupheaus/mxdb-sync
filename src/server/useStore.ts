// import { Record } from '@anupheaus/common';
// import { GetStoreRecordType, MongoDocOf, Store } from '../common';
// import { Filter } from 'mongodb';
// import { mongoUtils } from './mongoUtils';
// import { useDb } from './providers';

// function createServerStore<RecordType extends Record>(name: string) {
//   const db = useDb();
//   const collection = db.collection<MongoDocOf<RecordType>>(name);
//   async function upsert(records: RecordType[]): Promise<RecordType[]>;
//   async function upsert(record: RecordType): Promise<RecordType>;
//   async function upsert(records: RecordType | RecordType[]) {
//     if (!Array.isArray(records)) return (await upsert([records]))[0];
//     await collection.bulkWrite(records.map(record => ({ replaceOne: { replacement: mongoUtils.toMongoDoc(record), upsert: true, filter: { _id: record.id as any } } })));
//     return collection.find({ _id: { $all: records.ids() } }).toArray() as unknown as Promise<RecordType[]>;
//   }

//   async function remove(ids: string[]): Promise<void>;
//   async function remove(id: string): Promise<void>;
//   async function remove(ids: string | string[]) {
//     if (!Array.isArray(ids)) return remove([ids]);
//     await collection.deleteMany({ _id: { $all: ids } });
//   }

//   async function find(filter: Filter<RecordType>): Promise<RecordType[]> {
//     const rawDocs = await collection.find(mongoUtils.modifyFilter(filter)).toArray();
//     return rawDocs.map(mongoUtils.fromMongoDoc) as RecordType[];
//   }

//   return {
//     upsert,
//     remove,
//     find,
//   };
// }

// const stores = new Map<string, ReturnType<typeof createServerStore>>();

// export function useStore<StoreType extends Store>(store: StoreType): ReturnType<typeof createServerStore<GetStoreRecordType<StoreType>>> {
//   const serverStore = stores.get(store.name);
//   if (serverStore == null) return stores.set(store.name, createServerStore(store.name)).get(store.name) as any;
//   return serverStore as any;
// }
