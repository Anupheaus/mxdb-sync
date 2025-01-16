import { type Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../../common';
import { useRef } from 'react';
import type { QuerySubscriptionProps } from './QuerySubscription';
import { QuerySubscription } from './QuerySubscription';
import { useBound, useOnUnmount, useSubscription } from '@anupheaus/react-ui';
import type { QueryProps } from '@anupheaus/mxdb';
import { useSocket } from '../socket';

export interface QuerySubscriptionQueryProps<RecordType extends Record> {
  props: QueryProps<RecordType>;
  disable?: boolean;
  onUpdate(total: number | undefined): void;
}

export function useQuerySubscription<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const onUpdateRef = useRef<((total: number | undefined) => void)>(() => void 0);
  const { subscribe, unsubscribe } = useSubscription<QuerySubscriptionProps<RecordType>, number | undefined>(QuerySubscription, total => onUpdateRef.current(total));
  const { isConnected } = useSocket();

  useOnUnmount(() => unsubscribe());

  const query = useBound(async ({ disable, onUpdate, props }: QuerySubscriptionQueryProps<RecordType>) => {
    onUpdateRef.current = onUpdate;
    if (disable) {
      unsubscribe();
      onUpdate(undefined);
    } else {
      if (isConnected()) {
        const hash = Object.hash({ collectionName: collection.name, ...props });
        subscribe({ collectionName: collection.name, ...props }, hash);
      } else {
        onUpdate(undefined);
      }
    }
  });

  return {
    query,
  };
}
