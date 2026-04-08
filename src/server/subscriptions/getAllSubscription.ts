import { useLogger } from '@anupheaus/socket-api/server';
import { mxdbGetAllSubscription } from '../../common';
import { useCollection } from '../collections';
import { useClient } from '../hooks';
import { useServerToClientSync, useServerToClientSynchronisation } from '../providers';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';
import { pushSubscriptionResultRecords } from './pushSubscriptionResultRecords';

export const serverGetAllSubscription = createServerCollectionSubscription<string[]>()(mxdbGetAllSubscription,
  async ({ request, subscriptionId, updateAdditionalData, update, onUnsubscribe }) => {
    const logger = useLogger();
    const { collectionName } = request;
    const { collection, getAll, onChange, removeOnChange } = useCollection(collectionName);
    const { getData } = useClient();
    const capturedS2C = useServerToClientSynchronisation();
    const { pushRecordsToClient } = useServerToClientSync();
    logger.always('getAllSubscription setup', { subscriptionId, collectionName, capturedIsNoOp: capturedS2C.isNoOp });

    async function pushCurrentSnapshot(): Promise<string[]> {
      const priorIds = getData<string[]>(`subscription-data.additional.${subscriptionId}`) ?? [];
      const records = await getAll();
      const newRecordIds = records.ids();
      const removedIds = priorIds.filter(id => !newRecordIds.includes(id));
      await pushSubscriptionResultRecords(collection, records, removedIds, pushRecordsToClient);
      updateAdditionalData(newRecordIds);
      return newRecordIds;
    }

    const watchId = `mxdb.getAll.${subscriptionId}`;
    onChange(watchId, async () => {
      let alsS2CIsNoOp: boolean | 'error';
      try {
        alsS2CIsNoOp = useServerToClientSynchronisation().isNoOp;
      } catch {
        alsS2CIsNoOp = 'error';
      }
      logger.always('getAllSubscription onChange fired', {
        subscriptionId,
        collectionName,
        capturedIsNoOp: capturedS2C.isNoOp,
        alsS2CIsNoOp,
        capturedIsSameAsAls: alsS2CIsNoOp !== 'error' && !alsS2CIsNoOp && !capturedS2C.isNoOp,
      });
      const priorIds = getData<string[]>(`subscription-data.additional.${subscriptionId}`) ?? [];
      const newRecordIds = await pushCurrentSnapshot();
      if (newRecordIds.length !== priorIds.length || priorIds.some((id, index) => newRecordIds[index] !== id)) {
        return update(newRecordIds);
      }
    });

    onUnsubscribe(() => removeOnChange(watchId));

    return pushCurrentSnapshot();
  });
