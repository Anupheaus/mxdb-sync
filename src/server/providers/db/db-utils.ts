import type { Record } from '@anupheaus/common';
import type { MongoDocOf } from '../../../common';
import type { WithId } from 'mongodb';

function deserialize<RecordType extends Record>(record: MongoDocOf<RecordType> | WithId<MongoDocOf<RecordType>> | undefined): RecordType | undefined {
  if (record == null) return;
  const { _id, ...doc } = record;
  return { ...doc, id: _id } as unknown as RecordType;
}

function serialize<RecordType extends Record>({ id, ...doc }: RecordType): MongoDocOf<RecordType> {
  return { ...doc, _id: id } as MongoDocOf<RecordType>;
}

export const dbUtils = {
  deserialize,
  serialize,
};