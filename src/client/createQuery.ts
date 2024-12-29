import type { Logger, Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../common';
import { useQuerySubscription, useSync } from './providers';
import { useDataCollection } from './useInternalCollections';
import type { QueryProps, QueryResponse } from '@anupheaus/mxdb';
import { useRef } from 'react';

export function createQuery<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName: string | undefined, logger: Logger) {
  const { finishSyncing } = useSync();
  const { query: dataQuery } = useDataCollection(collection, dbName);
  const { query: remoteQuery } = useQuerySubscription(collection);
  const stateRef = useRef<QueryResponse<RecordType>>({ records: [], total: 0 });
  const serverTotalRef = useRef<number>();

  const generateResult = () => (({ records, total }: QueryResponse<RecordType>) => ({ records, total: serverTotalRef.current ?? total }))(stateRef.current);

  function query(props: QueryProps<RecordType>, onResponse: (result: QueryResponse<RecordType>) => void): void;
  function query(props: QueryProps<RecordType>): Promise<QueryResponse<RecordType>>;
  function query(): Promise<QueryResponse<RecordType>>;
  function query({ disable, ...props }: QueryProps<RecordType> = {}, onResponse?: (result: QueryResponse<RecordType>) => void): void | Promise<QueryResponse<RecordType>> {
    const result = (async () => {
      if (disable === true) return { records: [], total: 0 };
      await finishSyncing(); // do this before querying the local data

      logger.info(`Querying records for collection "${collection.name}"...`, { ...props });

      await dataQuery(props, async response => {
        stateRef.current = response;
        if (onResponse != null) onResponse(generateResult());
      });

      await remoteQuery({
        props,
        disable,
        onUpdate: total => {
          if (serverTotalRef.current === total) return;
          serverTotalRef.current = total;
          if (stateRef.current.total === total) return;
          if (onResponse != null) onResponse(generateResult());
        },
      });

      return generateResult();
    })();
    if (!onResponse) return result;
  }

  return query;
}

export type Query<RecordType extends Record> = ReturnType<typeof createQuery<RecordType>>;
export type QueryPropsFilters<RecordType extends Record> = QueryProps<RecordType>['filters'];