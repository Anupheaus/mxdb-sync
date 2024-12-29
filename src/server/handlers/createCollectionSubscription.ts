import type { Logger, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../common';
import type { SocketEmit } from '../providers';
import { useDb } from '../providers';
import { SyncEvents } from '../../common/syncEvents';
import { useClientTools } from '../hooks';

export interface CollectionSubscriberProps<RecordType extends Record> {
  syncCollection: MXDBSyncedCollection<RecordType>;
  logger: Logger;
  forceUpdate: boolean;
  previousRecordIds: string[];
  hasClientGotRecordOrId(recordOrId: RecordType | string): boolean;
}

export interface CollectionSubscriberOnChangedResponse<RecordType extends Record> {
  total: number;
  records: RecordType[];
  allRecordIds: string[];
}

export interface CollectionSubscriber<RecordType extends Record = Record, Props extends {} = {}> {
  subscriptionType: string;
  onChanged(props: CollectionSubscriberProps<RecordType> & Props): Promise<CollectionSubscriberOnChangedResponse<RecordType>>;
}

// eslint-disable-next-line max-len
export function createCollectionSubscriptionRegister<RecordType extends Record>(syncCollection: MXDBSyncedCollection<RecordType>, subscribers: CollectionSubscriber<RecordType>[], logger: Logger, emit: SocketEmit) {
  const { onWatch } = useDb();
  const { createHasClientGotRecordOrId } = useClientTools();

  return SyncEvents.collection(syncCollection).subscriptionRegister.createSocketHandler(async ({ type, subscriberId, ...props }) => {
    const hasClientGotRecordOrId = createHasClientGotRecordOrId(syncCollection.name);
    const state = { previousRecordIds: [] } as { previousRecordIds: string[]; };
    logger.debug('Subscription registration request', { collection: syncCollection.name, type });

    async function informClientOfUpdate(forceUpdate: boolean = false) {
      const subscriber = subscribers.find(sub => sub.subscriptionType === type);
      if (!subscriber) {
        logger.error(`Subscriber for subscription type "${type}" not found for collection "${syncCollection.name}"`);
        return;
      }
      const { records, total, allRecordIds } = await subscriber.onChanged({ syncCollection, logger, forceUpdate, previousRecordIds: state.previousRecordIds, hasClientGotRecordOrId, ...props });
      if (!forceUpdate && is.deepEqual(state.previousRecordIds, allRecordIds)) return; // nothing has changed in the request
      state.previousRecordIds = records.ids();
      await SyncEvents.collection(syncCollection).subscriptionUpdate(subscriberId).emit(emit, { records, total });
    }

    onWatch(subscriberId, syncCollection, async ({ type: updateType, records: updatedOrRemovedRecords }) => {
      let needsRequery = false;
      let forceUpdate = false;
      switch (updateType) {
        case 'remove': {
          const removedIds = updatedOrRemovedRecords;
          if (state.previousRecordIds.hasAnyOf(removedIds)) needsRequery = true;
          break;
        }
        case 'upsert': {
          needsRequery = true;
          forceUpdate = state.previousRecordIds.hasAnyOf(updatedOrRemovedRecords.ids());
          break;
        }
      }
      if (needsRequery) informClientOfUpdate(forceUpdate);
    });

    informClientOfUpdate(); // do this to update the client immediately
  });
}

export function createCollectionSubscriptionUnregister<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, logger: Logger) {
  const { removeWatch } = useDb();
  return SyncEvents.collection(collection).subscriptionUnregister.createSocketHandler(async subscriberId => {
    logger.info(`Unregistering subscription for collection "${collection.name}"...`, { subscriberId });
    removeWatch(subscriberId);
    logger.info(`Subscription for collection "${collection.name}" unregistered successfully`, { subscriberId });
  });
}