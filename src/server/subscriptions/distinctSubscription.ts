import { mxdbDistinctSubscription } from '../../common';
import { useCollection } from '../collections';
import { useClient } from '../hooks';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';

export const serverDistinctSubscription = createServerCollectionSubscription()(mxdbDistinctSubscription,
  async ({ request: { collectionName, ...request }, previousResponse, subscriptionId, update, onUnsubscribe }) => {
    const { collection, distinct, onChange, removeOnChange } = useCollection(collectionName);
    const { pushRecords } = useClient();

    const performDistinctQuery = async (): Promise<string[]> => {
      const records = await distinct(request);
      await pushRecords(collection, records);
      return records.ids();
    };

    const internalSubscriptionId = `mxdb.distinct.${subscriptionId}`;
    onChange(internalSubscriptionId, async () => {
      const newRecordIds = await performDistinctQuery();
      const newHash = newRecordIds.join('|').hash();
      // if the record is new or should now appear in this query or has changed place, we need to update
      if (previousResponse != newHash) { return update(newHash); }
    });

    onUnsubscribe(() => removeOnChange(internalSubscriptionId));

    const recordIds = await performDistinctQuery();

    return recordIds.join('|').hash();
  });
