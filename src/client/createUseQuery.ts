import { useLayoutEffect } from 'react';
import type { MXDBSyncedCollection, QueryProps } from '../common';
import type { Record } from '@anupheaus/common';
import type { Query } from './createQuery';
import { useDataCollection } from './useInternalCollections';

export function createUseQuery<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, query: Query<RecordType>, dbName?: string) {
  const { useQuery } = useDataCollection<RecordType>(collection, dbName);

  return (props: QueryProps<RecordType> = {}) => {
    const state = useQuery(props);

    useLayoutEffect(() => {
      query(props); // this is only needed to trigger the query function, if the props change, it will trigger the query and then it will be upserted, which will then trigger the useQuery hook
    }, [Object.hash(props)]);

    return state;
  };
}