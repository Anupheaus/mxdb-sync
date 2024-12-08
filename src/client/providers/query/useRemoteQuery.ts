import { type Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../../common';
import { useContext } from 'react';
import { RemoteQueryContext } from './RemoteQueryContext';
import { useBound, useId, useOnUnmount } from '@anupheaus/react-ui';
import type { QueryProps } from '@anupheaus/mxdb';
import { useSocket } from '../socket';
import { useSyncCollection } from '../../useInternalCollections';

export interface RemoteQueryUpdate { total: number | undefined; }

export interface RemoteQueryRegisterQueryProps<RecordType extends Record> {
  collection: MXDBSyncedCollection<RecordType>;
  dbName: string | undefined;
  props: QueryProps<RecordType>;
  disable?: boolean;
  dataUpsert(records: RecordType[]): Promise<void>;
  onUpdate(props: RemoteQueryUpdate): void;
}

export function useRemoteQuery<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName: string | undefined) {
  const { isValid, unregisterQuery, registerQuery } = useContext(RemoteQueryContext);
  const { upsertFromQuery } = useSyncCollection(collection, dbName);
  const { isConnected } = useSocket();
  const hookId = useId();
  if (!isValid) throw new Error('useQueryUpdateProvider must be used within a QueryUpdateProvider');

  useOnUnmount(() => unregisterQuery(hookId));

  const query = useBound(async ({ disable, onUpdate, ...props }: RemoteQueryRegisterQueryProps<RecordType>) => {
    if (disable) {
      await unregisterQuery(hookId);
    } else {
      if (isConnected()) {
        await registerQuery({ ...props, onUpdate, upsertFromQuery, hookId });
      } else {
        onUpdate({ total: undefined });
      }
    }
  });

  return {
    query,
  };
}
