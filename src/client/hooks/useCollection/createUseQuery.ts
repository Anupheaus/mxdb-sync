import { useMemo, useRef } from 'react';
import type { Record } from '@anupheaus/common';
import type { Query } from './createQuery';
import { useSyncState } from '@anupheaus/react-ui';
import type { QueryProps } from '../../../common';
import type { AddDebugTo, AddDisableTo } from '../../../common/internalModels';

export function createUseQuery<RecordType extends Record>(query: Query<RecordType>) {

  return (props: AddDebugTo<AddDisableTo<QueryProps<RecordType>>> = {}) => {
    const { setState, getState } = useSyncState(() => ({ records: [] as RecordType[], total: 0, isLoading: true }));
    const requestIdRef = useRef('');

    useMemo(() => {
      if (props.disable) {
        if (props.debug) console.log('[MXDB-Sync] Query is disabled, returning default', props); // eslint-disable-line no-console
        setState({ records: [], total: 0, isLoading: false });
      } else {
        setState(s => ({ ...s, isLoading: true }));
        const requestId = requestIdRef.current = Math.uniqueId();
        if (props.debug) console.log('[MXDB-Sync] Sending query', { requestId, props }); // eslint-disable-line no-console
        query(props, ({ records, total }) => {
          if (props.debug) console.log('[MXDB-Sync] Received query response', { requestId, records, total }); // eslint-disable-line no-console
          if (requestId !== requestIdRef.current) return;
          setState({ records, total, isLoading: false });
        }, () => setState(s => ({ ...s, isLoading: false })));
      }
    }, [Object.hash(props)]);

    return getState();
  };
}