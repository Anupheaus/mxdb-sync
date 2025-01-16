import { createComponent, useBound, useMap, useSubscriptionProvider } from '@anupheaus/react-ui';
import { type ReactNode } from 'react';
import type { QuerySubscriptionProps } from './QuerySubscription';
import { QuerySubscription } from './QuerySubscription';
import { useAction, useEvent } from '../../hooks';
import { mxdbQueryAction, mxdbRefreshQuery } from '../../../common';

interface Props {
  children?: ReactNode;
}

export const QuerySubscriptionProvider = createComponent('QuerySubscriptionProvider', ({
  children = null,
}: Props) => {
  const { invoke, Provider } = useSubscriptionProvider(QuerySubscription);
  const onQueryRefresh = useEvent(mxdbRefreshQuery);
  const hookToCollectionName = useMap<string, string>();
  const { mxdbQueryAction: queryAction } = useAction(mxdbQueryAction);

  onQueryRefresh(async ({ queryId, total }) => invoke(total, queryId));

  const onSubscribed = useBound(async (hookId: string, { collectionName, ...props }: QuerySubscriptionProps, _callback: (total: number | undefined) => void, hash?: string, hashIsNew?: boolean) => {
    if (hash == null) return;
    if (hashIsNew !== true) return;
    hookToCollectionName.set(hookId, collectionName);
    const total = await queryAction({ ...props, collectionName, queryId: hash, registrationAction: 'register' });
    invoke(total, hash);
  });

  const onUnsubscribed = useBound((hookId: string, hash?: string, hashDestroyed?: boolean) => {
    if (hash == null || hashDestroyed !== true) return;
    const collectionName = hookToCollectionName.get(hookId);
    if (collectionName == null) throw new Error('Collection name not found for the query subscription.');
    queryAction({ collectionName, queryId: hash, registrationAction: 'unregister' });
    hookToCollectionName.delete(hookId);
  });

  return (
    <Provider onSubscribed={onSubscribed} onUnsubscribed={onUnsubscribed}>
      {children}
    </Provider>
  );
});
