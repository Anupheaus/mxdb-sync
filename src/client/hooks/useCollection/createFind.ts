import { is, type DataFilters, type Record } from '@anupheaus/common';
import type { Query } from './createQuery';

export function createFind<RecordType extends Record>(query: Query<RecordType>) {
  async function find(filters: DataFilters<RecordType>, onResponse?: (record: RecordType) => void) {
    if (is.function(onResponse)) {
      await query({ filters }, ({ records }) => {
        if (records.length === 0) return;
        onResponse?.(records[0]);
      });
    } else {
      return query({ filters });
    }
  }

  return find;
}
