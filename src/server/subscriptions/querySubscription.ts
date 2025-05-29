import { mxdbQuerySubscription } from '../../common';
import { useCollection } from '../collections';
import { useClient } from '../hooks';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';

export const serverQuerySubscription = createServerCollectionSubscription<string[]>()(mxdbQuerySubscription,
  async ({ request, previousResponse, subscriptionId, additionalData: previousRecordIds, updateAdditionalData, update, onUnsubscribe }) => {
    const { collectionName, filters, pagination, sorts } = request;
    const { collection, query, onChange, removeOnChange } = useCollection(collectionName);
    const { pushRecords } = useClient();

    const performQuery = async (): Promise<[string[], number]> => {
      const { data: records, total } = await query({ filters, pagination, sorts, getAccurateTotal: true });
      await pushRecords(collection, records);
      return [records.ids(), total];
    };

    const watchId = `mxdb.query.${subscriptionId}`;
    onChange(watchId, async () => {
      const [newRecordIds, newTotal] = await performQuery();
      // if the new total is different or we have different number of record ids, we need to update
      if (newTotal !== previousResponse || newRecordIds.length !== previousRecordIds?.length) { return update(newTotal); }
      // if the record is new or should now appear in this query or has changed place, we need to update
      if (previousRecordIds.some((id, index) => newRecordIds[index] !== id)) { return update(newTotal); }
    });

    onUnsubscribe(() => removeOnChange(watchId));

    const [recordIds, total] = await performQuery();

    updateAdditionalData(recordIds);

    return total;
  });
