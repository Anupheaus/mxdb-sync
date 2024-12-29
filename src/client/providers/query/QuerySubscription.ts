import type { DataRequest, Record } from '@anupheaus/common';
import { createSubscription } from '@anupheaus/react-ui';

export interface QuerySubscriptionProps<RecordType extends Record = Record> extends DataRequest<RecordType> {
  collectionName: string;
}

export const QuerySubscription = createSubscription<QuerySubscriptionProps, number | undefined>({
  onSubscribingCallbackAction: 'callWithLastPayload',
});