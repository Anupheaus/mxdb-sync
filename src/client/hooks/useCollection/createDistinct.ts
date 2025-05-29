import type { Logger } from '@anupheaus/common';
import { is, type Record } from '@anupheaus/common';
import type { DistinctProps, DistinctRequest, DistinctResults } from '../../../common';
import { mxdbDistinctAction, mxdbDistinctSubscription } from '../../../common';
import type { DbCollection } from '../../providers';
import type { UseSubscription } from './createUseSubscription';
import { useSubscriptionWrapper } from './useSubscriptionWrapper';
import type { AddDisableTo } from '../../../common/internalModels';

export function createDistinct<RecordType extends Record>(collection: DbCollection<RecordType>, useSubscription: UseSubscription, logger: Logger) {
  const distinct = useSubscriptionWrapper<RecordType, DistinctProps<RecordType>, DistinctResults<RecordType>, DistinctRequest, string>({
    collection,
    subscription: mxdbDistinctSubscription,
    action: mxdbDistinctAction,
    logger,
    slowThreshold: 1500,
    onDefaultResponse: () => [],
    onRemoteDefaultResponse: () => '',
    onExecute: request => collection.distinct(request),
    onRequestTransform: request => ({ ...request as DistinctRequest, collectionName: collection.name }),
    useSubscription,
  });

  function distinctWrapper<Key extends keyof RecordType>(field: Key, disable?: boolean): Promise<DistinctResults<RecordType, Key>>;
  function distinctWrapper<Key extends keyof RecordType>(field: Key, onResponse: (fields: DistinctResults<RecordType, Key>) => void, disable?: boolean): Promise<void>;
  function distinctWrapper<Key extends keyof RecordType>(props: AddDisableTo<DistinctProps<RecordType, Key>>): Promise<DistinctResults<RecordType, Key>>;
  function distinctWrapper<Key extends keyof RecordType>(props: AddDisableTo<DistinctProps<RecordType, Key>>, onResponse: (fields: DistinctResults<RecordType, Key>) => void): Promise<void>;
  function distinctWrapper<Key extends keyof RecordType>(fieldOrProps: Key | AddDisableTo<DistinctProps<RecordType, Key>>,
    disableOrOnResponse?: boolean | ((fields: DistinctResults<RecordType, Key>) => void), disable?: boolean) {
    const props = (is.string(fieldOrProps) ? { field: fieldOrProps as Key } : fieldOrProps) as DistinctProps<RecordType, Key>;
    const onResponse = is.function(disableOrOnResponse) ? disableOrOnResponse : undefined;
    disable = is.boolean(disableOrOnResponse) ? disableOrOnResponse : disable;
    if (onResponse != null) return distinct({ ...props, disable }, onResponse as (result: DistinctResults<RecordType>) => void);
    return distinct({ ...props, disable });
  }

  return distinctWrapper;
}

export type Distinct<RecordType extends Record> = ReturnType<typeof createDistinct<RecordType>>;
