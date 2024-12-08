import type { DataFilters, Record } from '@anupheaus/common';
import type { Query } from './createQuery';
import type { TableOnRequest } from '@anupheaus/react-ui';
import { useDebounce } from '@anupheaus/react-ui';

interface TableRequestProps {
  debounceTimer?: number;
}

export function createTableRequest<RecordType extends Record>(query: Query<RecordType>) {
  return ({ debounceTimer = 200 }: TableRequestProps = {}): TableOnRequest<RecordType> => useDebounce(async ({ requestId, ...request }, onResponse) => {
    const filter = {} as DataFilters<RecordType>;
    query({ filter, sort: 'id' as any, ...request }, response => onResponse({ ...response, requestId }));
  }, debounceTimer);
}
