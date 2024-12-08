import { useLayoutEffect } from 'react';
import type { MXDBSyncedCollection } from '../common';
import type { Get } from './createGet';
import type { Record } from '@anupheaus/common';
import { useDataCollection } from './useInternalCollections';

export function createUseGet<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, get: Get<RecordType>, dbName?: string) {
  const { useGet } = useDataCollection<RecordType>(collection, dbName);

  return (id: string | undefined) => {
    const state = useGet(id);
    useLayoutEffect(() => {
      if (id == null) return;
      get(id); // this is only needed to trigger the get function, if the id needs to be downloaded, it will be and then it will be upserted, which will then trigger the useGet hook
    }, [id]);
    return state;
  };
}