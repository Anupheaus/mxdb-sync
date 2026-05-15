import { to, type Record } from '@anupheaus/common';
import type { MongoDocOf } from '../../../common';
import type { WithId } from 'mongodb';

function deserialize<RecordType extends Record>(record: MongoDocOf<RecordType> | WithId<MongoDocOf<RecordType>> | undefined): RecordType | undefined {
  if (record == null) return;
  const { _id, ...doc } = record;
  return to.deserialise<RecordType>({ ...doc, id: _id });
}

function serialize<RecordType extends Record>({ id, ...doc }: RecordType): MongoDocOf<RecordType> {
  return JSON.parse(to.serialise({ ...doc, _id: id })) as MongoDocOf<RecordType>;
}

export const dbUtils = {
  deserialize,
  serialize,
};