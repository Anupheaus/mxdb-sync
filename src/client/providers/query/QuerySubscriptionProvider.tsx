import { createComponent, useBound, useSubscriptionProvider } from '@anupheaus/react-ui';
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
  const { mxdbQueryAction: queryAction } = useAction(mxdbQueryAction);

  onQueryRefresh(async ({ queryId, total }) => invoke(total, queryId));

  const onSubscribed = useBound(async (_hookId: string, { collectionName, ...props }: QuerySubscriptionProps, _callback: (total: number | undefined) => void, hash?: string, hashIsNew?: boolean) => {
    if (hash == null) return;
    if (hashIsNew !== true) return;
    const total = await queryAction({ ...props, collectionName, queryId: hash, registrationAction: 'register' });
    invoke(total, hash);
  });

  const onUnsubscribed = useBound((_hookId: string, hash?: string, hashDestroyed?: boolean) => {
    if (hash == null || hashDestroyed !== true) return;
    queryAction({ collectionName: '', queryId: hash, registrationAction: 'unregister' });
  });

  return (
    <Provider onSubscribed={onSubscribed} onUnsubscribed={onUnsubscribed}>
      {children}
    </Provider>
  );
});
