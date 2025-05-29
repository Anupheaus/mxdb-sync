import { useLayoutEffect } from 'react';
import { type Record } from '@anupheaus/common';
import type { Distinct } from './createDistinct';
import { useSyncState } from '@anupheaus/react-ui';

export function createUseDistinct<RecordType extends Record>(distinct: Distinct<RecordType>) {

  return <Field extends keyof RecordType, DistinctField extends RecordType[Field]>(field: Field) => {
    const { getState, setState } = useSyncState<DistinctField[]>(() => []);

    useLayoutEffect(() => {
      distinct(field, fields => setState(fields as DistinctField[]));
    }, [field]);

    return getState();
  };
}