// import { Record, is } from '@anupheaus/common';
// import { Filter } from 'mongodb';
// import { MongoDocOf, Store } from '../common';
// import { Db } from 'zangodb';
// import { mongoUtils } from '../server/mongoUtils';
// import { Socket } from 'socket.io-client';
// import { remoteQuery } from './remoteQuery';
// import { useLayoutEffect, useState } from 'react';
// import { useBound } from '@anupheaus/react-ui';

// const wrap = async <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
//   value.onsuccess = () => resolve(value.result);
//   value.onerror = () => reject(value.error);
// });

// interface State<RecordType extends Record> {
//   record: RecordType | undefined;
//   loading: boolean;
// }

// interface Props<RecordType extends Record> {
//   store: Store<RecordType>;
//   getSocket(): Socket | undefined;
//   getDb(): Db;
// }

// export function createStore<RecordType extends Record = any>({ store, getDb, getSocket }: Props<RecordType>) {
//   const getCollection = () => getDb().collection(store.name);

//   async function query(filter: Filter<RecordType>) {
//     console.log('query', filter);
//     const collection = getCollection();
//     console.log('1');
//     const newFilter = mongoUtils.modifyFilter(filter);
//     console.log('2');
//     const results = await collection.find(newFilter).toArray() as MongoDocOf<RecordType>[];
//     console.log('3');
//     const localDb = await wrap(window.indexedDB.open('mongoza'));
//     const r = await wrap(localDb.transaction('address', 'readonly').objectStore('address').get('1'));
//     console.log('4', r);
//     const localResults = results.map(mongoUtils.fromMongoDoc);
//     console.log('localResults', localResults);
//     const remoteResults = await remoteQuery({ store, getSocket, filter, existingIds: localResults.ids() });
//     console.log('remoteResults', remoteResults);
//     if (remoteResults.length > 0) await getCollection().insert(remoteResults.map(mongoUtils.toMongoDoc));
//     return localResults.concat(remoteResults).distinct() as RecordType[];
//   }

//   async function get(id: string | undefined): Promise<RecordType | undefined>;
//   async function get(ids: string[]): Promise<RecordType[]>;
//   async function get(ids: string | string[] | undefined): Promise<RecordType | RecordType[] | undefined> {
//     if (ids == null) return undefined;
//     if (!is.array(ids)) return (await get([ids]))[0];
//     return query({ _id: ids });
//   }

//   async function find(filter: Filter<RecordType>) { return query(filter); }

//   function useGet(id: string | undefined) {
//     const [state, setState] = useState<State<RecordType>>({ record: undefined, loading: true });

//     const request = useBound(async () => {
//       setState({ record: undefined, loading: true });
//       const record = await get(id);
//       setState({ record, loading: false });
//     });

//     useLayoutEffect(() => {
//       request();
//     }, []);

//     return state;
//   }

//   return {
//     get,
//     find,
//     useGet,
//   };

// }

// class GetClientStoreType<RecordType extends Record = any> { public GetType() { return createStore<RecordType>(null as any); } }
// export type ClientStore<RecordType extends Record = any> = ReturnType<GetClientStoreType<RecordType>['GetType']>;

// // export interface ClientStore<RecordType extends Record = any> {
// //   get(id: string | undefined): Promise<RecordType | undefined>;
// //   get(ids: string[]): Promise<RecordType[]>;
// //   find(filter: Filter<RecordType>): Promise<RecordType[]>;
// //   useGet(id: string | undefined): { record: RecordType | undefined; loading: boolean; };
// // }
