import { is, type Logger, type Record } from '@anupheaus/common';
import type { GetAllRequest } from '../../../common';
import { mxdbGetAllAction, mxdbGetAllSubscription } from '../../../common';
import type { DbCollection } from '../../providers';
import type { UseSubscription } from './createUseSubscription';
import { useSubscriptionWrapper } from './useSubscriptionWrapper';
import type { AddDebugTo, AddDisableTo } from '../../../common/models';

export function createGetAll<RecordType extends Record>(collection: DbCollection<RecordType>, useSubscription: UseSubscription, logger: Logger) {
  const wrapper = useSubscriptionWrapper<RecordType, object, RecordType[], GetAllRequest, string[]>({
    collection,
    subscription: mxdbGetAllSubscription,
    action: mxdbGetAllAction,
    logger,
    useSubscription,
    onDefaultResponse: () => [],
    onRemoteDefaultResponse: () => [],
    async onExecute() {
      return collection.getAll();
    },
    onRequestTransform: () => ({ collectionName: collection.name }),
  });

  type GetAllProps = AddDebugTo<AddDisableTo<object>>;

  function getAllWrapper(props?: GetAllProps): Promise<RecordType[]>;
  function getAllWrapper(props: GetAllProps, onResponse: (result: RecordType[]) => void): Promise<void>;
  function getAllWrapper(props: GetAllProps, onResponse: (result: RecordType[]) => void, onSameResponse: () => void): Promise<void>;
  function getAllWrapper(props?: GetAllProps, onResponse?: (result: RecordType[]) => void, onSameResponse?: () => void): Promise<RecordType[] | void> {
    props = props ?? {};
    if (is.function(onResponse) && is.function(onSameResponse)) return wrapper(props, onResponse, onSameResponse);
    if (is.function(onResponse)) return wrapper(props, onResponse);
    return wrapper(props);
  }

  return getAllWrapper;
}

export type GetAll<RecordType extends Record> = ReturnType<typeof createGetAll<RecordType>>;
