import { createComponent } from '@anupheaus/react-ui';
import { mxdbPushRecords } from '../../../common';
import { useEvent } from '../../hooks';
import { useLogger } from '../../logger';
import { useCurrentCollection } from '../collection';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';

export const PushCollection = createComponent('PushCollection', () => {
  const onPushEvent = useEvent(mxdbPushRecords);
  const collection = useCurrentCollection();
  const { upsert } = useDataCollection(collection);
  const { upsert: syncUpsert } = useSyncCollection(collection);
  const logger = useLogger();

  onPushEvent(async ({ collectionName, records }) => {
    logger.debug('Pushing records to collection', { collectionName, records: records.ids() });
    await upsert(records);
    await syncUpsert(records);
  });

  return null;
});
