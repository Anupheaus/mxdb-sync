import { useLayoutEffect, useMemo } from 'react';
import type { Record } from '@anupheaus/common';
import { useSyncState } from '@anupheaus/react-ui';
import type { DbCollection } from '../../providers';
import type { Get } from './createGet';

interface State<RecordType extends Record> {
  record?: RecordType;
  isLoading: boolean;
  error?: Error;
}

export function createUseGet<RecordType extends Record>(collection: DbCollection<RecordType>, get: Get<RecordType>) {
  return (id: string | undefined) => {
    const { setState, getState } = useSyncState<State<RecordType>>(() => ({ record: undefined, isLoading: id != null, error: undefined }));

    useMemo(() => {
      const state = getState();
      if (id == null) {
        if (state.record != null) {
          setState({ record: undefined, isLoading: false, error: undefined });
        }
      } else {
        if (state.record?.id !== id) {
          setState(s => ({ ...s, isLoading: true }));
        }
      }
    }, [id]);

    useLayoutEffect(() => {
      (async () => {
        if (id == null) {
          setState({ record: undefined, isLoading: false, error: undefined });
        } else {
          const currentState = getState();
          if (currentState.record?.id === id) return;

          setState(s => ({ ...s, isLoading: true }));
          const record = await get(id);
          setState({ record, isLoading: false, error: undefined });
        }
      })();

      return collection.onChange(event => {
        if (id == null) return;
        switch (event.type) {
          case 'upsert': {
            const record = event.records.findById(id);
            setState({ record, isLoading: false, error: undefined });
            break;
          }
          case 'remove': {
            if (!event.ids.includes(id)) return;
            setState({ record: undefined, isLoading: false, error: undefined });
            break;
          }
        }
      });
    }, [id]);

    return getState();
  };
}