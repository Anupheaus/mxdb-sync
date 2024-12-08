// import { Record } from '@anupheaus/common';
// import { Filter, WithId } from 'mongodb';
// import { MongoDocOf } from '../common/models';

// function toMongoDoc<RecordType extends Record>(record: RecordType): MongoDocOf<RecordType> {
//   return (({ id, ...rec }) => ({ ...rec, _id: record.id }))(record) as unknown as MongoDocOf<RecordType>;
// }

// function toMongoDocs<RecordType extends Record>(records: RecordType[]): MongoDocOf<RecordType>[] {
//   return records.map(toMongoDoc);
// }

// function fromMongoDoc<RecordType extends Record>(record: WithId<MongoDocOf<RecordType>> | MongoDocOf<RecordType>): RecordType {
//   return (({ _id, ...rec }) => ({ ...rec, id: record._id }))(record) as unknown as RecordType;
// }

// function fromMongoDocs<RecordType extends Record>(records: WithId<MongoDocOf<RecordType>>[] | MongoDocOf<RecordType>[]): RecordType[] {
//   return records.map(fromMongoDoc) as RecordType[];
// }

// function modifyFilter<RecordType extends Record>(filter: Filter<RecordType>): Filter<MongoDocOf<RecordType>> {
//   return (({ id, ...record }) => ({ ...record, _id: id }))(filter);
// }

// export const mongoUtils = {
//   toMongoDoc,
//   toMongoDocs,
//   fromMongoDoc,
//   fromMongoDocs,
//   modifyFilter,
// };
