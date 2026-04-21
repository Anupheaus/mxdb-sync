import { mxdbGetAllSubscription } from '../../common';
import { useCollection } from '../collections';
import { useClient } from '../hooks';
import { useServerToClientSynchronisation } from '../providers';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';
import { pushSubscriptionResultRecords } from './pushSubscriptionResultRecords';

export const serverGetAllSubscription = createServerCollectionSubscription<string[]>()(mxdbGetAllSubscription,
  async ({ request, subscriptionId, updateAdditionalData, update, onUnsubscribe }) => {
    const { collectionName } = request;
    const { collection, getAll, onChange, removeOnChange } = useCollection(collectionName);
    const { getData } = useClient();
    const capturedS2C = useServerToClientSynchronisation();

    async function pushCurrentSnapshot(): Promise<string[]> {
      const priorIds = getData<string[]>(`subscription-data.additional.${subscriptionId}`) ?? [];
      const records = await getAll();
      const newRecordIds = records.ids();
      const removedIds = priorIds.filter(id => !newRecordIds.includes(id));
      await pushSubscriptionResultRecords(capturedS2C, collection, records, removedIds);
      updateAdditionalData(newRecordIds);
      return newRecordIds;
    }

    const watchId = `mxdb.getAll.${subscriptionId}`;
    onChange(watchId, async () => {
      const priorIds = getData<string[]>(`subscription-data.additional.${subscriptionId}`) ?? [];
      const newRecordIds = await pushCurrentSnapshot();
      if (newRecordIds.length !== priorIds.length || priorIds.some((id, index) => newRecordIds[index] !== id)) {
        return update(newRecordIds);
      }
    });

    onUnsubscribe(() => removeOnChange(watchId));

    return pushCurrentSnapshot();
  });
