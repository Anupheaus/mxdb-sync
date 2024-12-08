// import { Record } from '@anupheaus/common';
// import { Db, ObjectId } from 'mongodb';
// import { MongoDocOf } from '../common';

// function serialise<RecordType extends Record>(record: RecordType): MongoDocOf<RecordType> {
//   return (({ id, ...rec }) => ({ ...rec, _id: record.id }))(record) as unknown as MongoDocOf<RecordType>;
// }


// export function createUseStore<RecordType extends Record>(name: string, db: Db) {
//   const collection = db.collection(name);
//   return () => {

//     async function upsert(records: RecordType[]): Promise<RecordType[]>;
//     async function upsert(record: RecordType): Promise<RecordType>;
//     async function upsert(records: RecordType | RecordType[]) {
//       if (!Array.isArray(records)) return (await upsert([records]))[0];
//       await collection.bulkWrite(records.map(record => ({ replaceOne: { replacement: serialise(record), upsert: true, filter: { _id: record.id as unknown as ObjectId } } })));
//       return collection.find({ _id: { $all: records.ids() } }).toArray() as unknown as Promise<RecordType[]>;
//     }

//     async function remove(ids: string[]): Promise<void>;
//     async function remove(id: string): Promise<void>;
//     async function remove(ids: string | string[]) {
//       if (!Array.isArray(ids)) return remove([ids]);
//       await collection.deleteMany({ _id: { $all: ids } });
//     }

//     return {
//       upsert,
//       remove,
//     };
//   };
// }